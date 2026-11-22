import type { PlanEntryInput, PlanPriority, ProjectMember, SiteMapNode } from '@/types';

export type PlanScreen = Pick<SiteMapNode, 'routeKey' | 'title'>;
export const planScreenName = (screen: PlanScreen) => screen.title?.trim() || screen.routeKey;
export const planMemberName = (member: ProjectMember) => member.displayName || member.username;

export const PLAN_TITLE_ERROR = '제목은 1~200자로 입력해 주세요. @와 줄바꿈은 사용할 수 없어요.';
export function validPlanTitle(title: string): boolean {
  const trimmed = title.trim();
  return trimmed.length > 0 && trimmed.length <= 200 && !/[@\r\n\u2028\u2029]/.test(title);
}

const PRIORITIES: Record<string, PlanPriority> = {
  HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW', '높음': 'HIGH', '보통': 'MEDIUM', '낮음': 'LOW',
};

function delimiterOf(text: string): string {
  let quoted = false;
  let fieldStart = true;
  let hasComma = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') {
      i++;
    } else if (char === '"' && (quoted || fieldStart)) {
      quoted = !quoted;
      fieldStart = false;
    } else if (!quoted) {
      if (char === '\t') return '\t';
      if (char === '\n' && hasComma) break;
      if (char === ',') hasComma = true;
      fieldStart = char === ',' || char === '\n';
    }
  }
  return ',';
}

function readTable(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') {
      field += '"';
      i++;
    } else if (char === '"' && (quoted || !field)) {
      quoted = !quoted;
    } else if (!quoted && char === delimiter) {
      row.push(field);
      field = '';
    } else if (!quoted && char === '\n') {
      rows.push([...row, field]);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  rows.push([...row, field]);
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

function readDate(value: string): string | null {
  if (!/^\d{4}([-.])\d{2}\1\d{2}$/.test(value)) return null;
  const iso = value.replaceAll('.', '-');
  const date = new Date(iso + 'T00:00:00Z');
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}

export interface PlanPasteRow {
  entry: PlanEntryInput;
  warnings: string[];
  invalidTitle: boolean;
}

export function parsePlanPaste(text: string, screens: PlanScreen[], members: ProjectMember[]): PlanPasteRow[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rows = readTable(normalized, delimiterOf(normalized));
  if (/^(제목|계획 항목|케이스명|title)$/i.test(rows[0]?.[0]?.trim() ?? '')) rows.shift();

  return rows.map(([rawTitle = '', rawScreen = '', rawAssignee = '', rawDate = '', rawPriority = '', rawExpected = '']) => {
    const title = rawTitle.trim();
    const screenValue = rawScreen.trim();
    const assigneeValue = rawAssignee.trim();
    const dateValue = rawDate.trim();
    const priorityValue = rawPriority.trim();
    const screen = screens.find((node) => node.routeKey === screenValue)
      ?? screens.find((node) => planScreenName(node) === screenValue);
    const assignee = members.find((member) => String(member.userId) === assigneeValue || member.username === assigneeValue)
      ?? members.find((member) => planMemberName(member) === assigneeValue);
    const dueDate = readDate(dateValue);
    const priorityKey = priorityValue.toUpperCase();
    const priority = Object.hasOwn(PRIORITIES, priorityKey) ? PRIORITIES[priorityKey] : null;
    const invalidTitle = !validPlanTitle(rawTitle);
    const warnings = [
      invalidTitle && PLAN_TITLE_ERROR,
      screenValue && !screen && `화면 미지정 (${screenValue})`,
      assigneeValue && !assignee && `담당자 미지정 (${assigneeValue})`,
      dateValue && !dueDate && `마감일 미지정 (${dateValue})`,
      priorityValue && !priority && `우선순위 미지정 (${priorityValue})`,
    ].filter((warning): warning is string => Boolean(warning));
    return {
      entry: { title, screenRouteKey: screen?.routeKey ?? null, assigneeUserId: assignee?.userId ?? null,
        dueDate, priority, expected: rawExpected.trim() || null },
      warnings,
      invalidTitle,
    };
  });
}
