import type { ChatUiAnswer } from '@/types';

/**
 * 채팅 질문 화면(docs/design/chat-a2ui-contract.md)의 A2UI 메시지를 읽어
 * 1) 누른 버튼 · 고른 값으로 사람이 읽는 답 요약(`content`)을 만들고
 * 2) 보낸 답을 dataModel 에 되써서 잠긴 질문이 고른 값 그대로 보이게 한다.
 */

type Json = Record<string, unknown>;

interface ActionLike {
  name: string;
  sourceComponentId?: string;
  context?: Json;
}

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown) => (typeof value === 'string' ? value : '');

function pathOf(value: unknown): string | undefined {
  return isObject(value) && typeof value['@path'] === 'string' ? value['@path'] : undefined;
}

function readSurface(messages: unknown[]) {
  let dataModel: Json = {};
  const components: Json[] = [];
  for (const message of messages) {
    if (!isObject(message)) continue;
    if (isObject(message.createSurface) && isObject(message.createSurface.dataModel)) {
      dataModel = message.createSurface.dataModel;
    }
    if (isObject(message.updateComponents) && Array.isArray(message.updateComponents.components)) {
      components.push(...message.updateComponents.components.filter(isObject));
    }
  }
  return { dataModel, components };
}

const tokens = (pointer: string) =>
  pointer
    .split('/')
    .slice(1)
    .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));

function getAt(root: unknown, pointer: string): unknown {
  return tokens(pointer).reduce<unknown>((node, key) => (isObject(node) || Array.isArray(node) ? (node as Json)[key] : undefined), root);
}

function setAt(root: Json, pointer: string, value: unknown) {
  const keys = tokens(pointer);
  if (keys.length === 0) return;
  let node: Json = root;
  for (const key of keys.slice(0, -1)) {
    if (!isObject(node[key])) node[key] = {};
    node = node[key] as Json;
  }
  node[keys[keys.length - 1]] = value;
}

function buttonContext(button: Json | undefined): Json {
  const action = isObject(button?.action) ? button.action : undefined;
  const event = isObject(action?.event) ? action.event : undefined;
  return isObject(event?.context) ? event.context : {};
}

/** 버튼 이름(submit · cancel) 과 context 로 사람이 읽는 답 요약을 만든다. 예: "다시 실행: 로그인, 장바구니" */
export function summarizeUiAction(messages: unknown[], action: ActionLike): string {
  const { dataModel, components } = readSurface(messages);
  const button = components.find((c) => c.id === action.sourceComponentId);
  const label = str(button?.label).trim() || (action.name === 'cancel' ? '취소' : '보내기');
  if (action.name === 'cancel') return label;

  const sent = action.context ?? {};
  const parts: string[] = [];
  for (const [key, def] of Object.entries(buttonContext(button))) {
    const path = pathOf(def);
    const bound = path ? components.find((c) => pathOf(c.value) === path) : undefined;
    if (!bound) continue; // 버튼에 고정된 값은 라벨이 이미 설명한다.
    const value = sent[key];
    const titleOf = (id: unknown) => {
      const items = pathOf(bound.items) ? getAt(dataModel, pathOf(bound.items)!) : bound.items;
      const item = Array.isArray(items) ? items.find((i) => isObject(i) && i.id === id) : undefined;
      return str(isObject(item) ? item.title : '') || String(id);
    };
    if (bound.component === 'CheckList') {
      const ids = Array.isArray(value) ? value : [];
      parts.push(ids.length > 0 ? ids.map(titleOf).join(', ') : '선택 없음');
    } else if (bound.component === 'ChoiceList') {
      parts.push(typeof value === 'string' && value ? titleOf(value) : '선택 없음');
    } else if (bound.component === 'TextInput') {
      parts.push(`${str(bound.label) || key}: ${str(value).trim() || '(비어 있음)'}`);
    }
  }
  return parts.length > 0 ? `${label}: ${parts.join(' · ')}` : label;
}

/** 보낸 답의 context 값을 그 버튼이 묶은 경로에 되써, 잠긴 질문이 고른 값 그대로 보이게 한다. */
export function applyUiAnswer(messages: unknown[], answer: Pick<ChatUiAnswer, 'name' | 'context'>): unknown[] {
  const { components } = readSurface(messages);
  const writes: [string, unknown][] = [];
  for (const button of components) {
    if (button.component !== 'Button') continue;
    const action = isObject(button.action) && isObject(button.action.event) ? button.action.event : undefined;
    if (action?.name !== answer.name) continue;
    for (const [key, def] of Object.entries(buttonContext(button))) {
      const path = pathOf(def);
      if (path && key in answer.context) writes.push([path, answer.context[key]]);
    }
  }
  if (writes.length === 0) return messages;
  return messages.map((message) => {
    if (!isObject(message) || !isObject(message.createSurface)) return message;
    const dataModel = JSON.parse(JSON.stringify(message.createSurface.dataModel ?? {})) as Json;
    for (const [path, value] of writes) setAt(dataModel, path, value);
    return { ...message, createSurface: { ...message.createSurface, dataModel } };
  });
}
