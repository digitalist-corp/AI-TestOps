package com.playops.api.dto;

import java.time.Instant;
import java.util.List;

/**
 * 등록 직후 첫 테스트 생성 파이프라인(사이트 탐색 → 코드 생성 → 실행 → 자율 교정)의 현재 상태.
 * 시작 요청과 상태 조회가 같은 모양을 돌려주고, 프론트는 phase 가 끝 상태가 될 때까지 다시 읽는다.
 *
 * phase: ANALYZING_SITE · NEEDS_CREDENTIALS · LOGGING_IN · GENERATING · RUNNING · HEALING · PASSED · FAILED · ERROR
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
        Instant finishedAt,
        List<ProgressEvent> events,
        String currentUrl,
        int visitedCount,
        CredentialRequest credentialRequest
) {
    public AiBootstrapResponse(
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
        this(bootstrapId, phase, healAttempt, maxHealAttempts, executionId, generatedFiles, specPath,
                estimatedDurationMs, siteAnalysis, warnings, error, failureLog, startedAt, finishedAt,
                List.of(), null, 0, null);
    }

    /** 이번 생성에 쓴 사이트 탐색 결과. 탐색을 건너뛰었으면 null 이다. */
    public record SiteAnalysisSummary(String mode, int pages, int verifiedSelectors) {}

    /** 사이트 탐색 중 실시간으로 쌓이는 진행 이벤트 한 줄. */
    public record ProgressEvent(
            String ts,
            String type,
            String url,
            Integer depth,
            String title,
            Integer elements,
            String screenshot,
            String message,
            List<LoginField> fields
    ) {}

    /** 로그인 폼에서 찾은 입력 칸 정보. */
    public record LoginField(String name, String label, String type) {}

    /** 로그인이 필요한 사이트에서 사용자에게 요청하는 로그인 폼 정보. */
    public record CredentialRequest(String url, List<LoginField> fields) {}
}
