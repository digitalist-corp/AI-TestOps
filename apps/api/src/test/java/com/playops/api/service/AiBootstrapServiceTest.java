package com.playops.api.service;

import com.playops.api.dto.AiBootstrapBriefingActionRequest;
import com.playops.api.dto.AiBootstrapCredentialsRequest;
import com.playops.api.dto.AiBootstrapResponse;
import com.playops.api.dto.ExecutionCaseResultResponse;
import com.playops.api.dto.ExecutionDetailResponse;
import com.playops.api.dto.ExecutionResponse;
import com.playops.api.dto.PlanDtos;
import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.entity.Project;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ExecutionRepository;
import com.playops.api.util.ProjectEnvVariables;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.core.task.SyncTaskExecutor;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

class AiBootstrapServiceTest {

    private static final String SPEC = "import { test } from '@playwright/test';\ntest('홈', async ({ page }) => {});";

    private final ProjectService projectService = mock(ProjectService.class);
    private final SiteAnalysisService siteAnalysisService = mock(SiteAnalysisService.class);
    private final SiteMapPromptService siteMapPromptService = mock(SiteMapPromptService.class);
    private final LlmGatewayService llm = mock(LlmGatewayService.class);
    private final FileStorageService files = mock(FileStorageService.class);
    private final ExecutionQueryService executions = mock(ExecutionQueryService.class);
    private final ExecutionRepository executionRepository = mock(ExecutionRepository.class);
    private final PlanEntryService planEntries = mock(PlanEntryService.class);
    private final OnboardingBriefingService briefing =
            new OnboardingBriefingService(siteAnalysisService, siteMapPromptService, llm, planEntries);
    private final AiBootstrapService service = new AiBootstrapService(projectService, siteAnalysisService,
            siteMapPromptService, llm, files, executions, executionRepository, briefing, new SyncTaskExecutor());

    @BeforeEach
    void setUp() {
        Project project = new Project();
        project.setProjectId("p");
        project.setProjectName("데모");
        project.setBaseUrl("http://site");
        when(projectService.getProject("p")).thenReturn(project);
        when(siteMapPromptService.context(eq("p"), any())).thenReturn("화면 / (홈) · 실제 사이트에서 확인\n");
        when(siteMapPromptService.healingContext(eq("p"), any())).thenReturn("화면 / (홈) · 실제 사이트에서 확인\n");
        when(siteMapPromptService.check(eq("p"), anyString()))
                .thenReturn(new SiteMapPromptService.SelectorCheck(List.of(), List.of()));
        when(llm.chat(any(), anyString(), anyString(), anyString(), eq("p"))).thenReturn("```ts\n" + SPEC + "\n```");
        when(executionRepository.findTop20ByDurationMsIsNotNullOrderByCreatedAtDesc()).thenReturn(List.of());
    }

    private void runs(ExecutionStatus... statuses) {
        ExecutionResponse[] started = new ExecutionResponse[statuses.length];
        for (int i = 0; i < statuses.length; i++) {
            long id = i + 1;
            ExecutionResponse response = mock(ExecutionResponse.class);
            when(response.id()).thenReturn(id);
            started[i] = response;
            Execution execution = new Execution();
            execution.setId(id);
            execution.setStatus(statuses[i]);
            when(executionRepository.findById(id)).thenReturn(Optional.of(execution));
            when(executions.getDetail(id)).thenReturn(new ExecutionDetailResponse(response, "log", List.of(), null,
                    List.of(new ExecutionCaseResultResponse(AiBootstrapService.SPEC_PATH, "홈", "FAILED", 10,
                            "strict mode violation: getByRole('button') resolved to 2 elements"))));
        }
        when(executions.triggerRun(eq("p"), isNull(), eq(AiBootstrapService.SPEC_PATH), isNull(), anyString(), anyBoolean()))
                .thenReturn(started[0], java.util.Arrays.copyOfRange(started, 1, started.length));
    }

