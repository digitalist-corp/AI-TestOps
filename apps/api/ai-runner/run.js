// PlayOps AI Runner — CODE_FIX.
// docs/ai-job-spec.md의 job.json/result.json 계약을 따르되, 이번에도 unified diff가 아니라
// 파일별 "새 내용 전체"로 주고받는다 (diff 라이브러리 없이 시작하기 위한 의도적 단순화).
// v1은 targetSpecPath 딱 하나만 고칠 수 있었지만, 실패한 테스트를 고치려면 그 spec이 import하는
// 로컬 헬퍼/픽스처 파일까지 함께 손봐야 하는 경우가 많아 "관련 파일"까지 보여주고 필요하면
// 그 파일들도 같이 고칠 수 있게 확장했다 (JSON 멀티파일 응답 프로토콜).
// api는 "docker run --rm"이 끝날 때까지 블로킹해서 기다리므로, 별도 완료 콜백 없이
// 컨테이너 종료 후 공유 볼륨의 result.json을 바로 읽는다.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const jobFile = process.env.AI_JOB_FILE;
const resultDir = process.env.AI_JOB_RESULT_DIR;
const proxyUrl = process.env.PLAYOPS_LLM_PROXY_URL;
const token = process.env.PLAYOPS_CALLBACK_TOKEN;

// AiRunnerDockerService가 `docker run -w <프로젝트 경로>`로 작업 디렉터리를 이미 프로젝트 루트에
// 맞춰주므로(Windows/Linux 호스트에 따라 실제 절대경로가 다름), 하드코딩된 경로 대신 그 값을 그대로 쓴다.
// 예전엔 '/workspace'로 하드코딩되어 있었는데, 실제 마운트 경로(/playwright-projects/{projectId})와
// 달라 파일을 전혀 찾지 못하는 버그가 있었다.
const WORKSPACE = process.cwd();
const MAX_RELATED_FILES = 5;
const MAX_RELATED_FILE_CHARS = 8000;
const IMPORT_PATTERN = /(?:from\s+|require\()\s*['"](\.[^'"]+)['"]/g;
const CANDIDATE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

function writeResult(result) {
  fs.mkdirSync(resultDir, { recursive: true });
  fs.writeFileSync(path.join(resultDir, 'result.json'), JSON.stringify(result, null, 2));
}

async function callLlm(systemPrompt, userPrompt) {
  const res = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ systemPrompt, userPrompt }),
  });
  if (!res.ok) {
    throw new Error(`LLM 프록시 호출 실패: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.content || '';
}

function stripMarkdownFence(raw) {
  let trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    trimmed = trimmed.replace(/^```[a-zA-Z]*\n?/, '');
    if (trimmed.endsWith('```')) {
      trimmed = trimmed.slice(0, -3);
    }
  }
  return trimmed.trim();
}

/**
 * 에디터 "AI 수정 도움"의 실행 검증 전용 — LLM 호출도, 반복도 없이 제안된 파일 내용을
 * 딱 한 번 spec에 대해 돌려보고 pass/fail+로그만 돌려준다. CODE_FIX와 마찬가지로 실제 파일은
 * 검증 끝나면 항상 원본으로 복원한다(diff 검토 절차를 우회하지 않기 위함).
 */
function runEditAssistVerify(job) {
  const overrides = job.files || [];
  const originals = {};
  try {
    for (const f of overrides) {
      const fullPath = path.join(WORKSPACE, f.path);
      originals[f.path] = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : null;
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, f.content, 'utf-8');
    }
    const runResult = runPlaywright(job.specPath);
    writeResult({
      status: 'VERIFIED',
      passed: runResult.passed,
      output: runResult.output.slice(-8000),
    });
  } finally {
    for (const [relPath, content] of Object.entries(originals)) {
      try {
        const fullPath = path.join(WORKSPACE, relPath);
        if (content === null) {
          fs.unlinkSync(fullPath);
        } else {
          fs.writeFileSync(fullPath, content, 'utf-8');
        }
      } catch (e) {
        console.error(`원본 복원 실패 (${relPath}):`, e);
      }
    }
  }
}

