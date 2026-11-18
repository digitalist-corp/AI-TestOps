package com.playops.api.service;

import com.playops.api.config.PlayOpsProperties;
import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ExecutionCaseResultRepository;
import com.playops.api.repository.ExecutionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 같은 프로젝트 동시 실행 막기 (3차 3번). 전체 · 선택 · 스위트 · 결함 다시 실행 · 채팅이 모두 지나는 triggerRun 한 곳에서
 * PENDING · RUNNING · CANCEL_REQUESTED 실행이 있으면 409. 동시에 들어온 요청 둘 중 하나만 실행을 만든다.
 */
class ExecutionRunLockTest {

    @TempDir
    Path storage;

    private ExecutionRepository executions;
    private TestExecutionService testExecutionService;
    private ExecutionQueryService service;
    /** 흉내 낸 DB: 실행이 만들어지면 그 프로젝트는 실행 중 */
    private final AtomicBoolean p1Active = new AtomicBoolean(false);
    private final AtomicInteger created = new AtomicInteger();

    @BeforeEach
    void setUp() {
        executions = mock(ExecutionRepository.class);
        testExecutionService = mock(TestExecutionService.class);
        when(executions.existsByProjectIdAndStatusIn(eq("p1"), any())).thenAnswer(inv -> p1Active.get());
        when(executions.existsByProjectIdAndStatusIn(eq("p2"), any())).thenReturn(true);
        when(testExecutionService.createExecution(anyString(), any(), any(), any(), any(), anyBoolean())).thenAnswer(inv -> {
            Thread.sleep(50); // 저장이 끝나기 전에 다른 요청이 확인하는 틈
            created.incrementAndGet();
            p1Active.set(true);
            Execution e = mock(Execution.class);
            when(e.getId()).thenReturn((long) created.get());
            when(e.getProjectId()).thenReturn("p1");
            when(e.getStatus()).thenReturn(ExecutionStatus.PENDING);
            return e;
        });
        service = new ExecutionQueryService(executions, mock(ExecutionCaseResultRepository.class), testExecutionService,
                new PlayOpsProperties(storage.resolve("projects").toString(), storage.toString(), false,
                        new PlayOpsProperties.Security("0123456789abcdef0123456789abcdef")));
    }

    @Test
    void runningProjectRejectsANewRunWith409() {
        p1Active.set(true);

        assertThatThrownBy(() -> service.triggerRun("p1", null, null, null, null, false))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(409))
                .hasMessageContaining("이미 실행 중입니다");
        verify(testExecutionService, never()).createExecution(anyString(), any(), any(), any(), any(), anyBoolean());
    }

    @Test
    void anotherProjectRunningDoesNotBlock() {
        service.triggerRun("p1", null, null, null, null, false);

        assertThat(created.get()).isEqualTo(1);
        verify(executions).existsByProjectIdAndStatusIn("p1",
                List.of(ExecutionStatus.PENDING, ExecutionStatus.RUNNING, ExecutionStatus.CANCEL_REQUESTED));
    }

    @Test
    void twoRequestsAtOnceCreateOnlyOneRun() throws Exception {
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger rejected = new AtomicInteger();
        Runnable request = () -> {
            try {
                start.await();
                service.triggerRun("p1", null, null, null, null, false);
            } catch (ApiException e) {
                if (e.getStatus() == 409) rejected.incrementAndGet();
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        };
        Thread a = new Thread(request);
        Thread b = new Thread(request);
        a.start();
        b.start();
        start.countDown();
        a.join();
        b.join();

        assertThat(created.get()).isEqualTo(1);
        assertThat(rejected.get()).isEqualTo(1);
    }
}
