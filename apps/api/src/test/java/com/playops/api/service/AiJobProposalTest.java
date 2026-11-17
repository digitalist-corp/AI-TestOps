package com.playops.api.service;

import com.playops.api.entity.AiJob;
import com.playops.api.entity.AiJobStatus;
import com.playops.api.entity.AiModelProvider;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.AiJobRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 수정 제안(PROPOSED)의 진행 · 닫기. */
class AiJobProposalTest {

    private final AiJobRepository repository = mock(AiJobRepository.class);
    private final LlmGatewayService llm = mock(LlmGatewayService.class);
    private final AiProviderSettingsService providers = mock(AiProviderSettingsService.class);
    private final AiJobService self = mock(AiJobService.class);
    private final AiJobService service = new AiJobService(repository, mock(ProjectService.class), mock(ExecutionLogService.class),
            mock(AiRunnerDockerService.class), mock(AiDiffRiskEvaluatorService.class), mock(AiPostApplyVerificationService.class),
            mock(SlackNotificationService.class), mock(GitCommitService.class), llm, mock(SiteMapPromptService.class),
            providers, self);

    private final AiJob job = new AiJob();

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(job, "id", 5L);
        job.setStatus(AiJobStatus.PROPOSED);
        when(repository.findById(5L)).thenReturn(Optional.of(job));
        when(repository.save(any(AiJob.class))).thenAnswer(inv -> inv.getArgument(0));
        when(llm.defaultProvider()).thenReturn(AiModelProvider.GPT);
    }

    @Test
    void proceedStartsTheExistingCodeFixRun() {
        when(providers.hasKey(AiModelProvider.GPT)).thenReturn(true);

        AiJob started = service.proceed(5L, 9L);

        assertThat(started.getStatus()).isEqualTo(AiJobStatus.PENDING);
        assertThat(started.getRequestedBy()).isEqualTo(9L);
        assertThat(started.getAiModelProvider()).isEqualTo(AiModelProvider.GPT);
        assertThat(started.getCallbackToken()).isNotBlank();
        verify(self).runAsync(5L);
    }

    @Test
    void proceedNeedsAnAiKey() {
        assertThatThrownBy(() -> service.proceed(5L, 9L)).isInstanceOf(ApiException.class);
        assertThat(job.getStatus()).isEqualTo(AiJobStatus.PROPOSED);
        verify(self, never()).runAsync(anyLong());
    }

    @Test
    void dismissClosesWithoutChangingAnything() {
        AiJob closed = service.dismiss(5L, 9L);

        assertThat(closed.getStatus()).isEqualTo(AiJobStatus.CANCELED);
        assertThat(closed.getReviewedBy()).isEqualTo(9L);
        verify(self, never()).runAsync(anyLong());
    }

    @Test
    void onlyProposalsCanBeProceededOrDismissed() {
        when(providers.hasKey(AiModelProvider.GPT)).thenReturn(true);
        job.setStatus(AiJobStatus.NEEDS_REVIEW);

        assertThatThrownBy(() -> service.proceed(5L, 9L)).isInstanceOf(ApiException.class).hasMessageContaining("NEEDS_REVIEW");
        assertThatThrownBy(() -> service.dismiss(5L, 9L)).isInstanceOf(ApiException.class);
        assertThat(job.getStatus()).isEqualTo(AiJobStatus.NEEDS_REVIEW);
    }
}
