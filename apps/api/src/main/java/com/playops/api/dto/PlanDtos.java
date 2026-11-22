package com.playops.api.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/** 테스트 계획 표(F-1) 요청·응답. 계획 항목 = 테스트 케이스 하나 (파일 경로 + grep). */
public final class PlanDtos {

    private PlanDtos() {}

    /**
     * lastStatus · prevStatus: PASSED | FAILED | null(해당 실행 없음). priority: HIGH | MEDIUM | LOW | null.
     * defectStatus: OPEN | RESOLVED | null. defectFailCount: 최근 연속 실패 수, 결함이 없으면 0.
     * parentEnabled: 파일 · 상위 묶음이 모두 사용 중인지. false 면 이 행만 켜도 실행되지 않는다.
     * assignee · assigneeUserId: 담당자 이름과 계정(#119). 계정이 없으면 이관 전에 손으로 쓴 이름만 있다.
     * updatedByName · updatedAt: 계획 칸을 마지막으로 고친 사람 · 때 (#118). 고친 적이 없으면 비어 있다.
     */
    public record PlanItem(String specPath, String grep, String title, String describePath, int line,
                           boolean enabled, boolean parentEnabled, Integer sortOrder, String assignee, Long assigneeUserId,
                           LocalDate dueDate, String priority, String lastStatus, Instant lastRunAt,
                           String prevStatus, Instant prevRunAt, String defectStatus, int defectFailCount,
                           String updatedByName, Instant updatedAt) {}

    /** passed · failed · notRun 은 사용 중 항목만 센다. completionRate = passed / enabled (0~1). */
    public record PlanSummary(int total, int enabled, int disabled, int passed, int failed, int notRun,
                              double completionRate) {}

    public record PlanResponse(List<PlanItem> items, PlanSummary summary) {}

    public record ItemKey(String specPath, String grep) {}

    /**
     * 한 행 저장. enabled 가 null 이면 사용 여부는 그대로, 계획 칸(담당자 · 마감일 · 우선순위)은 보낸 값으로 덮어쓴다(null = 비움).
     * 담당자는 assigneeUserId(프로젝트 멤버)로 고른다. 없으면 assignee 글자만 남긴다(이관 못 한 옛 이름을 지우지 않도록).
     */
    public record ItemPatch(String specPath, String grep, Boolean enabled, String assignee, LocalDate dueDate,
                            String priority, Long assigneeUserId) {}

    public record OrderRequest(List<ItemKey> items) {}

    public record BulkEnabledRequest(List<ItemKey> items, boolean enabled) {}

    // ── 일자별 정기 실행 격자 (F-3) ──

    /** status: PASSED | FAILED | null(그날 정기 실행 결과 없음). executionId: 그날 마지막 정기 실행 */
    public record DailyCell(LocalDate date, String status, Long executionId) {}

    /** cells 는 days 와 같은 순서(오래된 날 → 오늘) */
    public record DailyItem(String specPath, String grep, List<DailyCell> cells) {}

    /** 사용 중 항목만 센다. passRate = passed / (passed + failed) (0~1), 그날 결과가 없으면 null */
    public record DailyTotal(LocalDate date, int passed, int failed, int enabled, Double passRate) {}

    /** days: 오래된 날 → 오늘 (Asia/Seoul 날짜) */
    public record DailyResponse(List<LocalDate> days, List<DailyItem> items, List<DailyTotal> totals) {}
}
