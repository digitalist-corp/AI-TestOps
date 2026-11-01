import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './client';

/** 서버(GlobalExceptionHandler)가 주는 오류 본문 모양 */
function errorBody(status: number, code: string, message: string) {
  return new Response(
    JSON.stringify({ message, error: { code, message, details: [] }, requestId: 'req-1' }),
    { status, headers: { 'Content-Type': 'application/json' } }
  );
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    return err as ApiError;
  }
  throw new Error('오류가 나야 하는데 성공했다');
}

describe('api.recorder 오류 변환', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('서버 오류 본문의 error.code 를 ApiError.code 로 담는다', async () => {
    fetchMock.mockResolvedValue(errorBody(409, 'RECORDER_CLOSED', '녹화 세션이 끝났습니다. 새로 시작하세요.'));

    const err = await caught(api.recorder.act('p1', 's1', { type: 'click', x: 1, y: 2 }));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe('RECORDER_CLOSED');
    expect(err.message).toBe('녹화 세션이 끝났습니다. 새로 시작하세요.');
  });

  it('시작 오류(409 RECORDER_LIMIT · 503 RECORDER_UNAVAILABLE)도 코드가 남는다', async () => {
    fetchMock.mockResolvedValueOnce(errorBody(409, 'RECORDER_LIMIT', '많습니다'));
    expect((await caught(api.recorder.start('p1', {}))).code).toBe('RECORDER_LIMIT');

    fetchMock.mockResolvedValueOnce(errorBody(503, 'RECORDER_UNAVAILABLE', 'Docker 없음'));
    const err = await caught(api.recorder.start('p1', {}));
    expect(err.status).toBe(503);
    expect(err.code).toBe('RECORDER_UNAVAILABLE');
  });

  it('스크린샷(blob) 요청 실패에서도 코드를 읽는다', async () => {
    fetchMock.mockResolvedValue(errorBody(409, 'RECORDER_CLOSED', '끝났습니다'));

    const err = await caught(api.recorder.screenshot('p1', 's1'));
    expect(err.status).toBe(409);
    expect(err.code).toBe('RECORDER_CLOSED');
  });

  it('저장 충돌은 FILE_EXISTS, 없는 세션은 RECORDER_SESSION_NOT_FOUND 로 구분된다', async () => {
    fetchMock.mockResolvedValueOnce(errorBody(409, 'FILE_EXISTS', '같은 경로'));
    expect((await caught(api.recorder.save('p1', 's1', { specPath: 'a.spec.ts' }))).code).toBe('FILE_EXISTS');

    fetchMock.mockResolvedValueOnce(errorBody(404, 'RECORDER_SESSION_NOT_FOUND', '없음'));
    const err = await caught(api.recorder.code('p1', 's1'));
    expect(err.status).toBe(404);
    expect(err.code).toBe('RECORDER_SESSION_NOT_FOUND');
  });

  it('본문이 JSON 이 아니어도(터널의 502 HTML) 상태 코드는 남고 코드는 비어 있다', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }));

    const err = await caught(api.recorder.get('p1', 's1'));
    expect(err.status).toBe(502);
    expect(err.code).toBeUndefined();
    expect(err.message).toContain('502');
  });

  it('성공 응답은 그대로 돌려주고, 동작 실패(200 + state.error)는 오류로 던지지 않는다', async () => {
    const state = { sessionId: 's1', status: 'READY', steps: [], error: '그 위치는 입력란이 아닙니다' };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(state), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const result = await api.recorder.act('p1', 's1', { type: 'fill', x: 1, y: 1, value: 'a' });
    expect(result).toMatchObject({ status: 'READY', error: '그 위치는 입력란이 아닙니다' });
  });
});
