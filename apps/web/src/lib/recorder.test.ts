import { describe, expect, it } from 'vitest';
import type { RecordedStep, RecorderInspected } from '@/types';
import {
  RECORDER_MODES,
  RECORDER_TOTAL_LIMIT,
  boxContains,
  boxToPercent,
  canEditValue,
  checkSpecPath,
  describeStepValue,
  editStep,
  hasRecordedWork,
  hasScreen,
  isSelectField,
  looksLikePasswordField,
  moveStep,
  normalizeGotoInput,
  normalizeWheelDelta,
  pointToPercent,
  pollIntervalMs,
  recorderErrorMessage,
  removeStep,
  renameStep,
  resolveStartUrl,
  stepIconKey,
  stepKindLabel,
  stepsSignature,
  toViewportPoint,
  valueFieldLabel,
} from './recorder';

const VIEWPORT = { width: 1280, height: 800 };

function step(id: string, patch: Partial<RecordedStep> = {}): RecordedStep {
  return {
    id,
    action: 'click',
    selector: `getByTestId('${id}')`,
    fragile: false,
    label: `단계 ${id}`,
    url: 'https://example.com/',
    ...patch,
  };
}

describe('toViewportPoint', () => {
  it('표시 크기와 viewport 가 같으면 좌표가 그대로다', () => {
    const rect = { left: 0, top: 0, width: 1280, height: 800 };
    expect(toViewportPoint({ x: 100, y: 50 }, rect, VIEWPORT)).toEqual({ x: 100, y: 50 });
  });

  it('줄어들어 보이는 화면(절반)이면 좌표를 두 배로 환산한다', () => {
    const rect = { left: 0, top: 0, width: 640, height: 400 };
    expect(toViewportPoint({ x: 320, y: 200 }, rect, VIEWPORT)).toEqual({ x: 640, y: 400 });
  });

  it('그림의 왼쪽 위 모서리(left/top)를 뺀 위치로 계산한다', () => {
    const rect = { left: 200, top: 120, width: 640, height: 400 };
    expect(toViewportPoint({ x: 200 + 64, y: 120 + 40 }, rect, VIEWPORT)).toEqual({ x: 128, y: 80 });
  });

  it('늘어나 보이는 화면이면 좌표를 줄여 환산하고 반올림한다', () => {
    const rect = { left: 0, top: 0, width: 2560, height: 1600 };
    // 1001 → 500.5, 3 → 1.5: 정확히 반이면 올린다
    expect(toViewportPoint({ x: 1001, y: 3 }, rect, VIEWPORT)).toEqual({ x: 501, y: 2 });
    expect(toViewportPoint({ x: 1000, y: 2 }, rect, VIEWPORT)).toEqual({ x: 500, y: 1 });
  });

  it('오른쪽 · 아래 끝은 viewport 안쪽 마지막 픽셀로 맞춘다', () => {
    const rect = { left: 0, top: 0, width: 640, height: 400 };
    expect(toViewportPoint({ x: 640, y: 400 }, rect, VIEWPORT)).toEqual({ x: 1279, y: 799 });
  });

  it('그림 밖이면 null', () => {
    const rect = { left: 100, top: 100, width: 640, height: 400 };
    expect(toViewportPoint({ x: 99, y: 150 }, rect, VIEWPORT)).toBeNull();
    expect(toViewportPoint({ x: 150, y: 501 }, rect, VIEWPORT)).toBeNull();
  });

  it('크기를 알 수 없으면 null (0 으로 나누지 않는다)', () => {
    expect(toViewportPoint({ x: 1, y: 1 }, { left: 0, top: 0, width: 0, height: 0 }, VIEWPORT)).toBeNull();
    expect(
      toViewportPoint({ x: 1, y: 1 }, { left: 0, top: 0, width: 640, height: 400 }, { width: 0, height: 0 })
    ).toBeNull();
  });
});

