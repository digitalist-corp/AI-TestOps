package com.playops.api.service;

import com.playops.api.dto.PlanDtos.DailyCell;
import com.playops.api.dto.PlanDtos.DailyItem;
import com.playops.api.dto.PlanDtos.DailyResponse;
import com.playops.api.dto.PlanDtos.DailyTotal;
import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.repository.ExecutionRepository;
import com.playops.api.service.PlanService.Tracked;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 일자별 정기 실행 결과 격자 (F-3). 계획 항목마다 최근 며칠의 정기 실행 결과를 날짜 칸으로 보여 준다.
 * 결과 매칭은 계획 표와 같은 PlanService.tracked 를 쓰고, 정기 실행 결과만 남긴다. 날짜는 서울 기준, 하루에 여러 번이면 그날 마지막.
 */
@Service
public class PlanDailyService {

    static final ZoneId ZONE = ZoneId.of("Asia/Seoul");
    static final int DEFAULT_DAYS = 7;
    static final int MAX_DAYS = 31;

    private final PlanService planService;
    private final ExecutionRepository executionRepository;

    public PlanDailyService(PlanService planService, ExecutionRepository executionRepository) {
        this.planService = planService;
        this.executionRepository = executionRepository;
    }

    public DailyResponse daily(String projectId, Integer days) {
        int n = clampDays(days);
        LocalDate today = LocalDate.now(ZONE);
        Instant from = today.minusDays(n - 1L).atStartOfDay(ZONE).toInstant();
        List<Tracked> tracked = planService.tracked(projectId);
        // 기간 안의 실행만 한 번에 읽어 정기 실행인지 본다 (N+1 없이)
        Set<Long> ids = tracked.stream().flatMap(t -> t.history().stream())
                .filter(r -> r.getCreatedAt() != null && !r.getCreatedAt().isBefore(from))
                .map(ExecutionCaseResult::getExecutionId)
                .collect(Collectors.toSet());
        Set<Long> scheduled = ids.isEmpty() ? Set.of() : executionRepository.findAllById(ids).stream()
                .filter(PlanDailyService::isScheduled).map(Execution::getId).collect(Collectors.toSet());
        return build(tracked, scheduled, today, n);
    }

    // ── 규칙 (테스트용 package-private) ──

    static int clampDays(Integer days) {
        if (days == null) return DEFAULT_DAYS;
        return Math.max(1, Math.min(MAX_DAYS, days));
    }

    /** 정기 실행: 예약에서 만든 실행. 예약 트리거는 source=SCHEDULED 만 적던 때가 있어 둘 다 본다. */
    static boolean isScheduled(Execution e) {
        return e.getScheduleId() != null || "SCHEDULED".equals(e.getSource());
    }

    /** history 는 최신 실행부터라 날짜마다 처음 만난 결과가 그날 마지막 정기 실행이다. */
    static DailyResponse build(List<Tracked> tracked, Set<Long> scheduled, LocalDate today, int days) {
        List<LocalDate> dates = new ArrayList<>();
        for (int i = days - 1; i >= 0; i--) dates.add(today.minusDays(i));
        Set<LocalDate> window = new HashSet<>(dates);

        Map<LocalDate, int[]> counts = new HashMap<>(); // [passed, failed]
        int enabled = 0;
        List<DailyItem> items = new ArrayList<>();
        for (Tracked t : tracked) {
            Map<LocalDate, ExecutionCaseResult> byDate = new HashMap<>();
            for (ExecutionCaseResult r : t.history()) {
                if (r.getCreatedAt() == null || !scheduled.contains(r.getExecutionId())) continue;
                LocalDate d = r.getCreatedAt().atZone(ZONE).toLocalDate();
                if (window.contains(d)) byDate.putIfAbsent(d, r);
            }
            List<DailyCell> cells = dates.stream().map(d -> {
                ExecutionCaseResult r = byDate.get(d);
                return r == null ? new DailyCell(d, null, null) : new DailyCell(d, r.getStatus(), r.getExecutionId());
            }).toList();
            items.add(new DailyItem(t.item().specPath(), t.item().grep(), cells));

            if (!t.item().enabled()) continue;
            enabled++;
            for (DailyCell c : cells) {
                int[] pf = counts.computeIfAbsent(c.date(), k -> new int[2]);
                if ("PASSED".equals(c.status())) pf[0]++;
                else if ("FAILED".equals(c.status())) pf[1]++;
            }
        }
        int on = enabled;
        List<DailyTotal> totals = dates.stream().map(d -> {
            int[] pf = counts.getOrDefault(d, new int[2]);
            int run = pf[0] + pf[1];
            return new DailyTotal(d, pf[0], pf[1], on, run == 0 ? null : (double) pf[0] / run);
        }).toList();
        return new DailyResponse(dates, items, totals);
    }
}
