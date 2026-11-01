import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/api/client';
import type { Project, RecordedStep, RecorderState } from '@/types';
import { RecorderTab } from './RecorderTab';

vi.mock('@/api/client', () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError,
    getStoredAuth: () => ({ token: 'tok', username: 'admin', role: 'ADMIN' }),
    api: {
      recorder: {
        start: vi.fn(),
        get: vi.fn(),
        screenshot: vi.fn(),
        act: vi.fn(),
        putSteps: vi.fn(),
        code: vi.fn(),
        save: vi.fn(),
        close: vi.fn(),
        closeOnLeave: vi.fn(),
      },
    },
  };
});

const rec = vi.mocked(api.recorder);

const VIEWPORT = { width: 1280, height: 800 };
// 화면에는 절반 크기(640x400)로 보이고, 왼쪽 위가 (100, 50) 에 있다고 가정한다.
const RECT = { left: 100, top: 50, width: 640, height: 400, right: 740, bottom: 450, x: 100, y: 50 };

const project = {
  projectId: 'p1',
  baseUrl: 'https://demo.example.com',
  loginSetupSpecPath: null,
  serverType: 'DEV',
} as Project;

function step(id: string, patch: Partial<RecordedStep> = {}): RecordedStep {
  return {
    id,
    action: 'click',
    selector: `getByTestId('${id}')`,
    fragile: false,
    label: `단계 ${id}`,
    url: 'https://demo.example.com/login',
    ...patch,
  };
}

function state(patch: Partial<RecorderState> = {}): RecorderState {
  return {
    sessionId: 's1',
    status: 'READY',
    url: 'https://demo.example.com/login',
    title: '로그인',
    viewport: VIEWPORT,
    steps: [],
    screenshotVersion: 1,
    error: null,
    ...patch,
  };
}

function renderTab(props: Partial<React.ComponentProps<typeof RecorderTab>> = {}) {
  const handlers = { onSaved: vi.fn(), onOpenTests: vi.fn(), onRun: vi.fn() };
  const view = render(<RecorderTab project={project} {...handlers} {...props} />);
  return { ...view, ...handlers };
}

/** 녹화 시작을 눌러 READY 화면까지 간다. 아직 그리지 않았다면 기본 설정으로 먼저 그린다. */
async function startRecording(initial: RecorderState = state()) {
  if (!screen.queryByRole('button', { name: /녹화 시작/ })) renderTab();
  rec.start.mockResolvedValue(initial);
  fireEvent.click(screen.getByRole('button', { name: /녹화 시작/ }));
  await screen.findByAltText('원격 브라우저 화면');
  return screen.getByRole('group', { name: /원격 브라우저 화면/ });
}

