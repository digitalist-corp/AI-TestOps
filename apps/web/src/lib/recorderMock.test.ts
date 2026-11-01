import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import type { RecordedStep, RecorderState } from '@/types';
import { recorderMockApi as mock } from './recorderMock';

/**
 * 가짜 응답이 실제 서버(RecorderService)와 같이 움직이는지 지킨다.
 * 가짜 서버에는 지연(setTimeout)이 있어서 가짜 타이머로 시간을 앞으로 돌린다.
 */

// 가짜 로그인 화면의 요소 위치 (recorderMock.ts 의 PAGES.login 과 같다)
const EMAIL = { x: 500, y: 300 };
const PASSWORD = { x: 500, y: 380 };
const LANG_SELECT = { x: 500, y: 560 };
const SUBMIT = { x: 500, y: 460 };
const EMPTY = { x: 5, y: 5 };

async function settle<T>(promise: Promise<T>, ms = 1000): Promise<T> {
  const guarded = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error })
  );
  await vi.advanceTimersByTimeAsync(ms);
  const result = await guarded;
  if ('error' in result) throw result.error;
  return result.value;
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await settle(promise);
  } catch (err) {
    return err as ApiError;
  }
  throw new Error('오류가 나야 하는데 성공했다');
}

/** 세션을 만들고 준비(READY)될 때까지 기다린다. */
async function ready(body: { url?: string; useLogin?: boolean } = {}): Promise<RecorderState> {
  const started = await settle(mock.start('p1', body));
  await vi.advanceTimersByTimeAsync(3000);
  const state = await settle(mock.get('p1', started.sessionId));
  expect(state.status).toBe('READY');
  return state;
}

const step = (state: RecorderState, id: string): RecordedStep => {
  const found = state.steps.find((s) => s.id === id);
  if (!found) throw new Error(`단계 ${id} 가 없다`);
  return found;
};

beforeEach(() => {
  vi.useFakeTimers();
  window.history.pushState({}, '', '/');
});

afterEach(async () => {
  vi.useRealTimers();
});

