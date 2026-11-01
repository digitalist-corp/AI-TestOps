import { describe, expect, it } from 'vitest';
import {
  extractScreenshotFile,
  formatDisplayPath,
  resolveCredentialLabels,
  toBootstrapTimelineItems,
} from './bootstrapTimeline';

describe('formatDisplayPath', () => {
  it('전체 주소에서 경로와 쿼리만 뽑고 빈 값은 / 로 돌려준다', () => {
    expect(formatDisplayPath('https://shop.example.com/login')).toBe('/login');
    expect(formatDisplayPath('http://localhost:3000/items?page=2')).toBe('/items?page=2');
    expect(formatDisplayPath('https://shop.example.com')).toBe('/');
    expect(formatDisplayPath('/auth/signin')).toBe('/auth/signin');
    expect(formatDisplayPath('')).toBe('/');
  });
});

describe('extractScreenshotFile', () => {
  it('screens/ 접두어를 떼고 안전하지 않은 경로는 버린다', () => {
    expect(extractScreenshotFile('screens/n1.jpg')).toBe('n1.jpg');
    expect(extractScreenshotFile('n2.jpg')).toBe('n2.jpg');
    expect(extractScreenshotFile('../result.json')).toBeNull();
    expect(extractScreenshotFile('screens/sub/n1.jpg')).toBeNull();
    expect(extractScreenshotFile(null)).toBeNull();
  });
});

describe('resolveCredentialLabels', () => {
  it('필드 목록에서 아이디와 비밀번호 라벨을 찾고 없으면 기본값을 쓴다', () => {
    expect(
      resolveCredentialLabels([
        { name: 'username', label: '이메일 주소', type: 'email' },
        { name: 'password', label: '비밀번호 입력', type: 'password' },
      ])
    ).toEqual({ idLabel: '이메일 주소', passwordLabel: '비밀번호 입력' });

    expect(resolveCredentialLabels([])).toEqual({ idLabel: '아이디', passwordLabel: '비밀번호' });
  });
});

describe('toBootstrapTimelineItems', () => {
  it('진행 이벤트를 방문 · 화면 · 로그인 폼 · 경고 타임라인 항목으로 변환한다', () => {
    const items = toBootstrapTimelineItems([
      { ts: '1', type: 'visit', url: 'https://shop.example.com/login', depth: 0 },
      {
        ts: '2',
        type: 'screen',
        url: 'https://shop.example.com/login',
        title: '로그인 화면',
        elements: 12,
        screenshot: 'screens/n1.jpg',
      },
      {
        ts: '3',
        type: 'login_form',
        url: 'https://shop.example.com/login',
        fields: [{ name: 'id', label: '아이디', type: 'text' }],
      },
      { ts: '4', type: 'login_failed', message: '로그인에 실패했습니다.' },
      { ts: '5', type: 'done' },
    ]);

    expect(items).toHaveLength(5);
    expect(items[0]).toMatchObject({
      kind: 'visit',
      text: '🌐 /login 방문',
      path: '/login',
    });
    expect(items[1]).toMatchObject({
      kind: 'screen',
      text: '🧩 로그인 화면 — 요소 12개',
      screenshotFile: 'n1.jpg',
      elements: 12,
    });
    expect(items[2]).toMatchObject({
      kind: 'login_form',
      text: '🔐 로그인 폼 감지 (/login)',
    });
    expect(items[3]).toMatchObject({
      kind: 'warning',
      text: '⚠️ 로그인에 실패했습니다.',
    });
    expect(items[4]).toMatchObject({
      kind: 'done',
      text: '✅ 사이트 분석 완료',
    });
  });
});
