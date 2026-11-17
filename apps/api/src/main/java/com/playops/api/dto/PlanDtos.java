package com.playops.api.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/** 테스트 계획 표(F-1) 요청·응답. 계획 항목 = 테스트 케이스 하나 (파일 경로 + grep). */
public final class PlanDtos {

    private PlanDtos() {}

    /** lastStatus: PASSED | FAILED | null(미수행). priority: HIGH | MEDIUM | LOW | null */
    public record PlanItem(String specPath, String grep, String title, String describePath, int line,
                           boolean enabled, Integer sortOrder, String assignee, LocalDate dueDate,
                           String priority, String lastStatus, Instant lastRunAt) {}

    /** passed · failed · notRun 은 사용 중 항목만 센다. completionRate = passed / enabled (0~1). */
    public record PlanSummary(int total, int enabled, int disabled, int passed, int failed, int notRun,
                              double completionRate) {}

    public record PlanResponse(List<PlanItem> items, PlanSummary summary) {}

    public record ItemKey(String specPath, String grep) {}

    /** 한 행 저장. enabled 가 null 이면 사용 여부는 그대로, 계획 칸(담당자 · 마감일 · 우선순위)은 보낸 값으로 덮어쓴다(null = 비움). */
    public record ItemPatch(String specPath, String grep, Boolean enabled, String assignee, LocalDate dueDate,
                            String priority) {}

    public record OrderRequest(List<ItemKey> items) {}

    public record BulkEnabledRequest(List<ItemKey> items, boolean enabled) {}
}
