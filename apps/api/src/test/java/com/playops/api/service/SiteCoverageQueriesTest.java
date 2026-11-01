package com.playops.api.service;

import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.repository.ExecutionCaseResultRepository;
import com.playops.api.repository.ExecutionRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 확인 지도가 쓰는 "spec 경로별 마지막 실행 결과" 쿼리를 실제 JPA(H2)로 돌려 본다.
 * (Flyway 는 운영 DB 전용 SQL 이라 끄고, 엔티티에서 테이블을 만든다.)
 */
@DataJpaTest(properties = {
        "spring.flyway.enabled=false",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect"
})
class SiteCoverageQueriesTest {

    @Autowired
    ExecutionRepository executions;

    @Autowired
    ExecutionCaseResultRepository caseResults;

    private Execution execution(String projectId) {
        Execution e = new Execution();
        e.setProjectId(projectId);
        e.setStatus(ExecutionStatus.PASSED);
        return executions.saveAndFlush(e);
    }

    private void caseResult(Execution execution, String specPath, String status) {
        ExecutionCaseResult r = new ExecutionCaseResult();
        r.setExecutionId(execution.getId());
        r.setSpecPath(specPath);
        r.setCaseTitle(specPath + " " + status);
        r.setStatus(status);
        caseResults.saveAndFlush(r);
    }

    @Test
    void returnsOnlyTheLatestRunPerSpecInsideTheProjectIgnoringSkipped() {
        Execution old = execution("p1");
        Execution latest = execution("p1");
        Execution skippedOnly = execution("p1");
        Execution otherProject = execution("p2");
        caseResult(old, "order.spec.ts", "PASSED");
        caseResult(latest, "order.spec.ts", "FAILED");
        caseResult(latest, "order.spec.ts", "PASSED");
        caseResult(skippedOnly, "order.spec.ts", "SKIPPED");   // 건너뛴 실행은 마지막 결과로 치지 않는다.
        caseResult(old, "recorded/a.spec.ts", "PASSED");
        caseResult(otherProject, "recorded/a.spec.ts", "FAILED"); // 다른 프로젝트의 더 최근 실행
        caseResult(latest, "never-asked.spec.ts", "PASSED");

        List<ExecutionCaseResult> found = caseResults.findLatestBySpecPaths("p1",
                List.of("order.spec.ts", "recorded/a.spec.ts", "tests/recorded/a.spec.ts"));

        assertThat(found).extracting(r -> r.getSpecPath() + "@" + (r.getExecutionId().equals(latest.getId()) ? "latest" : "old")
                        + ":" + r.getStatus())
                .containsExactlyInAnyOrder("order.spec.ts@latest:FAILED", "order.spec.ts@latest:PASSED",
                        "recorded/a.spec.ts@old:PASSED");
    }
}
