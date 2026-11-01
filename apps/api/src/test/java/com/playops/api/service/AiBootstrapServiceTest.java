package com.playops.api.service;

import com.playops.api.dto.AiBootstrapCredentialsRequest;
import com.playops.api.dto.AiBootstrapResponse;
import com.playops.api.dto.ExecutionCaseResultResponse;
import com.playops.api.dto.ExecutionDetailResponse;
import com.playops.api.dto.ExecutionResponse;
import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.entity.Project;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ExecutionRepository;
import com.playops.api.util.ProjectEnvVariables;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
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
    private final AiBootstrapService service = new AiBootstrapService(projectService, siteAnalysisService,
            siteMapPromptService, llm, files, executions, executionRepository, new SyncTaskExecutor());

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
}
