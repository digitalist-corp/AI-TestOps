import type { AiBootstrapLoginField, AiBootstrapProgressEvent } from '@/types';

export interface BootstrapTimelineItem {
  id: string;
  kind: 'visit' | 'screen' | 'login_form' | 'warning' | 'done';
  icon: string;
  text: string;
  url?: string | null;
  path?: string | null;
  title?: string | null;
  elements?: number | null;
  screenshotFile?: string | null;
}

/** 전체 URL 에서 타임라인 · 카드에 보여 줄 경로(/login 등)만 뽑는다. */
export function formatDisplayPath(rawUrl?: string | null): string {
  const trimmed = rawUrl?.trim() ?? '';
  if (!trimmed) return '/';
  if (trimmed.startsWith('/')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname || '/';
    return parsed.search ? `${path}${parsed.search}` : path;
  } catch {
    return trimmed;
  }
}

/** progress 이벤트의 screenshot 값(예: screens/n1.jpg)에서 파일 이름만 추려 돌려준다. */
export function extractScreenshotFile(screenshot?: string | null): string | null {
  const trimmed = screenshot?.trim() ?? '';
  if (!trimmed) return null;
  const file = trimmed.replace(/^screens\//, '');
  if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) {
    return null;
  }
  return file;
}

/** 로그인 폼 필드 목록에서 아이디 · 비밀번호 입력란 라벨을 추린다. */
export function resolveCredentialLabels(fields?: AiBootstrapLoginField[] | null): {
  idLabel: string;
  passwordLabel: string;
} {
  const list = fields ?? [];
  const pwField = list.find((f) => (f.type ?? '').toLowerCase() === 'password');
  const idField = list.find((f) => (f.type ?? '').toLowerCase() !== 'password');
  return {
    idLabel: idField?.label?.trim() || idField?.name?.trim() || '아이디',
    passwordLabel: pwField?.label?.trim() || pwField?.name?.trim() || '비밀번호',
  };
}

/** 서버가 내려준 progress 이벤트 목록을 실시간 타임라인 표시 항목으로 바꾼다. */
export function toBootstrapTimelineItems(
  events?: AiBootstrapProgressEvent[] | null
): BootstrapTimelineItem[] {
  if (!events || events.length === 0) return [];
  const items: BootstrapTimelineItem[] = [];
  events.forEach((ev, index) => {
    if (!ev || !ev.type) return;
    const id = `${index}-${ev.type}-${ev.ts ?? ''}-${ev.url ?? ''}`;
    if (ev.type === 'visit') {
      const path = formatDisplayPath(ev.url);
      items.push({
        id,
        kind: 'visit',
        icon: '🌐',
        text: `🌐 ${path} 방문`,
        url: ev.url ?? null,
        path,
      });
      return;
    }
    if (ev.type === 'screen') {
      const path = formatDisplayPath(ev.url);
      const label = ev.title?.trim() || path;
      const count = ev.elements ?? 0;
      items.push({
        id,
        kind: 'screen',
        icon: '🧩',
        text: `🧩 ${label} — 요소 ${count}개`,
        url: ev.url ?? null,
        path,
        title: ev.title ?? null,
        elements: count,
        screenshotFile: extractScreenshotFile(ev.screenshot),
      });
      return;
    }
    if (ev.type === 'login_form') {
      const path = formatDisplayPath(ev.url);
      items.push({
        id,
        kind: 'login_form',
        icon: '🔐',
        text: `🔐 로그인 폼 감지 (${path})`,
        url: ev.url ?? null,
        path,
      });
      return;
    }
    if (ev.type === 'warning' || ev.type === 'login_failed') {
      const message = ev.message?.trim() || '경고가 발생했습니다.';
      items.push({
        id,
        kind: 'warning',
        icon: '⚠️',
        text: `⚠️ ${message}`,
      });
      return;
    }
    if (ev.type === 'done') {
      items.push({
        id,
        kind: 'done',
        icon: '✅',
        text: '✅ 사이트 분석 완료',
      });
    }
  });
  return items;
}