describe('boxToPercent · pointToPercent', () => {
  it('viewport 좌표를 퍼센트로 바꿔 그림 크기와 상관없이 겹쳐 그린다', () => {
    expect(boxToPercent({ x: 640, y: 400, width: 128, height: 80 }, VIEWPORT)).toEqual({
      left: '50%',
      top: '50%',
      width: '10%',
      height: '10%',
    });
  });

  it('한 점도 퍼센트 위치로 바꾼다', () => {
    expect(pointToPercent({ x: 320, y: 200 }, VIEWPORT)).toEqual({ left: '25%', top: '25%' });
  });
});

describe('boxContains', () => {
  const box = { x: 100, y: 50, width: 200, height: 40 };

  it('상자 안(가장자리 포함)이면 true, 밖이면 false', () => {
    expect(boxContains(box, { x: 100, y: 50 })).toBe(true);
    expect(boxContains(box, { x: 300, y: 90 })).toBe(true);
    expect(boxContains(box, { x: 99, y: 60 })).toBe(false);
    expect(boxContains(box, { x: 150, y: 91 })).toBe(false);
  });
});

describe('RECORDER_MODES', () => {
  it('첫 모드가 기본인 클릭이고, 모든 모드에 안내 문구가 있다', () => {
    expect(RECORDER_MODES[0].id).toBe('click');
    expect(RECORDER_MODES.map((m) => m.id)).toEqual(['click', 'fill', 'assertVisible', 'assertText']);
    expect(RECORDER_MODES.every((m) => m.label && m.hint)).toBe(true);
  });
});

describe('normalizeWheelDelta', () => {
  it('픽셀 단위는 그대로, 줄 단위는 16배, 쪽 단위는 화면 높이배', () => {
    expect(normalizeWheelDelta(100, 0, 800)).toBe(100);
    expect(normalizeWheelDelta(3, 1, 800)).toBe(48);
    expect(normalizeWheelDelta(1, 2, 800)).toBe(800);
  });
});

