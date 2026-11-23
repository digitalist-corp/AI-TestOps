package com.playops.api.dto;

import java.time.Instant;
import java.util.List;

/** 통합 결함 리스트(F-4, #80) 응답. 결함 = 사용 중 계획 항목(파일 경로 + grep)의 실패. 따로 저장하지 않고 실행 결과로 계산한다. */
public final class DefectDtos {

    private DefectDtos() {}

    /** 결함 흐름의 실행 하나. status: PASSED | FAILED. rerunOf: 결함 다시 실행이면 원래 실행(#82) */
    public record DefectRun(Long executionId, String status, Instant at, Long rerunOf) {}

    /**
     * status: OPEN(최근 실행이 실패) | RESOLVED(실패 뒤 실행에서 통과).
     * firstFailed*: 이번 결함을 처음 발견한 실행 — 마지막으로 통과한 뒤 첫 실패. failCount 는 그때부터 실패한 실행 수.
     * last*: 이 케이스의 가장 최근 실행. resolved*: 해결한 실행(실패 뒤 첫 통과), 미해결이면 비어 있다.
     * errorMessage: 마지막 실패의 오류. routeKeys: 이 테스트가 지나가는 화면(모르면 비어 있음).
     * runs: 발견 실행부터 마지막 실행까지 오래된 순.
     * fixCategory: 서버 분류 APP_CODE · APP_API(제품 코드 수정 제안 후보) · TEST · ENVIRONMENT · UNKNOWN. 사람이 고친 원인이 규칙보다 앞선다.
     */
    public record Defect(String specPath, String grep, String title, String describePath, String status,
                         String assignee, Long assigneeUserId, int failCount,
                         Long firstFailedExecutionId, Instant firstFailedAt,
                         Long lastExecutionId, Instant lastRunAt,
                         Long resolvedExecutionId, Instant resolvedAt,
                         String errorMessage, List<String> routeKeys, List<DefectRun> runs, String fixCategory) {

        public Defect withLinks(List<String> keys, List<DefectRun> linkedRuns) {
            return new Defect(specPath, grep, title, describePath, status, assignee, assigneeUserId, failCount,
                    firstFailedExecutionId, firstFailedAt, lastExecutionId, lastRunAt, resolvedExecutionId, resolvedAt,
                    errorMessage, keys, linkedRuns, fixCategory);
        }

        public Defect withCategory(String category) {
            return new Defect(specPath, grep, title, describePath, status, assignee, assigneeUserId, failCount,
                    firstFailedExecutionId, firstFailedAt, lastExecutionId, lastRunAt, resolvedExecutionId, resolvedAt,
                    errorMessage, routeKeys, runs, category);
        }

        /** 마지막으로 실패한 실행 */
        public Long lastFailedExecutionId() {
            for (int i = runs.size() - 1; i >= 0; i--) {
                if ("FAILED".equals(runs.get(i).status())) return runs.get(i).executionId();
            }
            return firstFailedExecutionId;
        }
    }

    /** 결함 다시 실행(#82). items 가 비면 미해결 결함 전부(실패만 다시 실행). */
    public record RerunRequest(List<PlanDtos.ItemKey> items) {}

    /** open · resolved 는 돌려준 목록 안에서 센다. 첫 화면 · 대시보드의 미해결 결함 수는 필터 없이 부른 open 이다. */
    public record DefectResponse(List<Defect> defects, int open, int resolved) {}
}
