package com.playops.api.config;

import com.playops.api.dto.PlanDtos.PlanItem;
import com.playops.api.dto.PlanDtos.PlanResponse;
import com.playops.api.dto.ScenarioCaseNode;
import com.playops.api.dto.ScenarioSpecFile;
import com.playops.api.dto.ScenarioTreeResponse;
import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.entity.Project;
import com.playops.api.repository.ExecutionCaseResultRepository;
import com.playops.api.repository.ExecutionRepository;
import com.playops.api.repository.ProjectRepository;
import com.playops.api.service.PlanService;
import com.playops.api.service.PlanServiceFixtures;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 시연 정기 실행 기록 (F-3): 플래그가 꺼지면 아무것도 안 넣고, 켜지면 기록이 없을 때 한 번만 7일치를 넣는다. */
class DemoScheduleHistorySeederTest {

    private ProjectRepository projects;
    private ExecutionRepository executions;
    private ExecutionCaseResultRepository results;
    private PlanService planService;
    private JdbcTemplate jdbc;
    private final List<Execution> savedRuns = new ArrayList<>();

    @BeforeEach
    void setUp() {
        projects = mock(ProjectRepository.class);
        when(projects.findById("example.com")).thenReturn(Optional.of(new Project()));
        executions = mock(ExecutionRepository.class);
        AtomicLong ids = new AtomicLong(100);
        when(executions.save(any(Execution.class))).thenAnswer(inv -> {
            Execution e = inv.getArgument(0);
            e.setId(ids.incrementAndGet());
            savedRuns.add(e);
            return e;
        });
        results = mock(ExecutionCaseResultRepository.class);
        planService = mock(PlanService.class);
        jdbc = mock(JdbcTemplate.class);
        // 시연 spec 의 두 케이스 (계획 항목은 트리에서 펼쳐 만든다)
        List<PlanItem> items = PlanServiceFixtures.flatten(new ScenarioTreeResponse("example.com", 1, 2, List.of(
                new ScenarioSpecFile("tests/demo.spec.ts", 2, true, List.of(
                        new ScenarioCaseNode("DESCRIBE", "시연 확인", "시연 확인", 5, "시연 확인", true, List.of(
                                new ScenarioCaseNode("TEST", "안내 링크가 보인다", "시연 확인 안내 링크가 보인다", 6,
                                        "안내 링크가 보인다", true, List.of()),
                                new ScenarioCaseNode("TEST", DemoDataSeeder.FAILING, "시연 확인 " + DemoDataSeeder.FAILING, 11,
                                        DemoDataSeeder.FAILING, true, List.of()))))))));
        when(planService.get("example.com")).thenReturn(new PlanResponse(items, null));
    }

    private DemoScheduleHistorySeeder seeder(boolean enabled) {
        return new DemoScheduleHistorySeeder(enabled, projects, executions, results, planService, jdbc);
    }

    @Test
    void flagOffSeedsNothing() {
        seeder(false).run();

        verifyNoInteractions(projects, executions, results, planService, jdbc);
    }

    @Test
    @SuppressWarnings("unchecked")
    void flagOnSeedsSevenScheduledRunsOnceWithFailingCaseFailingLately() {
        when(executions.existsScheduled("example.com")).thenReturn(false);
        seeder(true).run();
        when(executions.existsScheduled("example.com")).thenReturn(true); // 이제 기록이 있다
        seeder(true).run();

        assertThat(savedRuns).hasSize(7);
        assertThat(savedRuns).allSatisfy(e -> {
            assertThat(e.getProjectId()).isEqualTo("example.com");
            assertThat(e.getSource()).isEqualTo("SCHEDULED");
            assertThat(ZonedDateTime.ofInstant(e.getScheduledFor(), DemoScheduleHistorySeeder.ZONE).getHour()).isEqualTo(3);
        });
        ArgumentCaptor<List<ExecutionCaseResult>> captor = ArgumentCaptor.forClass(List.class);
        verify(results, times(7)).saveAll(captor.capture());
        // 오래된 실행부터: 실패 케이스는 최근 3번 실패, 안내 링크는 4일 전 한 번 실패
        List<String> failing = captor.getAllValues().stream()
                .map(rs -> rs.stream().filter(r -> r.getCaseTitle().endsWith(DemoDataSeeder.FAILING)).findFirst().orElseThrow().getStatus())
                .toList();
        List<String> other = captor.getAllValues().stream().map(rs -> rs.get(0).getStatus()).toList();
        assertThat(failing).containsExactly("PASSED", "PASSED", "PASSED", "PASSED", "FAILED", "FAILED", "FAILED");
        assertThat(other).containsExactly("PASSED", "PASSED", "FAILED", "PASSED", "PASSED", "PASSED", "PASSED");
        // 결과 표와 같은 제목 모양이라 계획 항목과 맞춰진다
        assertThat(captor.getAllValues().get(0).get(0).getCaseTitle()).isEqualTo("demo.spec.ts > 시연 확인 > 안내 링크가 보인다");
        assertThat(captor.getAllValues().get(0).get(0).getSpecPath()).isEqualTo("tests/demo.spec.ts");
        // 만든 때를 그날 03:00 으로 되돌린다 (실행 · 결과 각각)
        verify(jdbc, times(14)).update(any(String.class), any(Object[].class));
    }

    @Test
    void runTimesEndAtLastThreeAmInSeoul() {
        // 11/22 02:59 KST = 11/21 17:59Z → 마지막 실행은 11/21 03:00 KST
        List<Instant> before = DemoScheduleHistorySeeder.runTimes(Instant.parse("2026-11-21T17:59:00Z"));
        assertThat(before).hasSize(7);
        assertThat(before.get(6)).isEqualTo(Instant.parse("2026-11-20T18:00:00Z"));
        assertThat(before.get(0)).isEqualTo(Instant.parse("2026-11-14T18:00:00Z"));
        // 11/22 03:00 KST 지나면 오늘 실행까지
        assertThat(DemoScheduleHistorySeeder.runTimes(Instant.parse("2026-11-21T18:00:00Z")).get(6))
                .isEqualTo(Instant.parse("2026-11-21T18:00:00Z"));
    }
}