    @Test
    void exploresSiteFirstThenHealsAFailedRunUntilItPasses() {
        when(siteAnalysisService.hasUsableNodes("p")).thenReturn(false);
        when(siteAnalysisService.analyzeByUrl("p", SiteAnalysisService.QUICK_LIMITS))
                .thenReturn(new SiteAnalysisService.UrlOutcome("DOM", 3, 12, List.of(), null));
        runs(ExecutionStatus.FAILED, ExecutionStatus.PASSED);

        AiBootstrapResponse response = service.start("p", "로그인 화면이 보이는지 확인", null);

        assertThat(response.phase()).isEqualTo("PASSED");
        assertThat(response.healAttempt()).isEqualTo(1);
        assertThat(response.executionId()).isEqualTo(2L);
        assertThat(response.siteAnalysis().pages()).isEqualTo(3);
        assertThat(response.generatedFiles()).containsExactly(AiBootstrapService.SPEC_PATH);
        verify(files, times(2)).writeFile("p", AiBootstrapService.SPEC_PATH, SPEC);
        // 교정 프롬프트에는 실패한 케이스의 오류가 들어간다
        verify(llm).chat(any(), anyString(), contains("strict mode violation"), eq("테스트 자동 교정"), eq("p"));
        // 생성은 한국어 test.step 을 요구하고, 교정은 있던 단계 이름을 지우거나 영어로 바꾸지 못하게 한다 (V-3)
        verify(llm).chat(any(), contains("test.step('로그인 화면 열기'"), anyString(), eq("테스트 생성"), eq("p"));
        verify(llm).chat(any(), contains("Keep every existing `test.step"), anyString(), eq("테스트 자동 교정"), eq("p"));
    }

    @Test
    void stopsAfterTwoHealAttemptsAndKeepsTheFailureLog() {
        when(siteAnalysisService.hasUsableNodes("p")).thenReturn(true);
        runs(ExecutionStatus.FAILED, ExecutionStatus.FAILED, ExecutionStatus.FAILED);

        AiBootstrapResponse response = service.start("p", "확인", null);

        assertThat(response.phase()).isEqualTo("FAILED");
        assertThat(response.healAttempt()).isEqualTo(AiBootstrapService.MAX_HEAL_ATTEMPTS);
        assertThat(response.failureLog()).contains("strict mode violation");
        verify(siteAnalysisService, never()).analyzeByUrl(anyString(), any());
        verify(executions, times(3)).triggerRun(anyString(), any(), anyString(), any(), anyString(), anyBoolean());
    }

    @Test
    void canvasSiteIsNotHealed() {
        when(siteAnalysisService.hasUsableNodes("p")).thenReturn(false);
        when(siteAnalysisService.analyzeByUrl("p", SiteAnalysisService.QUICK_LIMITS))
                .thenReturn(new SiteAnalysisService.UrlOutcome("VISUAL_REQUIRED", 1, 0, List.of(), null));
        runs(ExecutionStatus.FAILED);

        AiBootstrapResponse response = service.start("p", "확인", null);

        assertThat(response.phase()).isEqualTo("FAILED");
        assertThat(response.healAttempt()).isZero();
        assertThat(response.warnings()).anyMatch(w -> w.contains("캔버스"));
    }

    @Test
    void parsesProgressLinesAndKeepsRecentEventsAndCurrentUrl() {
        AiBootstrapService.State state = new AiBootstrapService.State("p", "확인", null);
        assertThat(AiBootstrapService.parseProgressLine("")).isNull();
        assertThat(AiBootstrapService.parseProgressLine("{broken-json")).isNull();

        for (int i = 1; i <= 105; i++) {
            state.applyProgressLine("{\"ts\":\"2026-11-01T10:00:00Z\",\"type\":\"visit\",\"url\":\"http://site/p" + i + "\",\"depth\":1}");
        }
        state.applyProgressLine("{\"ts\":\"2026-11-01T10:00:01Z\",\"type\":\"screen\",\"url\":\"http://site/login\",\"title\":\"로그인\",\"elements\":12,\"screenshot\":\"screens/n1.jpg\"}");
        state.applyProgressLine("{\"ts\":\"2026-11-01T10:00:02Z\",\"type\":\"login_form\",\"url\":\"http://site/login\",\"fields\":[{\"name\":\"username\",\"label\":\"아이디\",\"type\":\"text\"},{\"name\":\"password\",\"label\":\"비밀번호\",\"type\":\"password\"}]}");
        state.applyProgressLine("{\"ts\":\"2026-11-01T10:00:03Z\",\"type\":\"warning\",\"message\":\"페이지 상한 도달\"}");

        AiBootstrapResponse snapshot = state.snapshot();
        assertThat(snapshot.events()).hasSize(AiBootstrapService.MAX_EVENTS);
        assertThat(snapshot.visitedCount()).isEqualTo(105);
        assertThat(snapshot.currentUrl()).isEqualTo("http://site/login");
        assertThat(snapshot.credentialRequest()).isNotNull();
        assertThat(snapshot.credentialRequest().url()).isEqualTo("http://site/login");
        assertThat(snapshot.credentialRequest().fields()).hasSize(2);
        assertThat(snapshot.warnings()).contains("페이지 상한 도달");
    }