function runPlaywright(specPath) {
  try {
    const output = execFileSync('npx', ['playwright', 'test', specPath], {
      cwd: WORKSPACE,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { passed: true, output };
  } catch (e) {
    return { passed: false, output: (e.stdout || '') + (e.stderr || '') };
  }
}

/** targetSpecPath가 상대 경로로 import하는 로컬 파일을 최대 MAX_RELATED_FILES개까지 찾아 읽는다. */
function findRelatedFiles(specFullPath, specContent) {
  const dir = path.dirname(specFullPath);
  const found = [];
  const seen = new Set();
  let m;
  IMPORT_PATTERN.lastIndex = 0;
  while ((m = IMPORT_PATTERN.exec(specContent)) && found.length < MAX_RELATED_FILES) {
    const base = path.resolve(dir, m[1]);
    if (!base.startsWith(WORKSPACE)) continue; // 프로젝트 밖으로 나가는 경로는 무시
    for (const suffix of CANDIDATE_SUFFIXES) {
      const candidate = base + suffix;
      if (seen.has(candidate)) break;
      try {
        if (fs.statSync(candidate).isFile()) {
          seen.add(candidate);
          let content = fs.readFileSync(candidate, 'utf-8');
          if (content.length > MAX_RELATED_FILE_CHARS) {
            content = content.slice(0, MAX_RELATED_FILE_CHARS) + '\n/* ...truncated... */';
          }
          found.push({ fullPath: candidate, relPath: path.relative(WORKSPACE, candidate), content });
          break;
        }
      } catch {
        // 후보 경로가 없으면 다음 후보 시도
      }
    }
  }
  return found;
}

function buildPrompt(job, targetSpecPath, currentContents, relatedPaths, lastFailureOutput) {
  const relatedBlock = relatedPaths.length === 0
    ? '(관련 파일 없음)'
    : relatedPaths
        .map((relPath) => `--- ${relPath} ---\n${currentContents[relPath]}`)
        .join('\n\n');

  return `Instruction: ${job.instruction}

Target spec file: ${targetSpecPath}

Current content of target spec file:
${currentContents[targetSpecPath]}

Related files (imported by the target spec — you may edit these too if the fix requires it, but prefer editing only the target spec when possible):
${relatedBlock}

Last test run failure output:
${lastFailureOutput}

Respond with ONLY a JSON object of this exact shape, no markdown fences, no explanation:
{"files": [{"path": "<one of the paths shown above>", "content": "<full new file content>"}]}
Only include files you actually changed. Do not invent file paths that were not shown to you above.`;
}

function parseAiResponse(raw, allowedPaths) {
  let parsed;
  try {
    parsed = JSON.parse(stripMarkdownFence(raw));
  } catch {
    return [];
  }
  if (!parsed || !Array.isArray(parsed.files)) {
    return [];
  }
  return parsed.files.filter((f) => f && typeof f.path === 'string' && typeof f.content === 'string' && allowedPaths.has(f.path));
}

async function main() {
  const job = JSON.parse(fs.readFileSync(jobFile, 'utf-8'));
  if (job.jobType === 'EDIT_ASSIST_VERIFY') {
    return runEditAssistVerify(job);
  }
  if (job.jobType === 'SITE_ANALYSIS') {
    // 대상 분석은 LLM 을 부르지 않는 결정적 탐색이라 별도 모듈로 둔다 (analyze.js 참고).
    return require('./analyze').runSiteAnalysis(job, resultDir);
  }

  const targetSpecPath = job.targetSpecPath;
  const specFullPath = path.join(WORKSPACE, targetSpecPath);
  const originalTargetContent = fs.readFileSync(specFullPath, 'utf-8');
  const maxIterations = job.maxIterations || 5;

  const relatedFiles = findRelatedFiles(specFullPath, originalTargetContent);

  // originalContents/currentContents는 "이번 job이 건드릴 수 있는 파일 전체"(대상 spec + 관련 파일)의 경로->내용 맵.
  // key는 항상 /workspace 기준 상대경로로 통일한다.
  const originalContents = { [targetSpecPath]: originalTargetContent };
  for (const f of relatedFiles) {
    originalContents[f.relPath] = f.content;
  }
  const currentContents = { ...originalContents };
  const allowedPaths = new Set(Object.keys(originalContents));
  const relatedPaths = relatedFiles.map((f) => f.relPath);

  const systemPrompt = `You are an expert Playwright + TypeScript test engineer.
You will be given a failing Playwright spec file, files it imports, and its failure log.
Fix the failing test by editing the target spec file and/or the related files shown to you.
Respond with ONLY the JSON object described in the instructions — no explanation, no markdown fences.`;

  let lastFailureOutput = job.failureLog || '(초기 실패 로그 없음)';
  let iterationsUsed = 0;
  let fixed = false;

  // WORKSPACE는 api 컨테이너와 공유하는 실제 프로젝트 볼륨이다. 검토/승인 게이트를 거치기 전에
  // 실제 소스가 AI의 시도 중간 상태로 남지 않도록, 이 함수가 끝나는 시점(성공/실패 무관)에 손댄 파일 전부를 원본으로 되돌린다.
  try {
    for (let i = 0; i < maxIterations; i++) {
      iterationsUsed = i + 1;
      const userPrompt = buildPrompt(job, targetSpecPath, currentContents, relatedPaths, lastFailureOutput);

      let aiContent;
      try {
        aiContent = await callLlm(systemPrompt, userPrompt);
      } catch (e) {
        writeResult({
          jobId: job.jobId,
          status: 'FAILED',
          iterationsUsed,
          changedFiles: [],
          summary: null,
          targetCaseFixed: false,
          error: String(e.message || e),
        });
        return;
      }

      const edits = parseAiResponse(aiContent, allowedPaths);
      if (edits.length === 0) {
        continue;
      }

      for (const edit of edits) {
        const fullPath = path.join(WORKSPACE, edit.path);
        fs.writeFileSync(fullPath, edit.content, 'utf-8');
        currentContents[edit.path] = edit.content;
      }

      const runResult = runPlaywright(targetSpecPath);
      if (runResult.passed) {
        fixed = true;
        break;
      }
      lastFailureOutput = runResult.output.slice(-4000);
    }

    const changedFiles = Object.keys(originalContents).filter(
      (p) => currentContents[p] !== originalContents[p]
    );

    fs.mkdirSync(path.join(resultDir, 'files'), { recursive: true });
    for (const relPath of changedFiles) {
      const safeFileName = relPath.replace(/[\\/]/g, '__');
      fs.writeFileSync(path.join(resultDir, 'files', safeFileName), currentContents[relPath], 'utf-8');
    }

    writeResult({
      jobId: job.jobId,
      status: fixed ? 'DIFF_READY' : 'FAILED',
      iterationsUsed,
      changedFiles,
      summary: fixed
        ? `${iterationsUsed}회 시도 후 ${changedFiles.join(', ') || targetSpecPath} 수정, 테스트 통과 확인`
        : `${maxIterations}회 시도 후에도 테스트를 통과시키지 못함`,
      targetCaseFixed: fixed,
      error: fixed ? null : '반복 상한 도달',
    });
  } finally {
    for (const [relPath, content] of Object.entries(originalContents)) {
      try {
        fs.writeFileSync(path.join(WORKSPACE, relPath), content, 'utf-8');
      } catch (e) {
        console.error(`원본 파일 복원 실패 (${relPath}):`, e);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  try {
    const failedJob = JSON.parse(fs.readFileSync(jobFile, 'utf-8'));
    if (failedJob.jobType === 'EDIT_ASSIST_VERIFY') {
      writeResult({ status: 'ERROR', passed: false, output: String(e.message || e) });
    } else if (failedJob.jobType === 'SITE_ANALYSIS') {
      writeResult({ version: 1, jobId: failedJob.jobId ?? null, status: 'ERROR', error: String(e.message || e) });
    } else {
      writeResult({
        jobId: failedJob.jobId,
        status: 'ERROR',
        iterationsUsed: 0,
        changedFiles: [],
        summary: null,
        targetCaseFixed: false,
        error: String(e.message || e),
      });
    }
  } catch (inner) {
    console.error('결과 기록 실패:', inner);
  }
  process.exit(1);
});
