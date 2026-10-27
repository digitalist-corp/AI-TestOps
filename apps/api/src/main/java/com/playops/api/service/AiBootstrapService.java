package com.playops.api.service;

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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.task.TaskExecutor;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 프로젝트 등록 직후 "AI가 사이트를 열어 보고, 본 화면으로 테스트를 만들고, 실제로 실행해 통과할 때까지 고치는" 흐름.
 *
 * 1. 사이트 관찰(Lv2): 화면 정보가 없으면 AI Runner 의 analyze.js 로 baseUrl 을 짧게 탐색해 실제로 하나만 가리키는
 *    셀렉터 · 폼 · 접근성 트리를 모은다 ({@link SiteAnalysisService#analyzeByUrl}). LLM 을 쓰지 않는다.
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

    public static final String SPEC_PATH = "tests/bootstrap.spec.ts";
    public static final int MAX_HEAL_ATTEMPTS = 2;

    /** 실행 이력이 아직 없을 때 쓰는 기본 예상치 (러너 기동 + 단일 spec 실행 기준). */
    private static final long DEFAULT_ESTIMATED_DURATION_MS = 60_000L;
    private static final long POLL_INTERVAL_MS = 2_000L;
    /** 교정 프롬프트에 넣는 실패 로그 길이. 뒤쪽(실제 오류)을 남긴다. */
    private static final int FAILURE_LOG_CHARS = 6_000;
    /** 끝난 상태를 메모리에 두는 시간. */
    private static final Duration KEEP_FINISHED = Duration.ofHours(6);

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

    /** 한 번의 첫 테스트 생성. 파이프라인 스레드가 쓰고 요청 스레드가 읽으므로 스냅샷은 synchronized 로 만든다. */
    static final class State {
        final String id = UUID.randomUUID().toString();
        final String projectId;
        final String instruction;
        final AiModelProvider provider;
        final Instant startedAt = Instant.now();
        final List<String> warnings = new ArrayList<>();
        final List<String> generatedFiles = new ArrayList<>();
        String phase = "ANALYZING_SITE";
        int healAttempt;
        Long executionId;
        String specPath;
        long estimatedDurationMs = DEFAULT_ESTIMATED_DURATION_MS;
        AiBootstrapResponse.SiteAnalysisSummary site;
        String error;
        String failureLog;
        Instant finishedAt;

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
            warnings.add(warning);
        }

        synchronized AiBootstrapResponse snapshot() {
            return new AiBootstrapResponse(id, phase, healAttempt, MAX_HEAL_ATTEMPTS, executionId,
                    List.copyOf(generatedFiles), specPath, estimatedDurationMs, site, List.copyOf(warnings),
                    error, failureLog, startedAt, finishedAt);
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
        State state = states.get(bootstrapId);
        if (state == null || !state.projectId.equals(projectId)) {
            throw new ApiException(404, "첫 테스트 생성 기록을 찾을 수 없습니다. 서버가 다시 시작되었다면 실행 이력에서 결과를 확인하세요.");
        }
        return state.snapshot();
    }

    // ---------------------------------------------------------------- 파이프라인

    void run(State state) {
        try {
            Project project = projectService.getProject(state.projectId);
            boolean visualOnly = observe(state, project);

            state.phase("GENERATING");
            String screens = siteMapPromptService.context(state.projectId, List.of());
            String spec = generate(state, project, screens);
            writeSpec(state, spec, screens);

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
        } catch (Exception e) {
            log.warn("첫 테스트 생성 실패 (project={}): {}", state.projectId, e.getMessage());
            synchronized (state) {
                state.error = e.getMessage() != null ? e.getMessage() : "첫 테스트 생성에 실패했습니다.";
            }
            state.finish("ERROR");
        }
    }

    /**
     * 화면 정보가 없으면 사이트를 짧게 탐색한다. 탐색이 안 돼도 생성은 계속한다 — 화면 정보 없이 만드는 것이
     * 아무것도 안 만드는 것보다 낫고, 그 사실은 경고로 알린다.
     *
     * @return 캔버스로 그리는 사이트라 DOM 셀렉터로 고칠 수 없는지
     */
    private boolean observe(State state, Project project) {
        if (siteAnalysisService.hasUsableNodes(state.projectId)) {
            return false;
        }
        if (project.getBaseUrl() == null || project.getBaseUrl().isBlank()) {
            state.warn("대상 사이트 주소가 없어 화면을 탐색하지 않고 요구사항만으로 테스트를 만듭니다.");
            return false;
        }
        state.phase("ANALYZING_SITE");
        SiteAnalysisService.UrlOutcome outcome = siteAnalysisService.analyzeByUrl(
                state.projectId, SiteAnalysisService.QUICK_LIMITS);
        synchronized (state) {
            state.site = new AiBootstrapResponse.SiteAnalysisSummary(
                    outcome.mode(), outcome.pages(), outcome.verifiedSelectors());
        }
        if ("VISUAL_REQUIRED".equals(outcome.mode())) {
            state.warn("DOM 요소가 없는 캔버스 렌더링 사이트입니다(예: Flutter Web). 셀렉터로 화면을 다룰 수 없어 자동 교정을 하지 않습니다.");
            return true;
        }
        if ("ERROR".equals(outcome.mode())) {
            state.warn("사이트 탐색에 실패해 화면 정보 없이 테스트를 만듭니다: " + outcome.errorMessage());
        }
        return false;
    }

    private String generate(State state, Project project, String screens) {
        String systemPrompt = """
                You are an expert QA automation engineer specializing in Playwright v%s and TypeScript.
                Write ONE complete, executable Playwright spec file saved at "%s" for a project that was just registered.
                The project's playwright.config already sets baseURL to the target site, so navigate with relative paths
                (for example `await page.goto('/')`).
                Keep it to a small number of focused tests that a first run can realistically pass, and assert what the
                user asked for rather than only checking that the page has a title.
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
        return "프로젝트명: " + project.getProjectName()
                + "\n프로젝트 설명: " + (project.getDescription() != null ? project.getDescription() : "-")
                + "\n테스트 목적: " + (project.getTestPurpose() != null ? project.getTestPurpose() : "-")
                + "\nBase URL: " + (project.getBaseUrl() != null ? project.getBaseUrl() : "-");
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