    @Test
    void mergesEnvVariablesWhilePreservingExistingKeys() {
        String existing = "{\"API_KEY\":\"keep-me\",\"LOGIN_ID\":\"old-user\"}";
        String merged = ProjectEnvVariables.merge(existing, Map.of(
                "LOGIN_ID", "new-user",
                "LOGIN_PASSWORD", "s3cr3t!",
                "LOGIN_PATH", "/login"
        ));
        Map<String, String> parsed = ProjectEnvVariables.parse(merged);
        assertThat(parsed)
                .containsEntry("API_KEY", "keep-me")
                .containsEntry("LOGIN_ID", "new-user")
                .containsEntry("LOGIN_PASSWORD", "s3cr3t!")
                .containsEntry("LOGIN_PATH", "/login");
    }

    @Test
    void pausesAtNeedsCredentialsThenMergesEnvAndResumesWithLoginAnalysis() {
        Project project = projectService.getProject("p");
        project.setEnvVariables("{\"CUSTOM_FLAG\":\"1\"}");
        when(siteAnalysisService.hasUsableNodes("p")).thenReturn(false);

        AtomicInteger calls = new AtomicInteger(0);
        when(siteAnalysisService.analyzeByUrl(eq("p"), eq(SiteAnalysisService.QUICK_LIMITS), any(), any()))
                .thenAnswer(inv -> {
                    int call = calls.incrementAndGet();
                    SiteAnalysisService.LoginSpec login = inv.getArgument(2);
                    SiteAnalysisService.ProgressCallback cb = inv.getArgument(3);
                    if (call == 1) {
                        assertThat(login).isNull();
                        cb.onProgressLine("{\"ts\":\"1\",\"type\":\"visit\",\"url\":\"http://site/login\",\"depth\":0}");
                        cb.onProgressLine("{\"ts\":\"2\",\"type\":\"login_form\",\"url\":\"http://site/login\",\"fields\":[{\"name\":\"id\",\"label\":\"아이디\",\"type\":\"text\"},{\"name\":\"pw\",\"label\":\"비밀번호\",\"type\":\"password\"}]}");
                        return new SiteAnalysisService.UrlOutcome("DOM", 1, 2, List.of(), null);
                    }
                    assertThat(login).isNotNull();
                    assertThat(login.url()).isEqualTo("http://site/login");
                    assertThat(login.idValue()).isEqualTo("tester");
                    assertThat(login.passwordValue()).isEqualTo("pw1234");
                    cb.onProgressLine("{\"ts\":\"3\",\"type\":\"screen\",\"url\":\"http://site/dashboard\",\"title\":\"대시보드\",\"elements\":8,\"screenshot\":\"screens/n2.jpg\"}");
                    return new SiteAnalysisService.UrlOutcome("DOM", 4, 15, List.of(), null);
                });
        runs(ExecutionStatus.PASSED);

        AiBootstrapResponse initial = service.start("p", "대시보드 확인", null);
        assertThat(initial.phase()).isEqualTo("NEEDS_CREDENTIALS");
        assertThat(initial.credentialRequest()).isNotNull();
        assertThat(initial.credentialRequest().url()).isEqualTo("http://site/login");
        verify(executions, never()).triggerRun(anyString(), any(), anyString(), any(), anyString(), anyBoolean());

        AiBootstrapResponse resumed = service.submitCredentials(
                "p",
                initial.bootstrapId(),
                new AiBootstrapCredentialsRequest("tester", "pw1234", null, false)
        );

        assertThat(resumed.phase()).isEqualTo("PASSED");
        assertThat(resumed.siteAnalysis().pages()).isEqualTo(4);
        Map<String, String> savedEnv = ProjectEnvVariables.parse(project.getEnvVariables());
        assertThat(savedEnv)
                .containsEntry("CUSTOM_FLAG", "1")
                .containsEntry("LOGIN_ID", "tester")
                .containsEntry("LOGIN_PASSWORD", "pw1234")
                .containsEntry("LOGIN_PATH", "/login");
        verify(llm).chat(any(), contains("process.env.LOGIN_ID"), contains("process.env.LOGIN_PASSWORD"), eq("테스트 생성"), eq("p"));
    }

