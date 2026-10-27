package com.playops.api.config;

import com.playops.api.dto.RunnerCapacityRequest;
import com.playops.api.service.RunnerCapacitySettingsService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/** @EnableScheduling은 ExecutionScheduleService의 매분 예약 실행 폴러(@Scheduled)에 필요하다. */
@Configuration
@EnableAsync
@EnableScheduling
public class AsyncConfig {

    @Bean(name = "executionExecutor")
    public ResizableThreadPoolTaskExecutor executionExecutor(RunnerCapacitySettingsService settingsService) {
        RunnerCapacityRequest settings = settingsService.currentSettings();
        ResizableThreadPoolTaskExecutor executor = new ResizableThreadPoolTaskExecutor();
        executor.setCorePoolSize(settings.baseConcurrency());
        executor.setMaxPoolSize(settingsService.effectiveMaxConcurrency(settings));
        executor.setQueueCapacity(settings.queueCapacity());
        executor.setKeepAliveSeconds(settings.scaleDownIdleSeconds());
        executor.setThreadNamePrefix("playops-exec-");
        executor.initialize();
        return executor;
    }

    /** AI job(현재 CODE_FIX)은 테스트 실행 용량 풀과 경쟁하지 않도록 별도의 작은 풀을 쓴다. */
    @Bean(name = "aiJobExecutor")
    public ThreadPoolTaskExecutor aiJobExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(20);
        executor.setThreadNamePrefix("playops-ai-job-");
        executor.initialize();
        return executor;
    }

    /**
     * 등록 직후 첫 테스트 생성 파이프라인. 사이트 탐색 컨테이너와 테스트 실행이 끝날 때까지 스레드를 오래 붙잡으므로
     * aiJobExecutor 와 나눠 둬야 CODE_FIX · 구조 탭 탐색을 막지 않는다.
     */
    @Bean(name = "aiBootstrapExecutor")
    public ThreadPoolTaskExecutor aiBootstrapExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(20);
        executor.setThreadNamePrefix("playops-ai-bootstrap-");
        executor.initialize();
        return executor;
    }

    /**
     * AI 적용 사후 검증(안전망)은 검증용 Execution이 끝날 때까지 폴링하며 대기하는 스레드를 오래 붙잡는다.
     * aiJobExecutor(작업당 컨테이너 실행)와 별도 풀을 둬야 검증 대기가 새 CODE_FIX job 처리를 막지 않는다.
     */
    @Bean(name = "aiVerificationExecutor")
    public ThreadPoolTaskExecutor aiVerificationExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("playops-ai-verify-");
        executor.initialize();
        return executor;
    }
}
