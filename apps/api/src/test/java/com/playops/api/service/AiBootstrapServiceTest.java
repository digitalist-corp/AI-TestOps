package com.playops.api.service;

import com.playops.api.dto.AiBootstrapResponse;
import com.playops.api.dto.ExecutionCaseResultResponse;
import com.playops.api.dto.ExecutionDetailResponse;
import com.playops.api.dto.ExecutionResponse;
import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.entity.Project;
import com.playops.api.repository.ExecutionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.task.SyncTaskExecutor;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
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
}