    @Test
    void usesExistingLoginEnvWithoutStoppingAtNeedsCredentials() {
        Project project = projectService.getProject("p");
        project.setEnvVariables("{\"LOGIN_ID\":\"admin\",\"LOGIN_PASSWORD\":\"pass\",\"LOGIN_PATH\":\"/auth/login\"}");
        when(siteAnalysisService.hasUsableNodes("p")).thenReturn(false);
        when(siteAnalysisService.analyzeByUrl(eq("p"), eq(SiteAnalysisService.QUICK_LIMITS), any(), any()))
                .thenAnswer(inv -> {
                    SiteAnalysisService.LoginSpec login = inv.getArgument(2);
                    SiteAnalysisService.ProgressCallback cb = inv.getArgument(3);
                    assertThat(login).isNotNull();
                    assertThat(login.url()).isEqualTo("http://site/auth/login");
                    assertThat(login.idValue()).isEqualTo("admin");
                    cb.onProgressLine("{\"ts\":\"1\",\"type\":\"login_form\",\"url\":\"http://site/auth/login\",\"fields\":[]}");
                    return new SiteAnalysisService.UrlOutcome("DOM", 3, 10, List.of(), null);
                });
        runs(ExecutionStatus.PASSED);

        AiBootstrapResponse response = service.start("p", "로그인 뒤 화면 확인", null);
        assertThat(response.phase()).isEqualTo("PASSED");
    }

