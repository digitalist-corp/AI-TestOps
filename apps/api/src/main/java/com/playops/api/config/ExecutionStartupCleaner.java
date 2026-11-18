package com.playops.api.config;

import com.playops.api.entity.ExecutionStatus;
import com.playops.api.repository.ExecutionRepository;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;

/**
 * 서버가 꺼지면서 끝나지 못한 실행을 오류로 정리한다.
 * ApplicationRunner 는 웹 서버가 요청을 받기 시작한 뒤에 돌아서, 그 사이 새로 시작한 실행까지 잡지 않게
 * 이번 기동 전에 만든 실행만 정리한다 (#137). 빈은 웹 서버가 열리기 전에 만들어지므로 생성 시각을 기동 시각으로 쓴다.
 */
@Component
public class ExecutionStartupCleaner implements ApplicationRunner {

    private final ExecutionRepository executionRepository;
    private final Instant bootedAt = Instant.now();

    public ExecutionStartupCleaner(ExecutionRepository executionRepository) {
        this.executionRepository = executionRepository;
    }

    @Override
    public void run(ApplicationArguments args) {
        var interrupted = executionRepository.findByStatusIn(List.of(
                ExecutionStatus.PENDING,
                ExecutionStatus.RUNNING,
                ExecutionStatus.CANCEL_REQUESTED
        )).stream().filter(e -> e.getCreatedAt() == null || e.getCreatedAt().isBefore(bootedAt)).toList();
        for (var execution : interrupted) {
            execution.setStatus(ExecutionStatus.ERROR);
            execution.setFinishedAt(Instant.now());
            execution.setErrorMessage("API 서버 재시작 또는 중단으로 실행 상태를 확인할 수 없어 종료 처리했습니다.");
            if (execution.getStartedAt() != null) {
                execution.setDurationMs(execution.getFinishedAt().toEpochMilli() - execution.getStartedAt().toEpochMilli());
            }
        }
        if (!interrupted.isEmpty()) {
            executionRepository.saveAll(interrupted);
        }
    }
}
