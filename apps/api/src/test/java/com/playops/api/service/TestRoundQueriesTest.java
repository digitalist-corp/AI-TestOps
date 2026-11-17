package com.playops.api.service;

import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.repository.ExecutionCaseResultRepository;
import com.playops.api.repository.ExecutionRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;

import static org.assertj.core.api.Assertions.assertThat;

/** 차수 비교가 쓰는 "앞선 실행들의 결과" 쿼리를 실제 JPA(H2)로 돌려 본다. */
@DataJpaTest(properties = {
        "spring.flyway.enabled=false",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect"
})
class TestRoundQueriesTest {

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

    private void result(Execution execution, String title, String status) {
        ExecutionCaseResult r = new ExecutionCaseResult();
        r.setExecutionId(execution.getId());
        r.setSpecPath("a.spec.ts");
        r.setCaseTitle(title);
        r.setStatus(status);
        caseResults.saveAndFlush(r);
    }

    @Test
    void returnsEarlierResultsOfTheSameProjectNewestFirstWithoutSkipped() {
        Execution first = execution("p1");
        Execution other = execution("p2");
        Execution second = execution("p1");
        Execution current = execution("p1");
        Execution later = execution("p1");
        result(first, "1차", "FAILED");
        result(other, "다른 프로젝트", "PASSED");
        result(second, "2차", "PASSED");
        result(second, "2차 건너뜀", "SKIPPED");
        result(current, "이번", "PASSED");
        result(later, "나중", "PASSED");

        assertThat(caseResults.findEarlierInProject("p1", current.getId()))
                .extracting(ExecutionCaseResult::getCaseTitle)
                .containsExactly("2차", "1차");
    }
}