    @Test
    void rejectsPathTraversalWhenServingBootstrapScreenshots(@TempDir Path tempDir) throws Exception {
        Path screensDir = Files.createDirectories(tempDir.resolve("result/screens"));
        Path validShot = screensDir.resolve("n1.jpg");
        Files.writeString(validShot, "jpg-bytes");
        Files.writeString(tempDir.resolve("result/result.json"), "{}");

        when(siteAnalysisService.hasUsableNodes("p")).thenReturn(false);
        when(siteAnalysisService.analyzeByUrl(eq("p"), eq(SiteAnalysisService.QUICK_LIMITS), any(), any()))
                .thenAnswer(inv -> {
                    SiteAnalysisService.ProgressCallback cb = inv.getArgument(3);
                    cb.onResultDir(tempDir.resolve("result"));
                    return new SiteAnalysisService.UrlOutcome("DOM", 1, 1, List.of(), null);
                });
        runs(ExecutionStatus.PASSED);

        AiBootstrapResponse response = service.start("p", "확인", null);
        String id = response.bootstrapId();

        assertThat(service.screenshotFile("p", id, "n1.jpg")).isEqualTo(validShot.toAbsolutePath().normalize());
        assertThatThrownBy(() -> service.screenshotFile("p", id, "../result.json"))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(400));
        assertThatThrownBy(() -> service.screenshotFile("p", id, "..\\result.json"))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(400));
        assertThatThrownBy(() -> service.screenshotFile("p", id, "sub/n1.jpg"))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(400));
    }

    // ---------------------------------------------------------------- 첫 실행 브리핑

    private static final String BRIEFING_JSON = """
            {"summary": "화면 2개를 살펴봤어요.", "screens": [{"routeKey": "/", "note": "메뉴가 있어요"}],
             "tests": [{"title": "홈", "plain": "첫 화면이 뜨는지 봤어요"}], "resultNote": "통과했어요.", "cautions": [],
             "suggestions": [{"title": "로그인할 수 있다", "screenRouteKey": "/login", "priority": "높음", "why": "가장 많이 써요"},
                             {"title": "검색할 수 있다", "screenRouteKey": "/", "priority": "낮음", "why": "자주 써요"}]}
            """;

    private void siteMapWithTwoScreens() {
        when(siteAnalysisService.view("p")).thenReturn(new SiteAnalysisService.SiteMap("p", null, null, List.of(
                new SiteAnalysisService.Node("/", "첫 화면", null, "OBSERVED", false, 3, false, null, "http://site/",
                        false, false, 0, 0, 0, 0),
                new SiteAnalysisService.Node("/login", "로그인", null, "OBSERVED", false, 3, false, null,
                        "http://site/login", false, false, 0, 0, 0, 0)), List.of(), List.of()));
    }

    private AiBootstrapResponse passedWithBriefing() {
        when(siteAnalysisService.hasUsableNodes("p")).thenReturn(true);
        siteMapWithTwoScreens();
        when(llm.chat(any(), anyString(), anyString(), eq("첫 실행 브리핑"), eq("p"))).thenReturn(BRIEFING_JSON);
        runs(ExecutionStatus.PASSED);
        return service.start("p", "확인", null);
    }

    private static AiBootstrapBriefingActionRequest action(String name, String surfaceId, Object selected) {
        return new AiBootstrapBriefingActionRequest("1.0", new AiBootstrapBriefingActionRequest.Action(
                name, surfaceId, "addButton", "2026-11-23T00:00:00Z", Map.of("selected", selected)));
    }

    private static int status(Throwable e) {
        return ((ApiException) e).getStatus();
    }

    @Test
    void finishedRunCarriesAReadyBriefing() {
        AiBootstrapResponse response = passedWithBriefing();

        assertThat(response.phase()).isEqualTo("PASSED");
        assertThat(response.briefingStatus()).isEqualTo("READY");
        assertThat(response.briefing()).hasSize(2);
        assertThat(response.briefing().get(0)).containsKey("createSurface");
        assertThat(response.briefing().get(1)).containsKey("updateComponents");
        verify(llm).chat(any(), contains("개발 용어"), contains("- 홈"), eq("첫 실행 브리핑"), eq("p"));
    }

    @Test
    void unreadableBriefingFromLlmStillEndsReadyWithPlainBriefing() {
        // setUp 의 LLM 목은 브리핑 요청에도 spec 코드를 돌려준다 → JSON 이 아니므로 기본 브리핑
        when(siteAnalysisService.hasUsableNodes("p")).thenReturn(true);
        runs(ExecutionStatus.FAILED, ExecutionStatus.FAILED, ExecutionStatus.FAILED);

        AiBootstrapResponse response = service.start("p", "확인", null);

        assertThat(response.phase()).isEqualTo("FAILED");
        assertThat(response.briefingStatus()).isEqualTo("READY");
        assertThat(response.briefing()).hasSize(2);
    }

    @Test
    void errorBeforeAnyScreenOrSpecHasNoBriefing() {
        when(llm.chat(any(), anyString(), anyString(), eq("테스트 생성"), eq("p"))).thenReturn("");

        AiBootstrapResponse response = service.start("p", "확인", null);

        assertThat(response.phase()).isEqualTo("ERROR");
        assertThat(response.briefingStatus()).isNull();
        assertThat(response.briefing()).isEmpty();
        verify(llm, never()).chat(any(), anyString(), anyString(), eq("첫 실행 브리핑"), anyString());
    }

    @ParameterizedTest
    @CsvSource({
            "OpenAI API 호출 실패: 401, AI 키가 맞지 않아 테스트를 끝까지 만들지 못했어요. 관리자 설정에서 AI 키를 확인해 주세요.",
            "UNAUTHORIZED, AI 키가 맞지 않아 테스트를 끝까지 만들지 못했어요. 관리자 설정에서 AI 키를 확인해 주세요.",
            "API 키 오류, AI 키가 맞지 않아 테스트를 끝까지 만들지 못했어요. 관리자 설정에서 AI 키를 확인해 주세요.",
            "Invalid API key, AI 키가 맞지 않아 테스트를 끝까지 만들지 못했어요. 관리자 설정에서 AI 키를 확인해 주세요.",
            "Docker Runner 중지, 테스트를 실행할 환경이 준비되지 않아 실행하지 못했어요. 프로젝트 설정에서 실행 방식을 확인해 주세요.",
            "상주 러너 중지, 테스트를 실행할 환경이 준비되지 않아 실행하지 못했어요. 프로젝트 설정에서 실행 방식을 확인해 주세요.",
            "unexpected generation failure, 중간에 문제가 생겨 첫 테스트를 끝까지 하지 못했어요. 아래 오류 내용을 관리자에게 알려 주세요."
    })
    void errorAfterSiteAnalysisUsesPlainBriefing(String error, String resultNote) {
        when(siteAnalysisService.analyzeByUrl("p", SiteAnalysisService.QUICK_LIMITS))
                .thenReturn(new SiteAnalysisService.UrlOutcome("DOM", 2, 6, List.of(), null));
        siteMapWithTwoScreens();
        when(llm.chat(any(), anyString(), anyString(), eq("테스트 생성"), eq("p")))
                .thenThrow(new ApiException(502, error));

        AiBootstrapResponse response = service.start("p", "확인", null);

        assertThat(response.phase()).isEqualTo("ERROR");
        assertThat(response.error()).isEqualTo(error);
        assertThat(response.briefingStatus()).isEqualTo("READY");
        assertThat(briefingData(response)).containsEntry("resultNote", resultNote)
                .containsEntry("summary", "화면 2개를 살펴봤어요.")
                .containsEntry("screens", List.of(Map.of("title", "첫 화면", "path", "/"),
                        Map.of("title", "로그인", "path", "/login")))
                .containsEntry("candidates", List.of());
        assertThat(briefingComponents(response))
                .anySatisfy(c -> assertThat(c).containsEntry("id", "resultNotice").containsEntry("tone", "danger"))
                .anySatisfy(c -> assertThat(c).containsEntry("id", "plan").containsEntry("children", List.of("planHint")))
                .anySatisfy(c -> assertThat(c).containsEntry("id", "planHint").containsEntry("text",
                        "지금은 계획에 넣을 항목이 없어요. 문제를 해결한 뒤 AI 테스트 생성을 다시 해 보세요."))
                .noneMatch(c -> List.of("checkList", "addButton").contains(c.get("id")));
        verify(llm).chat(any(), anyString(), anyString(), eq("테스트 생성"), eq("p"));
        verifyNoMoreInteractions(llm);
    }

    @Test
    void errorBeforeExecutingKeepsTheWrittenSpecAndCanAddItToThePlan() {
        when(executions.triggerRun(eq("p"), isNull(), eq(AiBootstrapService.SPEC_PATH), isNull(), anyString(), anyBoolean()))
                .thenThrow(new ApiException(503, "상주 Docker Runner가 중지되어 있습니다."));
        when(planEntries.createAll(eq("p"), any())).thenReturn(1);

        AiBootstrapResponse response = service.start("p", "확인", null);

        assertThat(response.phase()).isEqualTo("ERROR");
        assertThat(response.briefingStatus()).isEqualTo("READY");
        assertThat(response.generatedFiles()).containsExactly(AiBootstrapService.SPEC_PATH);
        assertThat(briefingData(response)).containsEntry("screens", List.of())
                .containsEntry("candidates", List.of(Map.of("id", "test-0", "title", "홈", "badge", "이미 만든 테스트")))
                .containsEntry("selected", List.of("test-0"));
        assertThat(briefingComponents(response)).anySatisfy(c -> assertThat(c).containsEntry("id", "plan")
                .containsEntry("children", List.of("planHint", "checkList", "addButton")));
        verify(llm).chat(any(), anyString(), anyString(), eq("테스트 생성"), eq("p"));
        verifyNoMoreInteractions(llm);

        String id = response.bootstrapId();
        AiBootstrapResponse done = service.briefingAction("p", id,
                action("add_to_plan", "onboarding-" + id, List.of("test-0", "suggest-0")));

        assertThat(done.phase()).isEqualTo("ERROR");
        assertThat(done.briefingStatus()).isEqualTo("READY");
        assertThat(briefingData(done)).containsEntry("doneCount", 1);
        assertThat(briefingComponents(done)).anySatisfy(c -> assertThat(c).containsEntry("id", "plan")
                .containsEntry("children", List.of("planDone")));
        verify(planEntries).createAll("p", List.of(new PlanDtos.EntryRequest("홈", null, null, null, null, null)));
    }

    @Test
    void errorCheckingSelectorsStillIncludesTheSpecAlreadyWritten() {
        when(siteMapPromptService.check("p", SPEC)).thenThrow(new IllegalStateException("selector check failed"));

        AiBootstrapResponse response = service.start("p", "확인", null);

        assertThat(response.phase()).isEqualTo("ERROR");
        assertThat(response.briefingStatus()).isEqualTo("READY");
        assertThat(response.generatedFiles()).containsExactly(AiBootstrapService.SPEC_PATH);
        assertThat(briefingData(response))
                .containsEntry("candidates", List.of(Map.of("id", "test-0", "title", "홈", "badge", "이미 만든 테스트")));
        verify(files).writeFile("p", AiBootstrapService.SPEC_PATH, SPEC);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> briefingData(AiBootstrapResponse response) {
        Map<String, Object> create = (Map<String, Object>) response.briefing().get(0).get("createSurface");
        return (Map<String, Object>) create.get("dataModel");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> briefingComponents(AiBootstrapResponse response) {
        Map<String, Object> update = (Map<String, Object>) response.briefing().get(1).get("updateComponents");
        return (List<Map<String, Object>>) update.get("components");
    }

    @Test
    @SuppressWarnings("unchecked")
    void addToPlanCreatesOnlyKnownCandidatesOnce() {
        String id = passedWithBriefing().bootstrapId();
        when(planEntries.createAll(eq("p"), any())).thenReturn(2);

        AiBootstrapResponse first = service.briefingAction("p", id,
                action("add_to_plan", "onboarding-" + id, List.of("test-0", "suggest-1", "suggest-99")));
        AiBootstrapResponse second = service.briefingAction("p", id,
                action("add_to_plan", "onboarding-" + id, List.of("suggest-0")));

        org.mockito.ArgumentCaptor<List<com.playops.api.dto.PlanDtos.EntryRequest>> captor =
                org.mockito.ArgumentCaptor.forClass(List.class);
        verify(planEntries, times(1)).createAll(eq("p"), captor.capture());
        assertThat(captor.getValue()).containsExactly(
                new com.playops.api.dto.PlanDtos.EntryRequest("홈", null, null, null, null, null),
                new com.playops.api.dto.PlanDtos.EntryRequest("검색할 수 있다", "/", "자주 써요", null, null, "LOW"));
        assertThat(second).isEqualTo(first);
        Map<String, Object> update = (Map<String, Object>) second.briefing().get(1).get("updateComponents");
        assertThat((List<Map<String, Object>>) update.get("components"))
                .anySatisfy(c -> assertThat(c).containsEntry("id", "plan").containsEntry("children", List.of("planDone")))
                .anySatisfy(c -> assertThat(c).containsEntry("id", "planDone")
                        .containsEntry("text", "2건을 계획에 넣었어요. 계획 탭에서 볼 수 있어요."));
        Map<String, Object> create = (Map<String, Object>) second.briefing().get(0).get("createSurface");
        assertThat((Map<String, Object>) create.get("dataModel")).containsEntry("doneCount", 2);
    }

    @Test
    void addToPlanRejectsWrongActionSurfaceOrBootstrap() {
        String id = passedWithBriefing().bootstrapId();

        assertThatThrownBy(() -> service.briefingAction("p", id, action("delete_all", "onboarding-" + id, List.of("test-0"))))
                .satisfies(e -> assertThat(status(e)).isEqualTo(400));
        assertThatThrownBy(() -> service.briefingAction("p", id, action("add_to_plan", "onboarding-other", List.of("test-0"))))
                .satisfies(e -> assertThat(status(e)).isEqualTo(400));
        assertThatThrownBy(() -> service.briefingAction("p", id, new AiBootstrapBriefingActionRequest("0.9",
                new AiBootstrapBriefingActionRequest.Action("add_to_plan", "onboarding-" + id, null, null, Map.of()))))
                .satisfies(e -> assertThat(status(e)).isEqualTo(400));
        assertThatThrownBy(() -> service.briefingAction("p", id, action("add_to_plan", "onboarding-" + id, List.of("nope"))))
                .satisfies(e -> assertThat(status(e)).isEqualTo(400));
        assertThatThrownBy(() -> service.briefingAction("other", id, action("add_to_plan", "onboarding-" + id, List.of("test-0"))))
                .satisfies(e -> assertThat(status(e)).isEqualTo(404));
        assertThatThrownBy(() -> service.briefingAction("p", "missing", action("add_to_plan", "onboarding-missing", List.of("test-0"))))
                .satisfies(e -> assertThat(status(e)).isEqualTo(404));
        verify(planEntries, never()).createAll(anyString(), any());
    }
}