beforeEach(() => {
  vi.clearAllMocks();
  rec.screenshot.mockResolvedValue(new Blob(['jpeg']));
  rec.close.mockResolvedValue(undefined);
  rec.code.mockResolvedValue({ specPath: 'tests/recorded/demo.spec.ts', code: '// code' });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    ...RECT,
    toJSON: () => RECT,
  });
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
  // jsdom 에는 없는 API (단계가 늘면 목록 맨 아래로 따라가는 데 쓴다)
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RecorderTab', () => {
  it('시작 화면: 설명 세 줄과 프로젝트 baseUrl 기본값이 보이고, 로그인 선행이 없으면 체크박스가 없다', () => {
    renderTab();
    expect(screen.getByText('화면을 클릭 · 입력하세요')).toBeTruthy();
    expect(screen.getByText('확인할 곳을 지정하세요')).toBeTruthy();
    expect(screen.getByText('저장하면 테스트 파일이 만들어져요')).toBeTruthy();
    expect((screen.getByLabelText('시작할 주소') as HTMLInputElement).value).toBe('https://demo.example.com');
    expect(screen.queryByText('로그인한 상태로 시작')).toBeNull();
  });

  it('로그인 선행 시나리오가 있으면 체크박스가 나오고, 체크하면 useLogin 으로 시작한다', async () => {
    renderTab({ project: { ...project, loginSetupSpecPath: 'tests/login.setup.ts' } });
    fireEvent.click(screen.getByLabelText(/로그인한 상태로 시작/));
    await startRecording();
    expect(rec.start).toHaveBeenCalledWith('p1', { url: 'https://demo.example.com', useLogin: true });
  });

  it('준비 중에는 안내 문구를 보여 주고, 준비가 끝나면 화면이 나온다', async () => {
    rec.start.mockResolvedValue(state({ status: 'STARTING' }));
    rec.get.mockResolvedValue(state({ status: 'READY' }));
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /녹화 시작/ }));

    await screen.findByText('브라우저를 준비하는 중… (처음에는 30초 정도)');
    await screen.findByAltText('원격 브라우저 화면', undefined, { timeout: 4000 });
    expect(rec.get).toHaveBeenCalledWith('p1', 's1');
  });

  it('시작에 실패(ERROR)하면 메시지와 다시 시도 버튼을 보여 준다', async () => {
    rec.start.mockResolvedValue(state({ status: 'ERROR', error: '컨테이너를 띄우지 못했습니다' }));
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /녹화 시작/ }));

    await screen.findByText('컨테이너를 띄우지 못했습니다');
    expect(screen.getByRole('button', { name: /다시 시도/ })).toBeTruthy();
  });

  it('화면을 누르면 표시 크기를 viewport 크기로 환산한 좌표로 click 동작을 보낸다', async () => {
    const screen_ = await startRecording();
    rec.act.mockResolvedValue(
      state({ steps: [step('a', { label: "'로그인' 버튼 클릭" })], screenshotVersion: 2 })
    );

    // (420, 250) → 그림 안 (320, 200) → 2배 → viewport (640, 400)
    fireEvent.click(screen_, { clientX: 420, clientY: 250 });

    await screen.findByText("'로그인' 버튼 클릭");
    expect(rec.act).toHaveBeenCalledWith('p1', 's1', { type: 'click', x: 640, y: 400 });
    // screenshotVersion 이 바뀌면 화면을 다시 받는다
    await waitFor(() => expect(rec.screenshot).toHaveBeenCalledTimes(2));
  });

  it('동작이 끝나기 전의 두 번째 클릭은 보내지 않는다 (중복 클릭 막기)', async () => {
    const screen_ = await startRecording();
    let finish: (value: RecorderState) => void = () => undefined;
    rec.act.mockReturnValue(new Promise<RecorderState>((resolve) => (finish = resolve)));

    // 한 번의 act 안에서 연달아 누르면 화면이 다시 그려지기 전이라 화면 쪽 가드는 아직 열려 있다.
    // 그래도 훅의 잠금(lockRef)이 두 번째 · 세 번째를 막아야 한다.
    act(() => {
      fireEvent.click(screen_, { clientX: 420, clientY: 250 });
      fireEvent.click(screen_, { clientX: 430, clientY: 260 });
      fireEvent.click(screen_, { clientX: 440, clientY: 270 });
    });

    expect(rec.act).toHaveBeenCalledTimes(1);
    expect(screen_.getAttribute('aria-busy')).toBe('true');

    finish(state({ steps: [step('a')] }));
    await waitFor(() => expect(screen_.getAttribute('aria-busy')).toBe('false'));

    // 끝난 뒤에는 다시 누를 수 있다
    rec.act.mockResolvedValue(state({ steps: [step('a'), step('b')] }));
    fireEvent.click(screen_, { clientX: 420, clientY: 250 });
    await waitFor(() => expect(rec.act).toHaveBeenCalledTimes(2));
  });

  it('마우스를 올리면 300ms 멈춘 뒤 한 번만 inspect 를 부르고 셀렉터를 보여 준다', async () => {
    const screen_ = await startRecording();
    rec.act.mockResolvedValue(
      state({
        inspected: {
          role: 'button',
          name: '로그인',
          selector: "getByRole('button', { name: '로그인' })",
          fragile: false,
          tag: 'button',
          box: { x: 600, y: 380, width: 100, height: 40 },
        },
      })
    );

    // 움직이는 동안(연속 이동)에는 부르지 않는다
    fireEvent.mouseMove(screen_, { clientX: 400, clientY: 240 });
    fireEvent.mouseMove(screen_, { clientX: 410, clientY: 245 });
    fireEvent.mouseMove(screen_, { clientX: 420, clientY: 250 });
    expect(rec.act).not.toHaveBeenCalled();

    await screen.findByText("getByRole('button', { name: '로그인' })");
    expect(rec.act).toHaveBeenCalledTimes(1);
    expect(rec.act).toHaveBeenCalledWith('p1', 's1', { type: 'inspect', x: 640, y: 400 });
  });

  it('입력 모드: 칸을 누르면 작은 창이 열리고 값을 fill 로 보낸다. 비밀번호 칸이면 환경변수 안내가 나온다', async () => {
    const screen_ = await startRecording();
    fireEvent.click(screen.getByRole('radio', { name: /입력/ }));

    // 마우스를 올려 어떤 칸인지 알아 둔다 (비밀번호 칸)
    rec.act.mockResolvedValueOnce(
      state({
        inspected: {
          role: null,
          name: '비밀번호',
          selector: "getByLabel('비밀번호')",
          fragile: false,
          tag: 'input',
          box: { x: 600, y: 380, width: 200, height: 40 },
        },
      })
    );
    fireEvent.mouseMove(screen_, { clientX: 420, clientY: 250 });
    await screen.findByText("getByLabel('비밀번호')");

    fireEvent.click(screen_, { clientX: 420, clientY: 250 });
    const input = (await screen.findByLabelText('입력할 값')) as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(screen.getByText(/^환경변수 LOGIN_PASSWORD 로 저장됩니다/)).toBeTruthy();
    // 입력창만 열었을 뿐 아직 서버로는 아무것도 보내지 않았다
    expect(rec.act).toHaveBeenCalledTimes(1);

    rec.act.mockResolvedValueOnce(
      state({ steps: [step('p', { action: 'fill', label: "'비밀번호' 칸에 입력", secretEnv: 'LOGIN_PASSWORD' })] })
    );
    fireEvent.change(input, { target: { value: 'pw-1234' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(rec.act).toHaveBeenLastCalledWith('p1', 's1', { type: 'fill', x: 640, y: 400, value: 'pw-1234' })
    );
    // 환경변수로 저장되는 입력은 단계 목록에 값이 아니라 환경변수 이름만 보인다
    await screen.findByText('환경변수 LOGIN_PASSWORD');
    expect(screen.queryByText(/pw-1234/)).toBeNull();
  });

  it('확인 모드: 글자 확인을 고르고 누르면 assertText 를 보낸다', async () => {
    const screen_ = await startRecording();
    fireEvent.click(screen.getByRole('radio', { name: /확인: 글자/ }));
    rec.act.mockResolvedValue(state());

    fireEvent.click(screen_, { clientX: 420, clientY: 250 });
    await waitFor(() =>
      expect(rec.act).toHaveBeenCalledWith('p1', 's1', { type: 'assertText', x: 640, y: 400 })
    );
  });

  it('주소 표시줄에 경로를 적고 이동하면 goto 를 보낸다', async () => {
    await startRecording();
    rec.act.mockResolvedValue(state({ url: 'https://demo.example.com/dashboard' }));

    const address = screen.getByLabelText('주소');
    fireEvent.change(address, { target: { value: '/dashboard' } });
    fireEvent.click(screen.getByRole('button', { name: '이동' }));

    await waitFor(() => expect(rec.act).toHaveBeenCalledWith('p1', 's1', { type: 'goto', url: '/dashboard' }));
  });

  it('단계를 지우면 남은 단계만 PUT steps 로 보낸다', async () => {
    await startRecording(state({ steps: [step('a'), step('b')] }));
    rec.putSteps.mockResolvedValue(state({ steps: [step('b')] }));

    fireEvent.click(screen.getAllByRole('button', { name: '삭제' })[0]);

    await waitFor(() =>
      expect(rec.putSteps).toHaveBeenCalledWith('p1', 's1', [expect.objectContaining({ id: 'b' })])
    );
    await waitFor(() => expect(screen.queryByText('단계 a')).toBeNull());
  });

  it('단계 순서를 바꾸면 바뀐 순서로 PUT steps 를 보낸다 (맨 위의 위로 버튼은 막혀 있다)', async () => {
    await startRecording(state({ steps: [step('a'), step('b')] }));
    rec.putSteps.mockResolvedValue(state({ steps: [step('b'), step('a')] }));

    expect((screen.getAllByRole('button', { name: '위로' })[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: '아래로' })[0]);

    await waitFor(() =>
      expect(rec.putSteps).toHaveBeenCalledWith('p1', 's1', [
        expect.objectContaining({ id: 'b' }),
        expect.objectContaining({ id: 'a' }),
      ])
    );
  });

  it('fragile 단계에는 순번 의존 경고 배지가 붙는다', async () => {
    await startRecording(state({ steps: [step('a', { fragile: true }), step('b')] }));
    expect(screen.getAllByText('순번 의존')).toHaveLength(1);
  });

  it('저장: 같은 경로가 있으면(409) 안내하고, 경로를 바꿔 저장하면 보기 · 바로 실행이 나온다', async () => {
    const { onSaved, onOpenTests, onRun } = renderTab();
    await startRecording(state({ steps: [step('a')] }));

    // 첫 단계가 생기면 서버가 제안한 경로가 채워진다
    const pathInput = (await screen.findByPlaceholderText('tests/recorded/login.spec.ts')) as HTMLInputElement;
    await waitFor(() => expect(pathInput.value).toBe('tests/recorded/demo.spec.ts'));

    rec.save.mockRejectedValueOnce(new ApiError('exists', 409));
    fireEvent.change(screen.getByPlaceholderText('예: 로그인하면 대시보드가 보인다'), {
      target: { value: '로그인 확인' },
    });
    fireEvent.click(screen.getByRole('button', { name: /저장$/ }));
    await screen.findByText('같은 경로에 이미 파일이 있어요. 경로를 바꿔서 다시 저장해 주세요.');
    expect(onSaved).not.toHaveBeenCalled();

    rec.save.mockResolvedValueOnce({ specPath: 'tests/recorded/login-2.spec.ts' });
    fireEvent.change(pathInput, { target: { value: 'tests/recorded/login-2' } });
    fireEvent.click(screen.getByRole('button', { name: /저장$/ }));

    await screen.findByText('테스트 파일로 저장했어요');
    // .spec.ts 를 붙여 다듬은 경로와 이름을 보냈다
    expect(rec.save).toHaveBeenLastCalledWith('p1', 's1', {
      specPath: 'tests/recorded/login-2.spec.ts',
      title: '로그인 확인',
    });
    expect(onSaved).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '테스트 탭에서 보기' }));
    expect(onOpenTests).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /바로 실행/ }));
    expect(onRun).toHaveBeenCalledWith('tests/recorded/login-2.spec.ts', '로그인 확인');
  });

  it('코드 보기: 만들어진 코드를 모달에 보여 준다', async () => {
    await startRecording(state({ steps: [step('a')] }));
    rec.code.mockResolvedValue({ specPath: 'tests/recorded/demo.spec.ts', code: "await page.goto('/login');" });

    fireEvent.click(screen.getByRole('button', { name: /코드 보기/ }));
    await screen.findByText("await page.goto('/login');");
    expect(screen.getByText('만들어진 테스트 코드')).toBeTruthy();
  });

  it('녹화 끝내기: 저장하지 않은 단계가 있으면 확인을 받고, 취소하면 세션을 유지한다', async () => {
    await startRecording(state({ steps: [step('a')] }));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    fireEvent.click(screen.getByRole('button', { name: /녹화 끝내기/ }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(rec.close).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /녹화 끝내기/ }));
    await waitFor(() => expect(rec.close).toHaveBeenCalledWith('p1', 's1'));
    await screen.findByRole('button', { name: /녹화 시작/ });
  });

  it('서버에서 세션이 사라지면(404) 끝났다는 안내와 새로 시작 버튼을 보여 준다', async () => {
    const screen_ = await startRecording();
    rec.act.mockRejectedValue(new ApiError('not found', 404));

    fireEvent.click(screen_, { clientX: 420, clientY: 250 });
    await screen.findByRole('button', { name: /새로 시작/ });
  });

  it('화면을 떠나면(언마운트) 세션을 끝낸다', async () => {
    const { unmount } = renderTab();
    await startRecording();

    unmount();
    expect(rec.closeOnLeave).toHaveBeenCalledWith('p1', 's1');
  });

  it('창을 닫을 때(beforeunload)도 세션을 끝내고, 이후 언마운트에서 한 번 더 보내지 않는다', async () => {
    const { unmount } = renderTab();
    await startRecording();

    window.dispatchEvent(new Event('beforeunload'));
    expect(rec.closeOnLeave).toHaveBeenCalledTimes(1);
    unmount();
    expect(rec.closeOnLeave).toHaveBeenCalledTimes(1);
  });
});
