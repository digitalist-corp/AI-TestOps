// PlayOps 단계 기록 리포터 (#84). Playwright JSON 리포터는 test.step 만 남겨서 클릭 · 입력 · 이동 · 확인 단계를 따로 모은다.
// PLAYOPS_STEPS_OUTPUT 파일에 [{ file, titlePath, status, attachments, steps: [{ category, title, code, error, offsetMs }] }] 를 쓴다.
// code: expect 단계의 소스 한 줄 (expect 제목에는 대상이 없다). 입력값 중 비밀번호류는 여기서 가린다.
// offsetMs: 테스트 시작부터 그 단계까지 (영상을 그 시점부터 보여 주려고, #85).
// attachments: 스크린샷 · 영상의 리포트 폴더 안 경로 (실행 스크립트가 test-results 를 리포트 폴더로 복사한다).
// 이 리포터가 실패해도 테스트 결과에는 영향을 주지 않는다.
const fs = require('fs');
const path = require('path');

const KEEP = new Set(['pw:api', 'expect', 'test.step']);
const MASK = '****';
// 이름의 한 마디가 비밀번호류인 환경변수 (LOGIN_PASSWORD · API_KEY · DB_PW). 셸의 PWD · OLDPWD(작업 폴더)는 뺀다.
const SECRET_KEY = /(^|_)(PASSWORD|PASSWD|PASS|PWD|PW|SECRET|TOKEN|KEY)(_|$)/i;
const NOT_SECRET = new Set(['PWD', 'OLDPWD']);
const SECRET_TARGET = /pass|pwd|비밀번호|암호/i;

const secrets = Object.entries(process.env)
  .filter(([k, v]) => SECRET_KEY.test(k) && !NOT_SECRET.has(k.toUpperCase()) && v && v.length >= 4)
  .map(([, v]) => v);

const lines = new Map();
function codeAt(location) {
  if (!location || !location.file) return null;
  try {
    if (!lines.has(location.file)) lines.set(location.file, fs.readFileSync(location.file, 'utf8').split('\n'));
    const line = lines.get(location.file)[location.line - 1];
    return line ? line.trim().slice(0, 300) : null;
  } catch (e) {
    return null;
  }
}

/** Fill "값" 대상 — 비밀번호 입력란이거나 비밀 환경변수 값이면 값을 가린다. */
function mask(title) {
  const m = /^(Fill|Type) "([\s\S]*)" (.+)$/.exec(title);
  if (m && (SECRET_TARGET.test(m[3]) || secrets.includes(m[2]))) return `${m[1]} "${MASK}" ${m[3]}`;
  return secrets.reduce((t, s) => t.split(s).join(MASK), title);
}

function flat(steps, start, out) {
  for (const s of steps || []) {
    if (KEEP.has(s.category)) {
      out.push({
        category: s.category,
        title: mask(s.title),
        code: s.category === 'expect' ? codeAt(s.location) : null,
        error: s.error ? mask(String(s.error.message || '')).slice(0, 1000) : null,
        offsetMs: s.startTime && start ? Math.max(0, s.startTime.getTime() - start.getTime()) : null,
      });
    }
    // test.step 안의 클릭 등은 순서대로 편다. 브라우저 준비(hook · fixture)와 expect · API 내부 호출은 뺀다.
    if (s.category === 'test.step') flat(s.steps, start, out);
  }
  return out;
}

/** 리포트 폴더로 복사되는 test-results 안의 첨부만 그 안 경로로 남긴다. */
function attachmentsOf(result, outputDir) {
  if (!outputDir || path.basename(outputDir) !== 'test-results') return [];
  return (result.attachments || [])
    .filter((a) => a.path && a.path.startsWith(outputDir + path.sep))
    .map((a) => ({
      name: a.name,
      contentType: a.contentType,
      path: 'test-results/' + path.relative(outputDir, a.path).split(path.sep).join('/'),
    }));
}

class StepsReporter {
  constructor() {
    this.cases = [];
  }

  onTestEnd(test, result) {
    try {
      const project = test.parent.project();
      const testDir = (project && project.testDir) || process.cwd();
      this.cases.push({
        file: path.relative(testDir, test.location.file).split(path.sep).join('/'),
        titlePath: test.titlePath().filter(Boolean),
        status: result.status,
        attachments: attachmentsOf(result, project && project.outputDir),
        steps: flat(result.steps, result.startTime, []),
      });
    } catch (e) {
      // 기록 실패는 무시한다.
    }
  }

  onEnd() {
    const out = process.env.PLAYOPS_STEPS_OUTPUT;
    if (!out) return;
    try {
      fs.writeFileSync(out, JSON.stringify(this.cases));
    } catch (e) {
      // 기록 실패는 무시한다.
    }
  }

  printsToStdio() {
    return false;
  }
}

module.exports = StepsReporter;