describe('단계 이동 · 삭제 · 이름 수정', () => {
  const steps = [step('a'), step('b'), step('c')];

  it('moveStep: 한 칸 위로 · 아래로 옮긴다', () => {
    expect(moveStep(steps, 'b', -1).map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(moveStep(steps, 'b', 1).map((s) => s.id)).toEqual(['a', 'c', 'b']);
  });

  it('moveStep: 원본 배열은 바꾸지 않는다', () => {
    moveStep(steps, 'a', 1);
    expect(steps.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('moveStep: 맨 위를 위로, 맨 아래를 아래로 옮기거나 없는 id 면 같은 배열을 돌려준다', () => {
    expect(moveStep(steps, 'a', -1)).toBe(steps);
    expect(moveStep(steps, 'c', 1)).toBe(steps);
    expect(moveStep(steps, 'zzz', 1)).toBe(steps);
  });

  it('removeStep: 해당 단계만 지운다', () => {
    expect(removeStep(steps, 'b').map((s) => s.id)).toEqual(['a', 'c']);
    expect(removeStep(steps, 'zzz')).toBe(steps);
  });

  it('renameStep: label 을 다듬어 바꾸고, 다른 단계는 그대로 둔다', () => {
    const next = renameStep(steps, 'b', '  로그인 버튼 누르기  ');
    expect(next.find((s) => s.id === 'b')?.label).toBe('로그인 버튼 누르기');
    expect(next.find((s) => s.id === 'a')).toBe(steps[0]);
  });

  it('renameStep: 비었거나 그대로거나 없는 id 면 같은 배열을 돌려준다', () => {
    expect(renameStep(steps, 'b', '   ')).toBe(steps);
    expect(renameStep(steps, 'b', '단계 b')).toBe(steps);
    expect(renameStep(steps, 'zzz', '새 이름')).toBe(steps);
  });

  it('editStep: 값(value)도 함께 고친다 — 입력 · 키 · 글자 확인 · 이동', () => {
    const list = [
      step('f', { action: 'fill', value: 'old' }),
      step('k', { action: 'press', value: 'Enter' }),
      step('t', { action: 'assertText', value: '환영합니다' }),
      step('g', { action: 'goto', value: '/login' }),
    ];
    expect(editStep(list, 'f', { value: 'new' })[0].value).toBe('new');
    expect(editStep(list, 'k', { value: 'Tab' })[1].value).toBe('Tab');
    expect(editStep(list, 't', { value: '안녕하세요' })[2].value).toBe('안녕하세요');
    expect(editStep(list, 'g', { value: ' /signup ' })[3].value).toBe('/signup');
  });

  it('editStep: label 과 value 를 한 번에 고치고, 고치지 않은 필드(셀렉터 등)는 그대로 둔다', () => {
    const list = [step('f', { action: 'fill', value: 'old', selector: "getByLabel('이메일')" })];
    const [next] = editStep(list, 'f', { label: ' 이메일 입력 ', value: 'a@b.com' });
    expect(next).toMatchObject({ label: '이메일 입력', value: 'a@b.com', selector: "getByLabel('이메일')" });
  });

  it('editStep: 입력(fill)은 빈 값도 되지만, 키 · 글자 확인 · 이동은 빈 값을 무시한다', () => {
    const list = [
      step('f', { action: 'fill', value: 'x' }),
      step('k', { action: 'press', value: 'Enter' }),
      step('t', { action: 'assertText', value: '글자' }),
      step('g', { action: 'goto', value: '/a' }),
    ];
    expect(editStep(list, 'f', { value: '' })[0].value).toBe('');
    expect(editStep(list, 'k', { value: '  ' })).toBe(list);
    expect(editStep(list, 't', { value: '' })).toBe(list);
    expect(editStep(list, 'g', { value: '' })).toBe(list);
  });

  it('editStep: 비밀번호(secretEnv) 단계와 값이 없는 동작은 value 를 고치지 않는다', () => {
    const list = [
      step('p', { action: 'fill', secretEnv: 'LOGIN_PASSWORD' }),
      step('c', { action: 'click' }),
    ];
    expect(editStep(list, 'p', { value: 'hunter2' })).toBe(list);
    expect(editStep(list, 'c', { value: 'x' })).toBe(list);
    // label 은 비밀번호 단계도 고칠 수 있다
    expect(editStep(list, 'p', { label: '비밀번호 입력' })[0].label).toBe('비밀번호 입력');
    expect(editStep(list, 'p', { value: 'hunter2' })[0].value).toBeUndefined();
  });

  it('editStep: 바뀐 게 없으면 같은 배열을 돌려준다', () => {
    const list = [step('f', { action: 'fill', value: 'same' })];
    expect(editStep(list, 'f', { label: '단계 f', value: 'same' })).toBe(list);
    expect(editStep(list, 'zzz', { label: 'x' })).toBe(list);
    expect(editStep(list, 'f', {})).toBe(list);
  });

  it('canEditValue · valueFieldLabel: 값이 있는 동작만, 비밀번호 단계는 제외', () => {
    expect(canEditValue(step('1', { action: 'fill', value: 'x' }))).toBe(true);
    expect(canEditValue(step('2', { action: 'press', value: 'Enter' }))).toBe(true);
    expect(canEditValue(step('3', { action: 'assertText', value: 'x' }))).toBe(true);
    expect(canEditValue(step('4', { action: 'goto', value: '/' }))).toBe(true);
    expect(canEditValue(step('5', { action: 'click' }))).toBe(false);
    expect(canEditValue(step('6', { action: 'assertVisible' }))).toBe(false);
    expect(canEditValue(step('7', { action: 'fill', secretEnv: 'LOGIN_PASSWORD' }))).toBe(false);

    expect(valueFieldLabel(step('1', { action: 'fill' }))).toBe('입력할 값');
    expect(valueFieldLabel(step('2', { action: 'press' }))).toBe('누를 키');
    expect(valueFieldLabel(step('3', { action: 'assertText' }))).toBe('기대하는 글자');
    expect(valueFieldLabel(step('4', { action: 'goto' }))).toBe('이동할 주소');
    expect(valueFieldLabel(step('5', { action: 'click' }))).toBeNull();
    expect(valueFieldLabel(step('6', { action: 'fill', secretEnv: 'LOGIN_PASSWORD' }))).toBeNull();
  });

  it('hasRecordedWork: 서버가 자동으로 붙인 첫 goto 만 있으면 사람이 한 일이 없다', () => {
    expect(hasRecordedWork([])).toBe(false);
    expect(hasRecordedWork([step('g', { action: 'goto', value: '/' })])).toBe(false);
    expect(hasRecordedWork([step('g', { action: 'goto', value: '/' }), step('c')])).toBe(true);
  });

  it('stepsSignature: 순서나 설명이 바뀌면 달라지고, 같으면 같다', () => {
    expect(stepsSignature(steps)).toBe(stepsSignature([step('a'), step('b'), step('c')]));
    expect(stepsSignature(steps)).not.toBe(stepsSignature(moveStep(steps, 'a', 1)));
    expect(stepsSignature(steps)).not.toBe(stepsSignature(renameStep(steps, 'a', '다른 이름')));
    expect(stepsSignature(steps)).not.toBe(stepsSignature(removeStep(steps, 'c')));
  });

  it('stepsSignature: 값만 고쳐도 달라진다', () => {
    const list = [step('f', { action: 'fill', value: 'old' })];
    expect(stepsSignature(list)).not.toBe(stepsSignature(editStep(list, 'f', { value: 'new' })));
  });
});

describe('단계 → 아이콘 · 설명', () => {
  it('동작마다 아이콘 이름과 한글 종류가 정해져 있다', () => {
    expect(stepIconKey({ action: 'goto' })).toBe('globe');
    expect(stepIconKey({ action: 'click' })).toBe('click');
    expect(stepIconKey({ action: 'fill' })).toBe('input');
    expect(stepIconKey({ action: 'press' })).toBe('key');
    expect(stepIconKey({ action: 'assertVisible' })).toBe('eye');
    expect(stepIconKey({ action: 'assertText' })).toBe('text');
    expect(stepKindLabel({ action: 'assertVisible' })).toBe('보이는지 확인');
    expect(stepKindLabel({ action: 'assertText' })).toBe('글자 확인');
  });

  it('describeStepValue: 동작별로 값을 짧게 설명한다', () => {
    expect(describeStepValue(step('1', { action: 'goto', value: '/login' }))).toBe('/login');
    expect(describeStepValue(step('2', { action: 'fill', value: 'user@example.com' }))).toBe(
      '값: user@example.com'
    );
    expect(describeStepValue(step('3', { action: 'press', value: 'Enter' }))).toBe('키: Enter');
    expect(describeStepValue(step('4', { action: 'assertText', value: '환영합니다' }))).toBe(
      '기대 글자: 환영합니다'
    );
    expect(describeStepValue(step('5', { action: 'click' }))).toBeNull();
    expect(describeStepValue(step('6', { action: 'assertVisible' }))).toBeNull();
  });

  it('describeStepValue: 긴 값은 줄인다', () => {
    const text = describeStepValue(step('1', { action: 'fill', value: 'a'.repeat(100) }));
    expect(text?.endsWith('…')).toBe(true);
    expect(text!.length).toBeLessThan(70);
  });

  it('describeStepValue: 환경변수로 저장되는 입력은 값이 있어도 보여주지 않는다', () => {
    const text = describeStepValue(
      step('1', { action: 'fill', value: 'super-secret', secretEnv: 'LOGIN_PASSWORD' })
    );
    expect(text).toBe('환경변수 LOGIN_PASSWORD');
    expect(text).not.toContain('super-secret');
  });
});

describe('상태', () => {
  it('준비 중 · 동작 중은 자주, 평소(READY)는 가끔, 끝난 뒤에는 묻지 않는다', () => {
    expect(pollIntervalMs('STARTING')).toBe(1000);
    expect(pollIntervalMs('BUSY')).toBe(1000);
    expect(pollIntervalMs('READY')).toBe(10_000);
    expect(pollIntervalMs('CLOSED')).toBe(0);
    expect(pollIntervalMs('ERROR')).toBe(0);
  });

  it('READY · BUSY 에서만 화면을 보여줄 수 있다', () => {
    expect(hasScreen('READY')).toBe(true);
    expect(hasScreen('BUSY')).toBe(true);
    expect(hasScreen('STARTING')).toBe(false);
    expect(hasScreen('ERROR')).toBe(false);
  });
});

describe('looksLikePasswordField', () => {
  const box = { x: 0, y: 0, width: 10, height: 10 };
  function inspected(patch: Partial<RecorderInspected>): RecorderInspected {
    return { role: null, name: null, selector: null, fragile: false, tag: 'input', box, ...patch };
  }

  it('입력란이면서 이름이나 셀렉터에 비밀번호 단서가 있으면 true', () => {
    expect(looksLikePasswordField(inspected({ name: '비밀번호' }))).toBe(true);
    expect(looksLikePasswordField(inspected({ selector: "getByLabel('Password')" }))).toBe(true);
    expect(looksLikePasswordField(inspected({ selector: "getByPlaceholder('PWD')" }))).toBe(true);
  });

  it('다른 입력란이나 입력란이 아닌 요소는 false', () => {
    expect(looksLikePasswordField(inspected({ name: '이메일' }))).toBe(false);
    expect(looksLikePasswordField(inspected({ tag: 'button', name: '비밀번호 찾기' }))).toBe(false);
    expect(looksLikePasswordField(null)).toBe(false);
    expect(looksLikePasswordField(undefined)).toBe(false);
  });
});

describe('isSelectField', () => {
  const box = { x: 0, y: 0, width: 10, height: 10 };
  const inspected = (tag: string): RecorderInspected => ({
    role: 'combobox',
    name: '언어',
    selector: "getByLabel('언어')",
    fragile: false,
    tag,
    box,
  });

  it('select 요소만 true (대소문자 무관)', () => {
    expect(isSelectField(inspected('select'))).toBe(true);
    expect(isSelectField(inspected('SELECT'))).toBe(true);
    expect(isSelectField(inspected('input'))).toBe(false);
    expect(isSelectField(null)).toBe(false);
  });
});

describe('normalizeGotoInput', () => {
  it('절대 주소 · 경로는 그대로', () => {
    expect(normalizeGotoInput('https://a.com/x')).toBe('https://a.com/x');
    expect(normalizeGotoInput('  /login  ')).toBe('/login');
  });

  it('도메인이면 https:// 를 붙이고, 한 단어는 경로로 본다', () => {
    expect(normalizeGotoInput('example.com/x')).toBe('https://example.com/x');
    expect(normalizeGotoInput('localhost:3000/app')).toBe('https://localhost:3000/app');
    expect(normalizeGotoInput('login')).toBe('/login');
  });

  it('비었거나 공백이 섞여 있으면 null', () => {
    expect(normalizeGotoInput('   ')).toBeNull();
    expect(normalizeGotoInput('not a url')).toBeNull();
  });
});

describe('resolveStartUrl', () => {
  it('비우면 프로젝트 baseUrl, 둘 다 없으면 null', () => {
    expect(resolveStartUrl('', 'https://app.example.com')).toBe('https://app.example.com');
    expect(resolveStartUrl('  ', null)).toBeNull();
  });

  it('절대 주소는 그대로, 경로만 적으면 baseUrl 출처에 붙인다', () => {
    expect(resolveStartUrl('https://other.com/a', 'https://app.example.com')).toBe('https://other.com/a');
    expect(resolveStartUrl('/login', 'https://app.example.com/base')).toBe('https://app.example.com/login');
  });

  it('경로만 있는데 baseUrl 이 없으면 null', () => {
    expect(resolveStartUrl('/login', null)).toBeNull();
  });
});

describe('checkSpecPath', () => {
  const ok = (path: string) => ({ ok: true, path });

  it('.spec.ts · .spec.js · .test.ts · .test.js 로 끝나는 경로는 통과한다', () => {
    expect(checkSpecPath('tests/recorded/login.spec.ts')).toEqual(ok('tests/recorded/login.spec.ts'));
    expect(checkSpecPath('tests/a.spec.js')).toEqual(ok('tests/a.spec.js'));
    expect(checkSpecPath('tests/a.test.ts')).toEqual(ok('tests/a.test.ts'));
    expect(checkSpecPath('tests/a.test.js')).toEqual(ok('tests/a.test.js'));
  });

  it('역슬래시 · 앞뒤 공백 · 앞의 ./ 는 다듬는다', () => {
    expect(checkSpecPath('  .\\tests\\recorded\\a.spec.ts ')).toEqual(ok('tests/recorded/a.spec.ts'));
    expect(checkSpecPath('./tests/a.spec.ts')).toEqual(ok('tests/a.spec.ts'));
  });

  it('확장자가 맞지 않으면 이유를 알려 준다 (자동으로 붙이지 않는다)', () => {
    for (const bad of ['tests/login', 'tests/login.ts', 'tests/login.txt', 'tests/login.spec', 'tests/.spec.ts.bak']) {
      const result = checkSpecPath(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('.spec.ts');
    }
  });

  it('파일 이름 없이 확장자만 있는 경로는 막는다 (서버 규칙: 앞에 한 글자 이상)', () => {
    expect(checkSpecPath('tests/.spec.ts').ok).toBe(true); // 'tests/' 가 앞 글자라 서버도 통과시킨다
    expect(checkSpecPath('.spec.ts').ok).toBe(false);
  });

  it('비었거나 /, 드라이브, .., // 가 들어 있으면 막는다', () => {
    expect(checkSpecPath('   ')).toMatchObject({ ok: false, error: '저장 경로를 적어 주세요.' });
    expect(checkSpecPath('/tests/a.spec.ts').ok).toBe(false);
    expect(checkSpecPath('C:\\tests\\a.spec.ts').ok).toBe(false);
    expect(checkSpecPath('../a.spec.ts').ok).toBe(false);
    expect(checkSpecPath('tests/../a.spec.ts').ok).toBe(false);
    expect(checkSpecPath('tests//a.spec.ts').ok).toBe(false);
  });

  it('300자를 넘으면 막는다', () => {
    expect(checkSpecPath(`${'a'.repeat(300)}.spec.ts`).ok).toBe(false);
  });
});

describe('recorderErrorMessage', () => {
  it('서버 코드별로 정해 둔 안내 문구를 쓴다', () => {
    expect(recorderErrorMessage({ status: 409, code: 'RECORDER_LIMIT', message: 'x' }, 'f')).toContain(
      `${RECORDER_TOTAL_LIMIT}개`
    );
    expect(recorderErrorMessage({ status: 409, code: 'RECORDER_CLOSED' }, 'f')).toContain('녹화가 끝났어요');
    expect(recorderErrorMessage({ status: 409, code: 'RECORDER_STARTING' }, 'f')).toContain('준비하고 있어요');
    expect(recorderErrorMessage({ status: 503, code: 'RECORDER_UNAVAILABLE' }, 'f')).toContain('Docker');
    expect(recorderErrorMessage({ status: 404, code: 'RECORDER_SESSION_NOT_FOUND' }, 'f')).toContain('찾을 수 없어요');
    expect(recorderErrorMessage({ status: 409, code: 'FILE_EXISTS' }, 'f')).toContain('같은 경로');
  });

  it('코드마다 문구가 서로 다르다', () => {
    const codes = ['RECORDER_LIMIT', 'RECORDER_CLOSED', 'RECORDER_STARTING', 'RECORDER_UNAVAILABLE'];
    const messages = codes.map((code) => recorderErrorMessage({ code }, 'f'));
    expect(new Set(messages).size).toBe(codes.length);
  });

  it('502 는 통신 문제로 안내하고 서버 메시지를 덧붙인다', () => {
    const text = recorderErrorMessage({ status: 502, code: 'UPSTREAM_ERROR', message: '연결 거부' }, 'f');
    expect(text).toContain('통신하지 못했어요');
    expect(text).toContain('연결 거부');
  });

  it('모르는 코드는 서버 메시지를, 메시지도 없으면 fallback 을 쓴다', () => {
    expect(recorderErrorMessage({ status: 400, code: 'PATH_NOT_ALLOWED', message: '저장할 수 없는 경로' }, 'f')).toBe(
      '저장할 수 없는 경로'
    );
    expect(recorderErrorMessage(new Error('네트워크 오류'), 'f')).toBe('네트워크 오류');
    expect(recorderErrorMessage({}, '기본 문구')).toBe('기본 문구');
    expect(recorderErrorMessage(null, '기본 문구')).toBe('기본 문구');
  });
});
