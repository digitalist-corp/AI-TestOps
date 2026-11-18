package com.playops.api.dto;

import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionStatus;

import java.time.Instant;

public record ExecutionResponse(
        Long id,
        String projectId,
        ExecutionStatus status,
        String grepFilter,
        String specPath,
        String caseTitle,
        Integer totalTests,
        Integer passedTests,
        Integer failedTests,
        Integer skippedTests,
        Long durationMs,
        String errorMessage,
        Instant startedAt,
        Instant finishedAt,
        Instant createdAt,
        /** 결함 다시 실행(#82)이면 원래 실행 id */
        Long rerunOf
) {
    public static ExecutionResponse from(Execution e) {
        return new ExecutionResponse(
                e.getId(),
                e.getProjectId(),
                e.getStatus(),
                e.getGrepFilter(),
                e.getSpecPath(),
                e.getCaseTitle(),
                e.getTotalTests(),
                e.getPassedTests(),
                e.getFailedTests(),
                e.getSkippedTests(),
                e.getDurationMs(),
                e.getErrorMessage(),
                e.getStartedAt(),
                e.getFinishedAt(),
                e.getCreatedAt(),
                e.getRerunOf()
        );
    }
}
