package com.playops.api.config;

import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.repository.ExecutionRepository;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 재시작 정리 (#137). 정리기는 웹 서버가 요청을 받기 시작한 뒤에 돈다.
 * 그 사이 새로 시작한 실행(실행 #29 사례)은 끊긴 실행이 아니므로 건드리지 않는다.
 */
class ExecutionStartupCleanerTest {

    private static Execution running(Instant createdAt) {
        Execution e = new Execution();
        e.setStatus(ExecutionStatus.RUNNING);
        e.setStartedAt(createdAt);
        ReflectionTestUtils.setField(e, "createdAt", createdAt);
        return e;
    }

    @Test
    void onlyRunsStartedBeforeThisBootAreMarkedAsInterrupted() {
        ExecutionRepository repository = mock(ExecutionRepository.class);
        Execution beforeRestart = running(Instant.now().minusSeconds(60));
        ExecutionStartupCleaner cleaner = new ExecutionStartupCleaner(repository); // 빈 생성 = 이번 기동 시각
        Execution startedAfterBoot = running(Instant.now().plusMillis(1)); // 요청을 받기 시작한 뒤 만든 실행
        when(repository.findByStatusIn(any())).thenReturn(List.of(beforeRestart, startedAfterBoot));

        cleaner.run(null);

        assertThat(beforeRestart.getStatus()).isEqualTo(ExecutionStatus.ERROR);
        assertThat(beforeRestart.getErrorMessage()).contains("재시작");
        assertThat(startedAfterBoot.getStatus()).isEqualTo(ExecutionStatus.RUNNING);
        assertThat(startedAfterBoot.getErrorMessage()).isNull();
    }
}
