package com.playops.api.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/** 테스트 계획 표(F-1) 요청·응답. 계획 항목 = 계획 행(plan_items) 또는 계획 행이 없는 테스트 케이스 하나 (파일 경로 + grep). */
public final class PlanDtos {

    private PlanDtos() {}

    public static final String UNWRITTEN = "UNWRITTEN";
    public static final String WRITTEN = "WRITTEN";

    /**
     * lastStatus · prevStatus: PASSED | FAILED | null(해당 실행 없음). priority: HIGH | MEDIUM | LOW | null.
     * defectStatus: OPEN | RESOLVED | null. defectFailCount: 최근 연속 실패 수, 결함이 없으면 0.
     * parentEnabled: 파일 · 상위 묶음이 모두 사용 중인지. false 면 이 행만 켜도 실행되지 않는다.
     * assignee · assigneeUserId: 담당자 이름과 계정(#119). 계정이 없으면 이관 전에 손으로 쓴 이름만 있다.
     * updatedByName · updatedAt: 계획 칸을 마지막으로 고친 사람 · 때 (#118). 고친 적이 없으면 비어 있다.
     * 계획 우선 흐름: planId(계획 행, 테스트만 있는 항목은 null) · stage(UNWRITTEN | WRITTEN) · screenRouteKey · expected,
     * aiJobId · aiJobStatus(미작성 행의 최근 AI 생성 작업). UNWRITTEN 행은 specPath · grep · describePath 가 "" 이고 line 은 0.
     */
    public record PlanItem(String specPath, String grep, String title, String describePath, int line,
                           boolean enabled, boolean parentEnabled, Integer sortOrder, String assignee, Long assigneeUserId,
                           LocalDate dueDate, String priority, String lastStatus, Instant lastRunAt,
                           String prevStatus, Instant prevRunAt, String defectStatus, int defectFailCount,
                           String updatedByName, Instant updatedAt,
                           Long planId, String stage, String screenRouteKey, String expected,
                           Long aiJobId, String aiJobStatus) {

        /** 계획 행이 없는 테스트 항목 (기존 생성자 — 쓰는 곳이 많다) */
        public PlanItem(String specPath, String grep, String title, String describePath, int line,
                        boolean enabled, boolean parentEnabled, Integer sortOrder, String assignee, Long assigneeUserId,
                        LocalDate dueDate, String priority, String lastStatus, Instant lastRunAt,
                        String prevStatus, Instant prevRunAt, String defectStatus, int defectFailCount,
                        String updatedByName, Instant updatedAt) {
            this(specPath, grep, title, describePath, line, enabled, parentEnabled, sortOrder, assignee, assigneeUserId,
                    dueDate, priority, lastStatus, lastRunAt, prevStatus, prevRunAt, defectStatus, defectFailCount,
                    updatedByName, updatedAt, null, WRITTEN, null, null, null, null);
        }
    }

    /**
     * total · enabled · disabled 는 미작성 행을 포함한다. unwritten · written · passed · failed · notRun 은 사용 중 행만 센다.
     * writtenRate = written / enabled (작성률), notRun = 작성됨인데 결과 없음, completionRate = passed / enabled (계획 대비 완료율).
     */
    public record PlanSummary(int total, int enabled, int disabled, int unwritten, int written, double writtenRate,
                              int passed, int failed, int notRun, double completionRate) {}

    /** 화면별 진척 (사용 중 행). 화면 = 계획 행의 화면, 없으면 그 테스트가 지나는 흐름의 첫 화면. */
    public record ScreenProgress(String routeKey, int planned, int written, int passed, int failed) {}

    public record PlanResponse(List<PlanItem> items, PlanSummary summary, List<ScreenProgress> screens) {
        public PlanResponse(List<PlanItem> items, PlanSummary summary) {
            this(items, summary, List.of());
        }
    }

    /** planId 가 있고 specPath 가 비어 있으면 계획 행(미작성)을 가리킨다. */
    public record ItemKey(String specPath, String grep, Long planId) {
        public ItemKey(String specPath, String grep) {
            this(specPath, grep, null);
        }
    }

    /**
     * 한 행 저장. enabled 가 null 이면 사용 여부는 그대로, 계획 칸(담당자 · 마감일 · 우선순위)은 보낸 값으로 덮어쓴다(null = 비움).
     * 담당자는 assigneeUserId(프로젝트 멤버)로 고른다. 없으면 assignee 글자만 남긴다(이관 못 한 옛 이름을 지우지 않도록).
     */
    public record ItemPatch(String specPath, String grep, Boolean enabled, String assignee, LocalDate dueDate,
                            String priority, Long assigneeUserId) {}

    public record OrderRequest(List<ItemKey> items) {}

    public record BulkEnabledRequest(List<ItemKey> items, boolean enabled) {}

    // ── 계획 행 쓰기 (계획 우선 흐름) ──

    public record EntryRequest(String title, String screenRouteKey, String expected, Long assigneeUserId,
                               LocalDate dueDate, String priority) {}

    public record BulkEntriesRequest(List<EntryRequest> entries) {}

    public record BulkCreated(int created) {}

    /** title · enabled 는 null 이면 유지, 나머지는 보낸 값으로 덮어쓴다(null = 비움). */
    public record EntryPatch(String title, String screenRouteKey, String expected, Boolean enabled,
                             Long assigneeUserId, LocalDate dueDate, String priority) {}

    public record LinkRequest(String specPath, String grep) {}

    public record GenerateRequest(List<Long> planIds) {}

    public record GenerateResponse(List<AiJobResponse> jobs) {}

    public record LinkSuggestion(Long planId, String specPath, String grep, String caseTitle, String reason) {}

    public record SuggestionsResponse(List<LinkSuggestion> suggestions) {}

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
