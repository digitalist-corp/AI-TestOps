package com.playops.api.service;

import com.playops.api.entity.AiJob;
import com.playops.api.entity.AiJobStatus;
import com.playops.api.entity.AiJobType;
import com.playops.api.entity.AiModelProvider;
import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.entity.Project;
import com.playops.api.repository.AiJobRepository;
import com.playops.api.repository.ExecutionCaseResultRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;
import org.mockito.ArgumentCaptor;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class FixProposalServiceTest {

    private static final String NOT_FOUND = "locator.click: Timeout 30000ms exceeded.\n  - waiting for getByRole('link', { name: '홈' })";

    private final AiJobRepository jobs = mock(AiJobRepository.class);
    private final ExecutionCaseResultRepository cases = mock(ExecutionCaseResultRepository.class);
    private final NotificationService notifications = mock(NotificationService.class);
    private final AiProviderSettingsService providers = mock(AiProviderSettingsService.class);
    private final LlmGatewayService llm = mock(LlmGatewayService.class);
    private final ProjectService projects = mock(ProjectService.class);
    private final FixProposalService self = mock(FixProposalService.class);
    private final FixProposalService service = new FixProposalService(jobs, cases, notifications, providers, llm, projects, self);

    @TempDir
    Path root;

    @BeforeEach
    void setUp() {
        when(jobs.save(any(AiJob.class))).thenAnswer(inv -> {
            AiJob job = inv.getArgument(0);
            if (job.getId() == null) ReflectionTestUtils.setField(job, "id", 100L);
            return job;
        });
        when(llm.defaultProvider()).thenReturn(AiModelProvider.CLAUDE);
        when(projects.getProjectPath("demo")).thenReturn(root);
    }

    private static Project project() {
        Project p = new Project();
        p.setProjectId("demo");
        p.setProjectName("Demo");
        return p;
    }

    private static Execution execution(ExecutionStatus status, String source, String caseTitle) {
        Execution e = new Execution();
        e.setId(7L);
        e.setProjectId("demo");
        e.setStatus(status);
        e.setSource(source);
        e.setCaseTitle(caseTitle);
        return e;
    }

    private static ExecutionCaseResult result(String spec, String title, String status, String error) {
        ExecutionCaseResult r = new ExecutionCaseResult();
        r.setExecutionId(7L);
        r.setSpecPath(spec);
        r.setCaseTitle(title);
        r.setStatus(status);
        r.setErrorMessage(error);
        return r;
    }

    private List<AiJob> savedJobs() {
        ArgumentCaptor<AiJob> captor = ArgumentCaptor.forClass(AiJob.class);
        verify(jobs, atLeastOnce()).save(captor.capture());
        return captor.getAllValues();
    }

    @Test
    void failedRunProposesOneFixPerFailedSpecAndNotifiesOnce() {
        when(cases.findByExecutionIdOrderByIdAsc(7L)).thenReturn(List.of(
                result("tests/a.spec.ts", "로그인", "FAILED", NOT_FOUND),
                result("tests/a.spec.ts", "로그아웃", "FAILED", "Error: 알 수 없는 오류"),
                result("tests/b.spec.ts", "결제", "FAILED", "Error: 알 수 없는 오류"),
                result("tests/c.spec.ts", "홈", "PASSED", null)));

        service.onExecutionFinished(execution(ExecutionStatus.FAILED, "MANUAL", null), project());

        List<AiJob> saved = savedJobs();
        assertThat(saved).hasSize(2);
        AiJob first = saved.get(0);
        assertThat(first.getJobType()).isEqualTo(AiJobType.CODE_FIX);
        assertThat(first.getStatus()).isEqualTo(AiJobStatus.PROPOSED);
        assertThat(first.getRequestedBy()).isNull();
        assertThat(first.isAutoCreated()).isTrue();
        assertThat(first.getFailedExecutionId()).isEqualTo(7L);
        assertThat(first.getTargetSpecPath()).isEqualTo("tests/a.spec.ts");
        assertThat(first.getSummary()).isEqualTo("'홈' 링크를 찾지 못했습니다 · 로그인");
        assertThat(first.getInstruction()).isEqualTo(FixProposalRules.PLAN_SELECTOR);
        assertThat(saved.get(1).getTargetSpecPath()).isEqualTo("tests/b.spec.ts");
        verify(notifications).fixProposed(any(Project.class), eq(7L), eq(2));
        verify(self, never()).polishAsync(any());
    }

    @Test
    void reportPathsRelativeToTestDirBecomeProjectPaths() throws Exception {
        Files.createDirectories(root.resolve("tests/sub"));
        Files.writeString(root.resolve("tests/sub/a.spec.ts"), "");
        Files.writeString(root.resolve("top.spec.ts"), "");

        assertThat(FixProposalService.projectRelative(root, "sub/a.spec.ts")).isEqualTo("tests/sub/a.spec.ts");
        assertThat(FixProposalService.projectRelative(root, "top.spec.ts")).isEqualTo("top.spec.ts");
        assertThat(FixProposalService.projectRelative(root, "missing.spec.ts")).isEqualTo("missing.spec.ts");
        assertThat(FixProposalService.projectRelative(root, "../../etc/passwd")).isEqualTo("../../etc/passwd");
    }

    @Test
    void polishesInTheBackgroundOnlyWhenAnAiKeyIsRegistered() {
        when(providers.hasKey(AiModelProvider.CLAUDE)).thenReturn(true);
        when(cases.findByExecutionIdOrderByIdAsc(7L)).thenReturn(List.of(result("tests/a.spec.ts", "로그인", "FAILED", NOT_FOUND)));

        service.onExecutionFinished(execution(ExecutionStatus.FAILED, "SCHEDULED", null), project());

        verify(self).polishAsync(List.of(100L));
    }

    @Test
    void skipsRunsThatAreNotPlainFailures() {
        service.onExecutionFinished(execution(ExecutionStatus.ERROR, "MANUAL", null), project());
        service.onExecutionFinished(execution(ExecutionStatus.FAILED, "AI_POST_APPLY", null), project());
        service.onExecutionFinished(execution(ExecutionStatus.FAILED, "MANUAL", "AI 초기 케이스: 로그인"), project());

        verify(cases, never()).findByExecutionIdOrderByIdAsc(anyLong());
        verify(jobs, never()).save(any());
    }

    @Test
    void skipsSpecsThatAlreadyHaveAnOpenJobAndRunsWithoutCaseResults() {
        when(cases.findByExecutionIdOrderByIdAsc(7L)).thenReturn(List.of(result("tests/a.spec.ts", "로그인", "FAILED", NOT_FOUND)));
        when(jobs.existsByProjectIdAndTargetSpecPathAndStatusIn(eq("demo"), eq("tests/a.spec.ts"), anyCollection())).thenReturn(true);

        service.onExecutionFinished(execution(ExecutionStatus.FAILED, "MANUAL", null), project());
        when(cases.findByExecutionIdOrderByIdAsc(7L)).thenReturn(List.of());
        service.onExecutionFinished(execution(ExecutionStatus.FAILED, "MANUAL", null), project());

        verify(jobs, never()).save(any());
        verify(notifications, never()).fixProposed(any(), anyLong(), any(Integer.class));
    }

    @Test
    void stopsAtTheDailyLimitAndThreeSpecsPerRun() {
        when(cases.findByExecutionIdOrderByIdAsc(7L)).thenReturn(List.of(
                result("tests/a.spec.ts", "a", "FAILED", null),
                result("tests/b.spec.ts", "b", "FAILED", null),
                result("tests/c.spec.ts", "c", "FAILED", null),
                result("tests/d.spec.ts", "d", "FAILED", null)));
        when(jobs.countByProjectIdAndAutoCreatedTrueAndCreatedAtAfter(eq("demo"), any())).thenReturn(18L);

        service.onExecutionFinished(execution(ExecutionStatus.FAILED, "MANUAL", null), project());

        assertThat(savedJobs()).hasSize(2);
    }

    @Test
    void neverBreaksTheRunWhenSomethingGoesWrong() {
        when(cases.findByExecutionIdOrderByIdAsc(7L)).thenThrow(new RuntimeException("db down"));

        service.onExecutionFinished(execution(ExecutionStatus.FAILED, "MANUAL", null), project());
    }

    @Test
    void polishKeepsTheRulePlanWhenTheAnswerIsEmptyOrTooLong() {
        AiJob job = new AiJob();
        ReflectionTestUtils.setField(job, "id", 100L);
        job.setProjectId("demo");
        job.setStatus(AiJobStatus.PROPOSED);
        job.setFailedExecutionId(7L);
        job.setTargetSpecPath("tests/a.spec.ts");
        job.setInstruction(FixProposalRules.PLAN_SELECTOR);
        when(jobs.findById(100L)).thenReturn(Optional.of(job));
        when(cases.findByExecutionIdOrderByIdAsc(7L)).thenReturn(List.of(result("tests/a.spec.ts", "로그인", "FAILED", NOT_FOUND)));

        when(llm.chat(any(), anyString(), anyString(), eq("FIX_PROPOSAL"), eq("demo"))).thenReturn("  ");
        service.polishAsync(List.of(100L));
        when(llm.chat(any(), anyString(), anyString(), eq("FIX_PROPOSAL"), eq("demo"))).thenReturn("가".repeat(301));
        service.polishAsync(List.of(100L));
        verify(jobs, never()).save(any());

        when(llm.chat(any(), anyString(), anyString(), eq("FIX_PROPOSAL"), eq("demo"))).thenReturn(" '홈' 링크를 구조 지도의 이름표로 바꿔 고칠게요. ");
        service.polishAsync(List.of(100L));
        assertThat(job.getInstruction()).isEqualTo("'홈' 링크를 구조 지도의 이름표로 바꿔 고칠게요.");

        job.setStatus(AiJobStatus.PENDING);
        job.setInstruction("x");
        service.polishAsync(List.of(100L));
        assertThat(job.getInstruction()).isEqualTo("x");
    }
}