describe('recorderMockApi — 실제 서버와 같은 동작', () => {
  it('시작하면 STARTING(단계 없음), 준비가 끝나면 첫 goto 단계가 자동으로 붙는다 (요청한 시작 주소 기준)', async () => {
    const started = await settle(mock.start('p1', { url: 'https://demo.example.com/login' }));
    expect(started.status).toBe('STARTING');
    expect(started.steps).toEqual([]);

    await vi.advanceTimersByTimeAsync(3000);
    const state = await settle(mock.get('p1', started.sessionId));
    expect(state.status).toBe('READY');
    expect(state.steps).toHaveLength(1);
    expect(state.steps[0]).toMatchObject({ action: 'goto', selector: null, value: '/login' });
  });

  it('동작이 실패하면 오류 없이 state.error 로 돌려주고 단계는 붙지 않는다. 다음 동작이 성공하면 error 가 비워진다', async () => {
    const { sessionId } = await ready();

    const failed = await settle(mock.act('p1', sessionId, { type: 'click', ...EMPTY }));
    expect(failed.status).toBe('READY');
    expect(failed.error).toBeTruthy();
    expect(failed.steps).toHaveLength(1);

    const ok = await settle(mock.act('p1', sessionId, { type: 'click', ...EMAIL }));
    expect(ok.error).toBeNull();
    expect(ok.steps).toHaveLength(2);
  });

  it('입력란이 아닌 곳 · 선택 상자(select)에 fill 하면 단계 없이 오류만 돌려준다', async () => {
    const { sessionId } = await ready();

    const onButton = await settle(mock.act('p1', sessionId, { type: 'fill', ...SUBMIT, value: 'x' }));
    expect(onButton.error).toContain('입력란이 아닙니다');
    expect(onButton.steps).toHaveLength(1);

    const onSelect = await settle(mock.act('p1', sessionId, { type: 'fill', ...LANG_SELECT, value: 'ko' }));
    expect(onSelect.error).toContain('선택 상자');
    expect(onSelect.steps).toHaveLength(1);
  });

  it('press 는 셀렉터 없이(null) 기록한다', async () => {
    const { sessionId } = await ready();
    const state = await settle(mock.act('p1', sessionId, { type: 'press', key: 'Enter' }));
    expect(state.steps.at(-1)).toMatchObject({ action: 'press', selector: null, value: 'Enter' });
  });

  it('비밀번호 입력은 값을 저장하지 않고 secretEnv 만 남긴다', async () => {
    const { sessionId } = await ready();
    const state = await settle(mock.act('p1', sessionId, { type: 'fill', ...PASSWORD, value: 'hunter2' }));
    const last = state.steps.at(-1)!;
    expect(last.secretEnv).toBe('LOGIN_PASSWORD');
    expect(last.value).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain('hunter2');
  });

  describe('PUT steps', () => {
    it('label · value 를 반영하고, 비밀번호 단계 · 값이 없는 동작의 value 는 무시하며, selector 는 서버 값을 유지한다', async () => {
      const { sessionId } = await ready();
      await settle(mock.act('p1', sessionId, { type: 'fill', ...EMAIL, value: 'old@example.com' }));
      await settle(mock.act('p1', sessionId, { type: 'fill', ...PASSWORD, value: 'pw' }));
      const before = await settle(mock.act('p1', sessionId, { type: 'click', ...SUBMIT }));
      const [goto, email, password, click] = before.steps;

      const state = await settle(
        mock.putSteps('p1', sessionId, [
          { ...goto, value: '/signup' },
          { ...email, label: '이메일 입력', value: 'new@example.com', selector: 'locator("body")' },
          { ...password, value: 'hacked' },
          { ...click, value: '무시됨' },
        ])
      );

      expect(state.steps[0].value).toBe('/signup');
      expect(state.steps[1]).toMatchObject({
        label: '이메일 입력',
        value: 'new@example.com',
        selector: "getByLabel('이메일')", // 화면이 보낸 selector 는 무시
      });
      expect(state.steps[2].value).toBeUndefined(); // 비밀번호 단계
      expect(state.steps[3].value).toBeUndefined(); // 클릭 단계
    });

    it('삭제 · 순서를 반영하고, 빈 label 은 기존 label 을 유지한다', async () => {
      const { sessionId } = await ready();
      await settle(mock.act('p1', sessionId, { type: 'click', ...EMAIL }));
      const before = await settle(mock.act('p1', sessionId, { type: 'click', ...SUBMIT }));
      const [goto, a, b] = before.steps;

      const state = await settle(mock.putSteps('p1', sessionId, [b, { ...goto, label: '   ' }]));
      expect(state.steps.map((s) => s.id)).toEqual([b.id, goto.id]);
      expect(step(state, goto.id).label).toBe(goto.label);
      expect(state.steps.some((s) => s.id === a.id)).toBe(false);
    });

    it('모르는 id · 중복 id 는 400', async () => {
      const { sessionId, steps } = await ready();
      const unknown = await caught(mock.putSteps('p1', sessionId, [{ ...steps[0], id: 'nope' }]));
      expect(unknown.status).toBe(400);
      const dup = await caught(mock.putSteps('p1', sessionId, [steps[0], steps[0]]));
      expect(dup.status).toBe(400);
    });
  });

  describe('끝난 세션', () => {
    const IDLE_MS = 11 * 60 * 1000;

    it('유휴 10분이면 CLOSED: 동작 · 스크린샷은 409 RECORDER_CLOSED, 상태 · 코드 · 저장 · 단계 수정은 된다', async () => {
      const { sessionId } = await ready();
      await settle(mock.act('p1', sessionId, { type: 'click', ...EMAIL }));
      await vi.advanceTimersByTimeAsync(IDLE_MS);

      const closed = await settle(mock.get('p1', sessionId));
      expect(closed.status).toBe('CLOSED');
      expect(closed.error).toContain('10분');
      expect(closed.steps).toHaveLength(2);

      for (const err of [
        await caught(mock.act('p1', sessionId, { type: 'click', ...EMAIL })),
        await caught(mock.screenshot('p1', sessionId)),
      ]) {
        expect(err.status).toBe(409);
        expect(err.code).toBe('RECORDER_CLOSED');
      }

      const code = await settle(mock.code('p1', sessionId, 'login'));
      expect(code.code).toContain("page.goto('/login')");
      const edited = await settle(mock.putSteps('p1', sessionId, [closed.steps[1]]));
      expect(edited.status).toBe('CLOSED');
      expect(edited.steps).toHaveLength(1);
      const saved = await settle(mock.save('p1', sessionId, { specPath: 'tests/recorded/closed.spec.ts' }));
      expect(saved.specPath).toBe('tests/recorded/closed.spec.ts');
    });

    it('준비 중에 동작을 보내면 409 RECORDER_STARTING', async () => {
      const started = await settle(mock.start('p1', {}));
      const err = await caught(mock.act('p1', started.sessionId, { type: 'click', ...EMAIL }));
      expect(err.status).toBe(409);
      expect(err.code).toBe('RECORDER_STARTING');
    });

    it('끝난 지 30분이 지나면 서버가 잊어서 404 RECORDER_SESSION_NOT_FOUND', async () => {
      const { sessionId } = await ready();
      await vi.advanceTimersByTimeAsync(IDLE_MS); // 닫힘
      await settle(mock.get('p1', sessionId));
      await vi.advanceTimersByTimeAsync(31 * 60 * 1000);

      const err = await caught(mock.get('p1', sessionId));
      expect(err.status).toBe(404);
      expect(err.code).toBe('RECORDER_SESSION_NOT_FOUND');
    });

    it('같은 사용자가 새로 시작하면 이전 세션은 닫힌다', async () => {
      const first = await ready();
      await ready();
      const old = await settle(mock.get('p1', first.sessionId));
      expect(old.status).toBe('CLOSED');
      expect(old.error).toBe('새 녹화를 시작해 이전 녹화를 닫았습니다.');
    });

    it('DELETE 하면 바로 지워져 이후 404', async () => {
      const { sessionId } = await ready();
      await settle(mock.close('p1', sessionId));
      expect((await caught(mock.get('p1', sessionId))).status).toBe(404);
    });
  });

  describe('저장', () => {
    it('.spec.ts · .spec.js · .test.ts · .test.js 로 끝나지 않거나 위험한 경로는 400 PATH_NOT_ALLOWED', async () => {
      const { sessionId } = await ready();
      for (const bad of ['tests/a.txt', 'tests/a.ts', '/abs/a.spec.ts', '../a.spec.ts', 'tests//a.spec.ts', '  ']) {
        const err = await caught(mock.save('p1', sessionId, { specPath: bad }));
        expect(err.status).toBe(400);
        expect(err.code).toBe('PATH_NOT_ALLOWED');
      }
      for (const good of ['tests/ok1.spec.ts', 'tests/ok2.spec.js', 'tests/ok3.test.ts', 'tests/ok4.test.js']) {
        expect((await settle(mock.save('p1', sessionId, { specPath: good }))).specPath).toBe(good);
      }
    });

    it('같은 경로가 있으면 409 FILE_EXISTS', async () => {
      const { sessionId } = await ready();
      await settle(mock.save('p1', sessionId, { specPath: 'tests/dup.spec.ts' }));
      const err = await caught(mock.save('p1', sessionId, { specPath: 'tests/dup.spec.ts' }));
      expect(err.status).toBe(409);
      expect(err.code).toBe('FILE_EXISTS');
    });
  });

  it('시작 주소에 limit 이 있으면 409 RECORDER_LIMIT, unavailable 이면 503 RECORDER_UNAVAILABLE (개발용 스위치)', async () => {
    const limit = await caught(mock.start('p1', { url: 'https://limit.example.com' }));
    expect(limit).toMatchObject({ status: 409, code: 'RECORDER_LIMIT' });
    const unavailable = await caught(mock.start('p1', { url: 'https://unavailable.example.com' }));
    expect(unavailable).toMatchObject({ status: 503, code: 'RECORDER_UNAVAILABLE' });
  });
});
