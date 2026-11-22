package com.playops.api.config;

import com.playops.api.dto.PlanDtos.PlanItem;
import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.repository.ExecutionCaseResultRepository;
import com.playops.api.repository.ExecutionRepository;
import com.playops.api.repository.ProjectRepository;
import com.playops.api.service.PlanService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 시연용 정기 실행 기록 (F-3). DEMO_SEED_SCHEDULE_HISTORY=true 이고 시연 프로젝트(example.com)에 정기 실행 기록이 하나도 없을 때만,
 * 지난 7일치 매일 03:00(서울) 정기 실행과 케이스 결과를 넣는다. 일자별 격자 · 결함 리스트가 비어 보이지 않게 하려는 것.
 * - 시연 spec 의 실패 케이스(FAILING)는 최근 3일 실패, 나머지는 성공. 다른 케이스 하나는 4일 전에 한 번 실패(해결된 결함)
 * - 리포트 파일은 없다. 결과 화면은 "단계 기록 · 아티팩트 없음"으로 보이고, 로그에 시연 기록이라고 적는다
 * DemoDataSeeder(시연 spec · 계획 칸) 다음에 돈다. 실패해도 서버 기동은 막지 않는다.
 */
@Component
@Order(21)
public class DemoScheduleHistorySeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoScheduleHistorySeeder.class);
    static final ZoneId ZONE = ZoneId.of("Asia/Seoul");
    static final int DAYS = 7;
    /** FAILING 케이스가 실패하는 최근 실행 수 */
    static final int FAILING_DAYS = 3;
    /** 다른 케이스 하나가 한 번 실패하는 날 (며칠 전) */
    static final int FLAKY_DAYS_AGO = 4;
    static final String LOG = "[playops] 시연용 정기 실행 기록입니다 (DEMO_SEED_SCHEDULE_HISTORY). 리포트 · 영상 파일은 없어요.";
    private static final String FAILING_ERROR = """
            Error: expect(locator).toBeVisible() failed

            Locator: getByRole('link', { name: '문의하기' })
            Expected: visible
            Timeout: 5000ms""";
    private static final String FLAKY_ERROR = "TimeoutError: page.goto: Timeout 30000ms exceeded.";

    private final boolean enabled;
    private final ProjectRepository projectRepository;
    private final ExecutionRepository executionRepository;
    private final ExecutionCaseResultRepository caseResultRepository;
    private final PlanService planService;
    private final JdbcTemplate jdbc;

    public DemoScheduleHistorySeeder(@Value("${DEMO_SEED_SCHEDULE_HISTORY:false}") boolean enabled,
                                     ProjectRepository projectRepository, ExecutionRepository executionRepository,
                                     ExecutionCaseResultRepository caseResultRepository, PlanService planService,
                                     JdbcTemplate jdbc) {
        this.enabled = enabled;
        this.projectRepository = projectRepository;
        this.executionRepository = executionRepository;
        this.caseResultRepository = caseResultRepository;
        this.planService = planService;
        this.jdbc = jdbc;
    }

    @Override
    public void run(String... args) {
        if (!enabled) return;
        try {
            if (projectRepository.findById(DemoDataSeeder.PROJECT).isEmpty()) return;
            if (executionRepository.existsScheduled(DemoDataSeeder.PROJECT)) return;
            List<PlanItem> items = planService.get(DemoDataSeeder.PROJECT).items();
            if (items.isEmpty()) return;
            List<Instant> times = runTimes(Instant.now());
            for (int i = 0; i < times.size(); i++) seedRun(items, times.get(i), times.size() - 1 - i);
            log.info("시연 프로젝트 {} 에 정기 실행 기록 {}일치를 넣었습니다.", DemoDataSeeder.PROJECT, DAYS);
        } catch (RuntimeException e) {
            log.warn("시연 정기 실행 기록을 넣지 못했습니다: {}", e.getMessage());
        }
    }

    /** 지금 이전의 마지막 03:00(서울)까지 매일 03:00, 오래된 것부터 */
    static List<Instant> runTimes(Instant now) {
        ZonedDateTime last = ZonedDateTime.of(LocalDate.ofInstant(now, ZONE), LocalTime.of(3, 0), ZONE);
        if (last.toInstant().isAfter(now)) last = last.minusDays(1);
        List<Instant> out = new ArrayList<>();
        for (int i = DAYS - 1; i >= 0; i--) out.add(last.minusDays(i).toInstant());
        return out;
    }

    /** daysAgo: 0 = 가장 최근 실행. flaky = FAILING 이 아닌 첫 케이스 */
    static boolean fails(PlanItem item, boolean flaky, int daysAgo) {
        if (DemoDataSeeder.FAILING.equals(item.title())) return daysAgo < FAILING_DAYS;
        return flaky && daysAgo == FLAKY_DAYS_AGO;
    }

    private void seedRun(List<PlanItem> items, Instant at, int daysAgo) {
        PlanItem flaky = items.stream().filter(i -> !DemoDataSeeder.FAILING.equals(i.title())).findFirst().orElse(null);
        List<ExecutionCaseResult> results = new ArrayList<>();
        for (PlanItem item : items) {
            boolean failed = fails(item, item == flaky, daysAgo);
            ExecutionCaseResult r = new ExecutionCaseResult();
            r.setSpecPath(item.specPath());
            r.setCaseTitle(caseTitle(item));
            r.setStatus(failed ? "FAILED" : "PASSED");
            r.setDurationMs(failed ? 5400 : 1200);
            if (failed) r.setErrorMessage(DemoDataSeeder.FAILING.equals(item.title()) ? FAILING_ERROR : FLAKY_ERROR);
            results.add(r);
        }
        int failedCount = (int) results.stream().filter(r -> "FAILED".equals(r.getStatus())).count();

        Execution e = new Execution();
        e.setProjectId(DemoDataSeeder.PROJECT);
        e.setSource("SCHEDULED");
        e.setScheduledFor(at);
        e.setStatus(failedCount > 0 ? ExecutionStatus.FAILED : ExecutionStatus.PASSED);
        e.setTotalTests(results.size());
        e.setPassedTests(results.size() - failedCount);
        e.setFailedTests(failedCount);
        e.setSkippedTests(0);
        e.setDurationMs(60_000L);
        e.setStartedAt(at);
        e.setFinishedAt(at.plusSeconds(60));
        e.setLogOutput(LOG);
        Long id = executionRepository.save(e).getId();
        results.forEach(r -> r.setExecutionId(id));
        caseResultRepository.saveAll(results);
        // 만든 때(created_at)는 저장할 때 지금으로 찍히므로 그날 03:00 으로 되돌린다 — 격자 날짜 · 결함 이력이 이 값을 본다
        jdbc.update("update executions set created_at = ? where id = ?", Timestamp.from(at), id);
        jdbc.update("update execution_case_results set created_at = ? where execution_id = ?",
                Timestamp.from(at.plusSeconds(60)), id);
    }

    /** 실제 결과 표와 같은 모양: "파일 > 묶음 > 케이스" (파일은 testDir 기준이라 이름만) */
    static String caseTitle(PlanItem item) {
        String file = item.specPath().substring(item.specPath().lastIndexOf('/') + 1);
        List<String> parts = new ArrayList<>(List.of(file));
        if (item.describePath() != null && !item.describePath().isEmpty()) parts.add(item.describePath());
        parts.add(item.title());
        return String.join(" > ", parts);
    }
}
