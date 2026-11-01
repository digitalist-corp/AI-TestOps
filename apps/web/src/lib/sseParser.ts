import type { ChatStreamEvent } from '@/types';

export interface RawSseEvent {
  event: string;
  data: string;
}

export interface SseChunkParser {
  /** 바이트 청크 또는 문자열 조각을 밀어 넣는다. 완성된 이벤트마다 onEvent 가 호출된다. */
  push: (chunk: Uint8Array | string) => void;
  /** 스트림이 끝났을 때 남아 있는 디코더 버퍼와 마지막 이벤트를 비운다. */
  finish: () => void;
}

const KNOWN_EVENTS = new Set<ChatStreamEvent['type']>([
  'message_start',
  'text_delta',
  'tool_start',
  'permission_request',
  'permission_resolved',
  'tool_end',
  'usage',
  'error',
  'message_end',
]);

/**
 * fetch 응답 스트림에서 SSE(event: / data: / 빈 줄)를 파싱하는 순수 파서.
 *
 * - 한글 등 UTF-8 멀티바이트가 청크 경계에서 잘려도 깨지지 않도록 TextDecoder(stream: true)를 쓴다.
 * - `:` 로 시작하는 줄(예: `: ping`)은 주석으로 보고 건너뛴다.
 */
export function createSseParser(onEvent: (event: RawSseEvent) => void): SseChunkParser {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let currentEvent = '';
  let dataLines: string[] = [];

  const flushEvent = () => {
    if (dataLines.length === 0) {
      currentEvent = '';
      return;
    }
    const event = currentEvent || 'message';
    const data = dataLines.join('\n');
    currentEvent = '';
    dataLines = [];
    onEvent({ event, data });
  };

  const processLine = (rawLine: string) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '') {
      flushEvent();
      return;
    }
    if (line.startsWith(':')) {
      return;
    }
    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).replace(/^ /, '').trim();
      return;
    }
    if (line.startsWith('data:')) {
      const value = line.slice(5);
      dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
    }
  };

  const drainBuffer = () => {
    let newlineIdx = buffer.indexOf('\n');
    while (newlineIdx !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      processLine(line);
      newlineIdx = buffer.indexOf('\n');
    }
  };

  return {
    push(chunk: Uint8Array | string) {
      const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      if (!text) return;
      buffer += text;
      drainBuffer();
    },
    finish() {
      const tail = decoder.decode();
      if (tail) buffer += tail;
      drainBuffer();
      if (buffer.length > 0) {
        processLine(buffer);
        buffer = '';
      }
      flushEvent();
    },
  };
}

/**
 * 원시 SSE 이벤트를 계약된 ChatStreamEvent 로 변환한다.
 * 알 수 없는 이벤트나 깨진 JSON 은 null 을 돌려준다.
 */
export function parseChatStreamEvent(raw: RawSseEvent): ChatStreamEvent | null {
  if (!KNOWN_EVENTS.has(raw.event as ChatStreamEvent['type'])) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw.data) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      type: raw.event as ChatStreamEvent['type'],
      data: parsed as never,
    };
  } catch {
    return null;
  }
}

/**
 * ReadableStream<Uint8Array> 를 끝까지 읽으며 SSE 이벤트를 순서대로 전달한다.
 */
export async function readSseStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: RawSseEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const reader = stream.getReader();
  const parser = createSseParser(onEvent);
  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      if (value) parser.push(value);
    }
    if (!signal?.aborted) {
      parser.finish();
    }
  } finally {
    reader.releaseLock();
  }
}
