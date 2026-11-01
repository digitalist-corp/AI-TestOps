package com.playops.api.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.dto.AiBootstrapCredentialsRequest;
import com.playops.api.dto.AiBootstrapResponse;
import com.playops.api.dto.ExecutionCaseResultResponse;
import com.playops.api.dto.ExecutionDetailResponse;
import com.playops.api.dto.ExecutionResponse;
import com.playops.api.entity.AiModelProvider;
import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.entity.Project;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ExecutionRepository;
import com.playops.api.util.ProjectEnvVariables;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.TaskExecutor;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * 프로젝트 등록 직후 "AI가 사이트를 열어 보고, 본 화면으로 테스트를 만들고, 실제로 실행해 통과할 때까지 고치는" 흐름.
 *
 * 1. 사이트 관찰(Lv2): 화면 정보가 없으면 AI Runner 의 analyze.js 로 baseUrl 을 짧게 탐색해 실제로 하나만 가리키는
 *    셀렉터 · 폼 · 접근성 트리를 모은다 ({@link SiteAnalysisService#analyzeByUrl}). LLM 을 쓰지 않는다.
 *    탐색 중 비밀번호 입력란(login_form)을 발견했고 프로젝트 환경변수에 LOGIN_ID / LOGIN_PASSWORD 가 없으면
 *    {@code NEEDS_CREDENTIALS} 상태로 멈춰 사용자에게 계정 정보를 요청한다 (최대 10분 대기, 넘으면 로그인 없이 계속).
 * 2. 생성: 그 화면 정보만 쓰도록 강제한 프롬프트로 spec 하나를 만든다.
 * 3. 실행 검증 + 자율 교정(Lv3): 수동 실행과 같은 경로({@link ExecutionQueryService#triggerRun})로 돌리고, 실패하면
 *    실패 로그 + 실측 화면 정보로 최대 {@link #MAX_HEAL_ATTEMPTS}번 고쳐 다시 돌린다.
 *
 * 등록 직후의 초기 소스라 스캐폴드와 같은 성격이므로 AI 검토 큐를 거치지 않고 바로 파일에 쓴다.
 * 진행 상태는 메모리에만 둔다 — 서버가 다시 뜨면 상태 조회는 404 가 되지만, 만들어진 파일과 실행 이력은 남는다.
 */
@Service
public class AiBootstrapService {

    private static final Logger log = LoggerFactory.getLogger(AiBootstrapService.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

    public static final String SPEC_PATH = "tests/bootstrap.spec.ts";
    public static final int MAX_HEAL_ATTEMPTS = 2;
    public static final int MAX_EVENTS = 100;

    /** 실행 이력이 아직 없을 때 쓰는 기본 예상치 (러너 기동 + 단일 spec 실행 기준). */
    private static final long DEFAULT_ESTIMATED_DURATION_MS = 60_000L;
    private static final long POLL_INTERVAL_MS = 2_000L;
    /** 교정 프롬프트에 넣는 실패 로그 길이. 뒤쪽(실제 오류)을 남긴다. */
    private static final int FAILURE_LOG_CHARS = 6_000;
    /** 끝난 상태를 메모리에 두는 시간. */
    private static final Duration KEEP_FINISHED = Duration.ofHours(6);
    /** 로그인 정보 입력을 기다리는 최대 시간. 넘으면 로그인 없이 생성 단계로 넘어간다. */
    private static final Duration DEFAULT_CREDENTIAL_WAIT_TIMEOUT = Duration.ofMinutes(10);

    private static final Set<ExecutionStatus> TERMINAL = Set.of(
            ExecutionStatus.PASSED, ExecutionStatus.FAILED, ExecutionStatus.ERROR, ExecutionStatus.CANCELLED);

    private final ProjectService projectService;
    private final SiteAnalysisService siteAnalysisService;
    private final SiteMapPromptService siteMapPromptService;
    private final LlmGatewayService llmGatewayService;
    private final FileStorageService fileStorageService;
    private final ExecutionQueryService executionQueryService;
    private final ExecutionRepository executionRepository;
    private final TaskExecutor executor;
    private final Map<String, State> states = new ConcurrentHashMap<>();
    private Duration credentialWaitTimeout = DEFAULT_CREDENTIAL_WAIT_TIMEOUT;

    public AiBootstrapService(
            ProjectService projectService,
            SiteAnalysisService siteAnalysisService,
            SiteMapPromptService siteMapPromptService,
            LlmGatewayService llmGatewayService,
            FileStorageService fileStorageService,
            ExecutionQueryService executionQueryService,
            ExecutionRepository executionRepository,
            @Qualifier("aiBootstrapExecutor") TaskExecutor executor
    ) {
        this.projectService = projectService;
        this.siteAnalysisService = siteAnalysisService;
        this.siteMapPromptService = siteMapPromptService;
        this.llmGatewayService = llmGatewayService;
        this.fileStorageService = fileStorageService;
        this.executionQueryService = executionQueryService;
        this.executionRepository = executionRepository;
        this.executor = executor;
    }

    void setCredentialWaitTimeout(Duration timeout) {
        this.credentialWaitTimeout = timeout != null ? timeout : DEFAULT_CREDENTIAL_WAIT_TIMEOUT;
    }

    /** 한 번의 첫 테스트 생성. 파이프라인 스레드가 쓰고 요청 스레드가 읽으므로 스냅샷은 synchronized 로 만든다. */
    static final class State {
        final String id = UUID.randomUUID().toString();
        final String projectId;
        final String instruction;
        final AiModelProvider provider;
        final Instant startedAt = Instant.now();
        final List<String> warnings = new ArrayList<>();
        final List<String> generatedFiles = new ArrayList<>();
        final List<AiBootstrapResponse.ProgressEvent> events = new ArrayList<>();
        String phase = "ANALYZING_SITE";
        int healAttempt;
        Long executionId;
        String specPath;
        long estimatedDurationMs = DEFAULT_ESTIMATED_DURATION_MS;
        AiBootstrapResponse.SiteAnalysisSummary site;
        String error;
        String failureLog;
        Instant finishedAt;
        String currentUrl;
        int visitedCount;
        AiBootstrapResponse.CredentialRequest credentialRequest;
        Path screensDir;
        boolean visualOnly;
        Instant credentialsDeadline;

        State(String projectId, String instruction, AiModelProvider provider) {
            this.projectId = projectId;
            this.instruction = instruction;
            this.provider = provider;
        }

        synchronized void phase(String next) {
            phase = next;
        }

        synchronized void finish(String finalPhase) {
            phase = finalPhase;
            finishedAt = Instant.now();
        }

        synchronized void warn(String warning) {
            if (warning != null && !warning.isBlank() && !warnings.contains(warning)) {
                warnings.add(warning);
            }
        }

        synchronized void setScreensDir(Path dir) {
            if (dir != null) {
                this.screensDir = dir.toAbsolutePath().normalize();
            }
        }

        synchronized void applyProgressLine(String line) {
            AiBootstrapResponse.ProgressEvent event = parseProgressLine(line);
            if (event != null) {
                applyProgressEvent(event);
            }
        }

        synchronized void applyProgressEvent(AiBootstrapResponse.ProgressEvent event) {
            if (event == null) {
                return;
            }
            events.add(event);
            while (events.size() > MAX_EVENTS) {
                events.remove(0);
            }
            String type = event.type();
            if ("visit".equals(type)) {
                if (event.url() != null && !event.url().isBlank()) {
                    currentUrl = event.url();
                }
                visitedCount++;
            } else if ("screen".equals(type)) {
                if (event.url() != null && !event.url().isBlank()) {
                    currentUrl = event.url();
                }
                if (visitedCount == 0) {
                    visitedCount = 1;
                }
            } else if ("login_form".equals(type)) {
                if (event.url() != null && !event.url().isBlank()) {
                    currentUrl = event.url();
                }
                if (credentialRequest == null) {
                    credentialRequest = new AiBootstrapResponse.CredentialRequest(
                            event.url(),
                            event.fields() != null ? List.copyOf(event.fields()) : List.of()
                    );
                }
            } else if ("warning".equals(type) || "login_failed".equals(type)) {
                warn(event.message());
            }
        }

        synchronized AiBootstrapResponse snapshot() {
            return new AiBootstrapResponse(
                    id,
                    phase,
                    healAttempt,
                    MAX_HEAL_ATTEMPTS,
                    executionId,
                    List.copyOf(generatedFiles),
                    specPath,
                    estimatedDurationMs,
                    site,
                    List.copyOf(warnings),
                    error,
                    failureLog,
                    startedAt,
                    finishedAt,
                    List.copyOf(events),
                    currentUrl,
                    visitedCount,
                    credentialRequest
            );
        }
    }

    /** progress.jsonl 의 한 줄을 읽어 이벤트 객체로 바꾼다. 형식이 맞지 않으면 null 을 돌려준다. */
    @SuppressWarnings("unchecked")
    static AiBootstrapResponse.ProgressEvent parseProgressLine(String line) {
        if (line == null || line.isBlank()) {
            return null;
        }
        try {
            Map<String, Object> raw = MAPPER.readValue(line.trim(), MAP_TYPE);
            String type = raw.get("type") instanceof String t && !t.isBlank() ? t.trim() : null;
            if (type == null) {
                return null;
            }
            String ts = raw.get("ts") != null ? String.valueOf(raw.get("ts")) : null;
            String url = raw.get("url") instanceof String u && !u.isBlank() ? u : null;
            Integer depth = raw.get("depth") instanceof Number n ? n.intValue() : null;
            String title = raw.get("title") instanceof String t ? t : null;
            Integer elements = null;
            if (raw.get("elements") instanceof Number n) {
                elements = n.intValue();
            } else if (raw.get("elements") instanceof List<?> list) {
                elements = list.size();
            }
            String screenshot = raw.get("screenshot") instanceof String s && !s.isBlank() ? s : null;
            String message = raw.get("message") instanceof String m && !m.isBlank() ? m : null;
            List<AiBootstrapResponse.LoginField> fields = null;
            if (raw.get("fields") instanceof List<?> list) {
                List<AiBootstrapResponse.LoginField> parsedFields = new ArrayList<>();
                for (Object item : list) {
                    if (item instanceof Map<?, ?> fieldMap) {
                        Map<String, Object> fm = (Map<String, Object>) fieldMap;
                        String name = fm.get("name") != null ? String.valueOf(fm.get("name")) : null;
                        String label = fm.get("label") != null ? String.valueOf(fm.get("label")) : null;
                        String fType = fm.get("type") != null ? String.valueOf(fm.get("type")) : "text";
                        parsedFields.add(new AiBootstrapResponse.LoginField(name, label, fType));
                    }
                }
                fields = List.copyOf(parsedFields);
            }
            return new AiBootstrapResponse.ProgressEvent(
                    ts, type, url, depth, title, elements, screenshot, message, fields);
        } catch (Exception ignored) {
            return null;
        }
    }

    public AiBootstrapResponse start(String projectId, String instruction, String provider) {
        if (instruction == null || instruction.isBlank()) {
            throw new ApiException(400, "어떤 테스트를 만들지 입력하세요.");
        }
        projectService.getProject(projectId);
        forgetOldStates();
        State state = new State(projectId, instruction.trim(), parseProvider(provider));
        state.estimatedDurationMs = estimateDurationMs();
        states.put(state.id, state);
        try {
            executor.execute(() -> run(state));
        } catch (TaskRejectedException e) {
            states.remove(state.id);
            throw new ApiException(429, "첫 테스트 생성 요청이 많습니다. 잠시 뒤 다시 시도하세요.");
        }
        return state.snapshot();
    }

    public AiBootstrapResponse status(String projectId, String bootstrapId) {
        State state = findState(projectId, bootstrapId);
        expireCredentialsWaitIfNeeded(state);
        return state.snapshot();
    }

    /**
     * NEEDS_CREDENTIALS 상태에서 사용자가 보낸 로그인 계정을 프로젝트 환경변수(LOGIN_ID, LOGIN_PASSWORD, LOGIN_PATH)에
     * 병합 저장하고 로그인 분석을 다시 돌린 뒤 생성 단계로 이어간다. skip=true 이면 로그인 없이 바로 생성으로 넘어간다.
     */
    public AiBootstrapResponse submitCredentials(
            String projectId,
            String bootstrapId,
            AiBootstrapCredentialsRequest request
    ) {
        State state = findState(projectId, bootstrapId);
        boolean skip = request != null && request.isSkip();
        if (!skip) {
            if (request == null
                    || request.loginId() == null || request.loginId().isBlank()
                    || request.password() == null || request.password().isBlank()) {
                throw new ApiException(400, "아이디와 비밀번호를 입력하세요.");
            }
        }

        SiteAnalysisService.LoginSpec loginSpec = null;
        synchronized (state) {
            if (!"NEEDS_CREDENTIALS".equals(state.phase)) {
                throw new ApiException(409, "로그인 정보를 기다리는 상태가 아닙니다.");
            }
            String detectedUrl = state.credentialRequest != null ? state.credentialRequest.url() : null;
            state.credentialRequest = null;
            state.credentialsDeadline = null;

            if (skip) {
                state.phase = "GENERATING";
            } else {
                Project project = projectService.getProject(state.projectId);
                String loginId = request.loginId().trim();
                String password = request.password();
                String loginPath = request.loginPath() != null && !request.loginPath().isBlank()
                        ? request.loginPath().trim()
                        : extractPath(detectedUrl);

                Map<String, String> additions = new LinkedHashMap<>();
                additions.put("LOGIN_ID", loginId);
                additions.put("LOGIN_PASSWORD", password);
                if (loginPath != null && !loginPath.isBlank()) {
                    additions.put("LOGIN_PATH", loginPath);
                }
                String mergedJson = ProjectEnvVariables.merge(project.getEnvVariables(), additions);
                project.setEnvVariables(mergedJson);
                projectService.mergeEnvVariables(state.projectId, additions);

                String loginUrl = request.loginPath() != null && !request.loginPath().isBlank()
                        ? resolveLoginUrl(project.getBaseUrl(), request.loginPath().trim())
                        : (detectedUrl != null && !detectedUrl.isBlank() ? detectedUrl : project.getBaseUrl());
                loginSpec = new SiteAnalysisService.LoginSpec(loginUrl, loginId, password);
                state.phase = "LOGGING_IN";
            }
        }

        SiteAnalysisService.LoginSpec finalLoginSpec = loginSpec;
        try {
            executor.execute(() -> resumeAfterCredentials(state, finalLoginSpec));
        } catch (TaskRejectedException e) {
            synchronized (state) {
                state.error = "첫 테스트 생성 요청이 많습니다. 잠시 뒤 다시 시도하세요.";
            }
            state.finish("ERROR");
            throw new ApiException(429, "첫 테스트 생성 요청이 많습니다. 잠시 뒤 다시 시도하세요.");
        }
        return state.snapshot();
    }

    /** 탐색 중 찍은 화면 스크린샷 파일을 돌려준다. 경로 탈출(../, /, \) 시도는 즉시 거절한다. */
    public Path screenshotFile(String projectId, String bootstrapId, String fileName) {
        if (fileName == null || fileName.isBlank()
                || fileName.contains("..")
                || fileName.contains("/")
                || fileName.contains("\\")
                || fileName.indexOf('\0') >= 0) {
            throw new ApiException(400, "올바르지 않은 스크린샷 파일 이름입니다.");
        }
        State state = findState(projectId, bootstrapId);
        Path screensDir;
        synchronized (state) {
            screensDir = state.screensDir;
        }
        if (screensDir == null) {
            throw new ApiException(404, "스크린샷을 찾을 수 없습니다.");
        }
        Path base = screensDir.toAbsolutePath().normalize();
        Path resolved = base.resolve(fileName).normalize();
        if (!resolved.startsWith(base)) {
            throw new ApiException(400, "올바르지 않은 스크린샷 파일 경로입니다.");
        }
        if (!Files.isRegularFile(resolved)) {
            throw new ApiException(404, "스크린샷 파일을 찾을 수 없습니다.");
        }
        return resolved;
    }

    private State findState(String projectId, String bootstrapId) {
        State state = bootstrapId != null ? states.get(bootstrapId) : null;
        if (state == null || (projectId != null && !state.projectId.equals(projectId))) {
            throw new ApiException(404, "첫 테스트 생성 기록을 찾을 수 없습니다. 서버가 다시 시작되었다면 실행 이력에서 결과를 확인하세요.");
        }
        return state;
    }

    // ---------------------------------------------------------------- 파이프라인

    void run(State state) {
        try {
            Project project = projectService.getProject(state.projectId);
            boolean pausedForCredentials = observe(state, project);
            if (pausedForCredentials) {
                return;
            }
            generateAndExecute(state, project);
        } catch (Exception e) {
            log.warn("첫 테스트 생성 실패 (project={}): {}", state.projectId, e.getMessage());
            synchronized (state) {
                state.error = e.getMessage() != null ? e.getMessage() : "첫 테스트 생성에 실패했습니다.";
            }
            state.finish("ERROR");
        }
    }

    void resumeAfterCredentials(State state, SiteAnalysisService.LoginSpec loginSpec) {
        try {
            Project project = projectService.getProject(state.projectId);
            if (loginSpec != null) {
                state.phase("LOGGING_IN");
                SiteAnalysisService.UrlOutcome outcome = runAnalysis(state, loginSpec);
                synchronized (state) {
                    state.credentialRequest = null;
                }
                if (outcome != null) {
                    applyAnalysisOutcome(state, outcome);
                }
            }
            generateAndExecute(state, project);
        } catch (Exception e) {
            log.warn("첫 테스트 생성 재개 실패 (project={}): {}", state.projectId, e.getMessage());
            synchronized (state) {
                state.error = e.getMessage() != null ? e.getMessage() : "첫 테스트 생성에 실패했습니다.";
            }
            state.finish("ERROR");
        }
    }

    private void generateAndExecute(State state, Project project) throws InterruptedException {
        state.phase("GENERATING");
        String screens = siteMapPromptService.context(state.projectId, List.of());
        String spec = generate(state, project, screens);
        writeSpec(state, spec, screens);

        boolean visualOnly;
        synchronized (state) {
            visualOnly = state.visualOnly;
        }

        for (int attempt = 0; ; attempt++) {
            state.phase("RUNNING");
            Execution execution = runOnce(state);
            if (execution.getStatus() == ExecutionStatus.PASSED) {
                state.finish("PASSED");
                return;
            }
            String failure = failureText(execution.getId());
            boolean canHeal = attempt < MAX_HEAL_ATTEMPTS
                    && !visualOnly
                    && execution.getStatus() != ExecutionStatus.CANCELLED;
            if (!canHeal) {
                synchronized (state) {
                    state.failureLog = failure;
                }
                state.finish("FAILED");
                return;
            }
            synchronized (state) {
                state.healAttempt = attempt + 1;
                state.phase = "HEALING";
            }
            spec = heal(state, project, spec, failure);
            writeSpec(state, spec, screens);
        }
    }

    /**
     * 화면 정보가 없으면 사이트를 짧게 탐색한다. 탐색 중 로그인 폼을 만났고 프로젝트 환경변수에
     * LOGIN_ID · LOGIN_PASSWORD 가 없으면 {@code NEEDS_CREDENTIALS} 상태로 멈추고 true 를 돌려준다.
     */
    private boolean observe(State state, Project project) {
        if (siteAnalysisService.hasUsableNodes(state.projectId)) {
            return false;
        }
        if (project.getBaseUrl() == null || project.getBaseUrl().isBlank()) {
            state.warn("대상 사이트 주소가 없어 화면을 탐색하지 않고 요구사항만으로 테스트를 만듭니다.");
            return false;
        }
        Map<String, String> env = safeParseEnv(project.getEnvVariables());
        String existingId = env.get("LOGIN_ID");
        String existingPw = env.get("LOGIN_PASSWORD");
        boolean hasSavedCredentials = existingId != null && !existingId.isBlank()
                && existingPw != null && !existingPw.isBlank();

        SiteAnalysisService.LoginSpec loginSpec = null;
        if (hasSavedCredentials) {
            String loginUrl = resolveLoginUrl(project.getBaseUrl(), env.get("LOGIN_PATH"));
            loginSpec = new SiteAnalysisService.LoginSpec(loginUrl, existingId.trim(), existingPw);
        }

        state.phase("ANALYZING_SITE");
        SiteAnalysisService.UrlOutcome outcome = runAnalysis(state, loginSpec);
        if (outcome != null) {
            applyAnalysisOutcome(state, outcome);
        }

        boolean needsCredentials;
        synchronized (state) {
            if (hasSavedCredentials) {
                state.credentialRequest = null;
                needsCredentials = false;
            } else {
                needsCredentials = state.credentialRequest != null;
                if (needsCredentials) {
                    state.phase = "NEEDS_CREDENTIALS";
                    state.credentialsDeadline = Instant.now().plus(credentialWaitTimeout);
                }
            }
        }
        if (needsCredentials) {
            scheduleCredentialTimeout(state);
            return true;
        }
        return false;
    }

    private SiteAnalysisService.UrlOutcome runAnalysis(State state, SiteAnalysisService.LoginSpec loginSpec) {
        SiteAnalysisService.ProgressCallback callback = new SiteAnalysisService.ProgressCallback() {
            @Override
            public void onResultDir(Path resultDir) {
                if (resultDir != null) {
                    state.setScreensDir(resultDir.resolve("screens"));
                }
            }

            @Override
            public void onProgressLine(String line) {
                state.applyProgressLine(line);
            }
        };
        SiteAnalysisService.UrlOutcome outcome = siteAnalysisService.analyzeByUrl(
                state.projectId, SiteAnalysisService.QUICK_LIMITS, loginSpec, callback);
        if (outcome == null) {
            outcome = siteAnalysisService.analyzeByUrl(state.projectId, SiteAnalysisService.QUICK_LIMITS);
        }
        return outcome;
    }

    private void applyAnalysisOutcome(State state, SiteAnalysisService.UrlOutcome outcome) {
        synchronized (state) {
            state.site = new AiBootstrapResponse.SiteAnalysisSummary(
                    outcome.mode(), outcome.pages(), outcome.verifiedSelectors());
            if ("VISUAL_REQUIRED".equals(outcome.mode())) {
                state.visualOnly = true;
            }
        }
        if (outcome.warnings() != null) {
            outcome.warnings().forEach(state::warn);
        }
        if ("VISUAL_REQUIRED".equals(outcome.mode())) {
            state.warn("DOM 요소가 없는 캔버스 렌더링 사이트입니다(예: Flutter Web). 셀렉터로 화면을 다룰 수 없어 자동 교정을 하지 않습니다.");
        }
        if ("ERROR".equals(outcome.mode())) {
            state.warn("사이트 탐색에 실패해 화면 정보 없이 테스트를 만듭니다: " + outcome.errorMessage());
        }
    }

    private void scheduleCredentialTimeout(State state) {
        long delayMs = Math.max(1L, credentialWaitTimeout.toMillis());
        CompletableFuture.delayedExecutor(delayMs, TimeUnit.MILLISECONDS)
                .execute(() -> expireCredentialsWaitIfNeeded(state));
    }

    void expireCredentialsWaitIfNeeded(State state) {
        synchronized (state) {
            if (!"NEEDS_CREDENTIALS".equals(state.phase)) {
                return;
            }
            if (state.credentialsDeadline != null && Instant.now().isBefore(state.credentialsDeadline)) {
                return;
            }
            state.credentialRequest = null;
            state.credentialsDeadline = null;
            state.warn("로그인 정보 입력 대기 시간(10분)이 지나 로그인 없이 계속 진행합니다.");
            state.phase = "GENERATING";
        }
        try {
            executor.execute(() -> resumeAfterCredentials(state, null));
        } catch (TaskRejectedException e) {
            synchronized (state) {
                state.error = "첫 테스트 생성 요청이 많아 재개하지 못했습니다.";
            }
            state.finish("ERROR");
        }
    }

    private String generate(State state, Project project, String screens) {
        String systemPrompt = """
                You are an expert QA automation engineer specializing in Playwright v%s and TypeScript.
                Write ONE complete, executable Playwright spec file saved at "%s" for a project that was just registered.
                The project's playwright.config already sets baseURL to the target site, so navigate with relative paths
                (for example `await page.goto('/')`).
                Keep it to a small number of focused tests that a first run can realistically pass, and assert what the
                user asked for rather than only checking that the page has a title.
                If logging in is required, read credentials from `process.env.LOGIN_ID` and `process.env.LOGIN_PASSWORD`
                (and `process.env.LOGIN_PATH` if needed) — never hardcode usernames or passwords in the code.
                Return ONLY the raw TypeScript code for that file — no markdown code fences, no explanation, no JSON wrapper.
                """.formatted(project.getPlaywrightVersion(), SPEC_PATH);
        if (!screens.isBlank()) {
            systemPrompt += SCREEN_RULES;
        }
        String userPrompt = projectBrief(project)
                + "\n요구사항: " + state.instruction
                + (screens.isBlank() ? "" : "\n\n화면 정보\n" + screens);
        return stripMarkdownFence(llmGatewayService.chat(
                state.provider, systemPrompt, userPrompt, "테스트 생성", state.projectId));
    }

    private String heal(State state, Project project, String spec, String failure) {
        String screens = siteMapPromptService.healingContext(state.projectId, List.of());
        String systemPrompt = """
                You are an expert QA automation engineer specializing in Playwright v%s and TypeScript.
                A Playwright spec you wrote just failed. Fix it so it passes against the real site while still testing
                what the user asked for. Do not delete assertions just to make the test pass.
                - If a locator is wrong (not found, strict mode violation, timeout waiting for it), replace it with
                  another locator from the screen information, or narrow it with a landmark or `.first()`.
                - If it is a timing or navigation problem, wait for the right state with `page.waitForURL(...)` or a
                  web-first assertion such as `await expect(locator).toBeVisible()` — never with fixed `waitForTimeout`.
                - If a step needs an element that does not exist on the site, remove that step and leave a code comment.
                - If logging in is required, use `process.env.LOGIN_ID` and `process.env.LOGIN_PASSWORD` — never hardcode credentials.
                Return ONLY the full corrected TypeScript file — no markdown code fences, no explanation.
                """.formatted(project.getPlaywrightVersion());
        if (!screens.isBlank()) {
            systemPrompt += SCREEN_RULES;
        }
        String userPrompt = projectBrief(project)
                + "\n요구사항: " + state.instruction
                + "\n\n실패한 spec (" + SPEC_PATH + ")\n" + spec
                + "\n\n실행 오류\n" + failure
                + (screens.isBlank() ? "" : "\n\n화면 정보\n" + screens);
        return stripMarkdownFence(llmGatewayService.chat(
                state.provider, systemPrompt, userPrompt, "테스트 자동 교정", state.projectId));
    }

    private static final String SCREEN_RULES = """

            The user message includes a "화면 정보" section listing the site's screens. Screens marked
            "실제 사이트에서 확인" were opened in a real browser and every listed locator was checked to match exactly
            one element. Form lines ("폼:") list a form's inputs and its submit button. The accessibility tree excerpt
            shows what is actually rendered.
            - To click, fill, or otherwise act on the page, use ONLY locators listed there, written exactly as listed
              (prefix them with `page.`). Do not invent locators, CSS selectors, or text.
            - Navigate by clicking a listed link or with `page.goto('<route>')` using a listed route.
            - A locator marked as appearing several times must be narrowed (for example with `.first()`), and one marked
              as conditional must not be assumed to be present.
            - Do not submit forms that create, change, or delete data unless the requirement explicitly asks for it.
            """;

    private static String projectBrief(Project project) {
        Map<String, String> env = safeParseEnv(project.getEnvVariables());
        boolean hasLoginEnv = env.get("LOGIN_ID") != null && !env.get("LOGIN_ID").isBlank()
                && env.get("LOGIN_PASSWORD") != null && !env.get("LOGIN_PASSWORD").isBlank();
        String loginHint = hasLoginEnv
                ? "\n로그인 환경변수: process.env.LOGIN_ID, process.env.LOGIN_PASSWORD 사용 가능 (값을 코드에 직접 적지 말 것)"
                : "";
        return "프로젝트명: " + project.getProjectName()
                + "\n프로젝트 설명: " + (project.getDescription() != null ? project.getDescription() : "-")
                + "\n테스트 목적: " + (project.getTestPurpose() != null ? project.getTestPurpose() : "-")
                + "\nBase URL: " + (project.getBaseUrl() != null ? project.getBaseUrl() : "-")
                + loginHint;
    }

    /** spec 을 쓰고, 화면 정보 밖의 셀렉터를 썼으면 경고로 남기고, 어느 셀렉터를 썼는지 기록한다(실행 결과로 확인 상태를 바꾼다). */
    private void writeSpec(State state, String spec, String screens) {
        if (spec == null || spec.isBlank() || !spec.contains("test(")) {
            throw new ApiException(502, "AI가 실행 가능한 spec 을 만들지 못했습니다. 요청 내용을 조금 더 구체적으로 적어보세요.");
        }
        fileStorageService.writeFile(state.projectId, SPEC_PATH, spec);
        SiteMapPromptService.SelectorCheck check = siteMapPromptService.check(state.projectId, spec);
        if (!screens.isBlank() && !check.unknown().isEmpty()) {
            state.warn("화면 정보에 없는 셀렉터 " + check.unknown().size() + "개: "
                    + String.join(", ", check.unknown().subList(0, Math.min(5, check.unknown().size()))));
        }
        siteMapPromptService.recordOrigin(state.projectId, SPEC_PATH, List.of(), check.used());
        synchronized (state) {
            state.specPath = SPEC_PATH;
            if (!state.generatedFiles.contains(SPEC_PATH)) {
                state.generatedFiles.add(SPEC_PATH);
            }
        }
    }

    private Execution runOnce(State state) throws InterruptedException {
        String title = "AI 초기 케이스" + (state.healAttempt > 0 ? " (교정 " + state.healAttempt + "회)" : "")
                + ": " + state.instruction;
        ExecutionResponse started = executionQueryService.triggerRun(
                state.projectId, null, SPEC_PATH, null, title.length() > 480 ? title.substring(0, 480) : title, false);
        synchronized (state) {
            state.executionId = started.id();
        }
        log.info("AI bootstrap 실행. project={}, execution={}, heal={}", state.projectId, started.id(), state.healAttempt);

        Project project = projectService.getProject(state.projectId);
        int projectTimeout = project.getTimeout() != null ? project.getTimeout() : 300;
        Instant deadline = Instant.now().plusSeconds(projectTimeout + 600L); // 러너 이미지 첫 내려받기 여유
        while (Instant.now().isBefore(deadline)) {
            Execution execution = executionRepository.findById(started.id())
                    .orElseThrow(() -> new ApiException(404, "실행 기록이 사라졌습니다: " + started.id()));
            if (TERMINAL.contains(execution.getStatus())) {
                return execution;
            }
            Thread.sleep(POLL_INTERVAL_MS);
        }
        throw new ApiException(504, "테스트 실행이 제한 시간 안에 끝나지 않았습니다. 실행 이력에서 결과를 확인하세요.");
    }

    /** 실패한 케이스의 오류 메시지를 먼저, 그 뒤에 실행 로그의 끝부분을 붙인다. */
    private String failureText(Long executionId) {
        ExecutionDetailResponse detail = executionQueryService.getDetail(executionId);
        StringBuilder sb = new StringBuilder();
        for (ExecutionCaseResultResponse result : detail.caseResults()) {
            if ("FAILED".equals(result.status()) && result.errorMessage() != null) {
                sb.append("[").append(result.caseTitle()).append("]\n").append(result.errorMessage()).append("\n\n");
            }
        }
        String logOutput = detail.logOutput() == null ? "" : detail.logOutput();
        sb.append(logOutput.length() > FAILURE_LOG_CHARS
                ? "…\n" + logOutput.substring(logOutput.length() - FAILURE_LOG_CHARS)
                : logOutput);
        String text = sb.toString().trim();
        return text.isEmpty() ? "실행이 " + detail.execution().status() + " 상태로 끝났지만 로그가 없습니다." : text;
    }

    // ---------------------------------------------------------------- 보조

    private static Map<String, String> safeParseEnv(String json) {
        try {
            return ProjectEnvVariables.parse(json);
        } catch (Exception ignored) {
            return Map.of();
        }
    }

    static String resolveLoginUrl(String baseUrl, String loginPath) {
        if (loginPath == null || loginPath.isBlank()) {
            return baseUrl;
        }
        String trimmed = loginPath.trim();
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            return trimmed;
        }
        if (baseUrl == null || baseUrl.isBlank()) {
            return trimmed;
        }
        try {
            URI base = URI.create(baseUrl.trim());
            return base.resolve(trimmed.startsWith("/") ? trimmed : "/" + trimmed).toString();
        } catch (Exception ignored) {
            return baseUrl;
        }
    }

    static String extractPath(String url) {
        if (url == null || url.isBlank()) {
            return null;
        }
        try {
            URI uri = URI.create(url.trim());
            String path = uri.getRawPath();
            if (path == null || path.isBlank()) {
                return "/";
            }
            return uri.getRawQuery() != null && !uri.getRawQuery().isBlank()
                    ? path + "?" + uri.getRawQuery()
                    : path;
        } catch (Exception ignored) {
            return url.startsWith("/") ? url.trim() : null;
        }
    }

    private AiModelProvider parseProvider(String raw) {
        if (raw == null || raw.isBlank()) {
            return null; // LlmGatewayService 가 관리자 설정의 기본 공급자를 쓴다.
        }
        try {
            return AiModelProvider.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    static String stripMarkdownFence(String raw) {
        String trimmed = raw == null ? "" : raw.trim();
        if (trimmed.startsWith("```")) {
            trimmed = trimmed.replaceFirst("^```(typescript|ts|javascript|js)?", "").trim();
            if (trimmed.endsWith("```")) {
                trimmed = trimmed.substring(0, trimmed.length() - 3).trim();
            }
        }
        return trimmed;
    }

    private void forgetOldStates() {
        Instant cutoff = Instant.now().minus(KEEP_FINISHED);
        states.values().removeIf(s -> s.finishedAt != null && s.finishedAt.isBefore(cutoff));
    }

    /** 최근 완료된 실행들의 평균 소요시간. 이력이 없으면 기본값을 쓴다. */
    private long estimateDurationMs() {
        List<Execution> recent = executionRepository.findTop20ByDurationMsIsNotNullOrderByCreatedAtDesc();
        if (recent.isEmpty()) {
            return DEFAULT_ESTIMATED_DURATION_MS;
        }
        long sum = 0;
        for (Execution execution : recent) {
            sum += execution.getDurationMs();
        }
        return Math.max(10_000L, sum / recent.size());
    }
}
