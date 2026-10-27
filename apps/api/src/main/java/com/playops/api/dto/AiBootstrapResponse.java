package com.playops.api.dto;

import java.time.Instant;
import java.util.List;

/**
 * 등록 직후 첫 테스트 생성 파이프라인(사이트 탐색 → 코드 생성 → 실행 → 자율 교정)의 현재 상태.
 * 시작 요청과 상태 조회가 같은 모양을 돌려주고, 프론트는 phase 가 끝 상태가 될 때까지 다시 읽는다.
 *
 * phase: ANALYZING_SITE · GENERATING · RUNNING · HEALING · PASSED · FAILED · ERROR
 * healAttempt 는 지금(또는 마지막으로) 몇 번째 교정인지, maxHealAttempts 는 교정 상한이다.
 * estimatedDurationMs 는 최근 실행 이력 평균에서 뽑은 1회 실행 예상 시간으로, 카운트다운 표시에 쓰인다.
 */
public record AiBootstrapResponse(
        String bootstrapId,
        String phase,
        int healAttempt,
        int maxHealAttempts,
        Long executionId,
        List<String> generatedFiles,
        String specPath,
        long estimatedDurationMs,
        SiteAnalysisSummary siteAnalysis,
        List<String> warnings,
        String error,
        String failureLog,
        Instant startedAt,
        Instant finishedAt
) {
    /** 이번 생성에 쓴 사이트 탐색 결과. 탐색을 건너뛰었으면 null 이다. */
    public record SiteAnalysisSummary(String mode, int pages, int verifiedSelectors) {}
}
