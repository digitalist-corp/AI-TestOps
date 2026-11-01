package com.playops.api.chat.tools;

import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.repository.ExecutionCaseResultRepository;
import com.playops.api.repository.ExecutionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.data.domain.PageRequest;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 채팅 도구가 쓰는 저장소 쿼리를 실제 JPA(H2)로 돌려 본다.
 * 도구 단위 테스트는 저장소를 가짜로 두므로, @Query 문법이 틀려 앱이 못 뜨는 일은 여기서 잡는다.
 * (Flyway 는 운영 DB 전용 SQL 이라 끄고, 엔티티에서 테이블을 만든다.)
 */
@DataJpaTest(properties = {
        "spring.flyway.enabled=false",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect"
})
class ChatToolQueriesTest {

    @Autowired
    ExecutionRepository executions;

    @Autowired
    ExecutionCaseResultRepository caseResults;

    private Execution p1Old;
    private Execution p1New;
    private Execution p2;

    @BeforeEach
    void data() {
        p1Old = execution("p1");
        p1New = execution("p1");
        p2 = execution("p2");

        caseResult(p1Old, "로그인 성공", "PASSED");
        caseResult(p1New, "로그인 실패 케이스", "FAILED");
        caseResult(p1New, "결제 100%_완료", "PASSED");
        caseResult(p1New, "결제 100x완료", "PASSED");
        caseResult(p1New, "Login Works", "PASSED");
        caseResult(p2, "로그인 성공", "FAILED"); // 다른 프로젝트
    }

    private Execution execution(String projectId) {
        Execution e = new Execution();
        e.setProjectId(projectId);
        e.setStatus(ExecutionStatus.PASSED);
        return executions.saveAndFlush(e);
    }

    private void caseResult(Execution execution, String title, String status) {
        ExecutionCaseResult r = new ExecutionCaseResult();
        r.setExecutionId(execution.getId());
        r.setCaseTitle(title);
        r.setStatus(status);
        caseResults.saveAndFlush(r);
    }

    private List<ExecutionCaseResult> find(String projectId, String name, int size) {
        return caseResults.findRecentByProjectAndCaseTitle(
                projectId, GetCaseHistoryTool.likePattern(name), PageRequest.of(0, size));
    }

    @Test
    void findsPartialNamesNewestFirstAndOnlyInsideTheProject() {
        List<ExecutionCaseResult> found = find("p1", "로그인", 10);

        assertThat(found).extracting(ExecutionCaseResult::getCaseTitle)
                .containsExactly("로그인 실패 케이스", "로그인 성공");
        assertThat(found).extracting(ExecutionCaseResult::getExecutionId)
                .containsExactly(p1New.getId(), p1Old.getId())
                .doesNotContain(p2.getId());
    }

    @Test
    void theOtherProjectSeesOnlyItsOwnResults() {
        assertThat(find("p2", "로그인", 10)).extracting(ExecutionCaseResult::getExecutionId)
                .containsExactly(p2.getId());
        assertThat(find("nobody", "로그인", 10)).isEmpty();
    }

    @Test
    void ignoresCase() {
        assertThat(find("p1", "LOGIN", 10)).extracting(ExecutionCaseResult::getCaseTitle)
                .containsExactly("Login Works");
    }

    @Test
    void percentAndUnderscoreAreLiteralCharacters() {
        // "100%_" 는 글자 그대로 "100%_" 가 들어간 이름만 찾는다. (와일드카드라면 "100x완료" 도 걸린다)
        assertThat(find("p1", "100%_", 10)).extracting(ExecutionCaseResult::getCaseTitle)
                .containsExactly("결제 100%_완료");
        assertThat(find("p1", "100_완", 10)).isEmpty();
    }

    @Test
    void respectsThePageSize() {
        assertThat(find("p1", "로그인", 1)).hasSize(1);
        assertThat(find("p1", "", 3)).hasSize(3); // 빈 이름은 도구가 막지만 쿼리는 전부 맞는다
    }

    @Test
    void recentExecutionsAreTheLatestFiveOfTheProjectOnly() throws InterruptedException {
        for (int i = 0; i < 6; i++) {
            Thread.sleep(3); // createdAt 이 겹치지 않게
            execution("p1");
        }

        List<Execution> recent = executions.findTop5ByProjectIdOrderByCreatedAtDesc("p1");

        assertThat(recent).hasSize(5);
        assertThat(recent).extracting(Execution::getProjectId).containsOnly("p1");
        assertThat(recent).extracting(Execution::getCreatedAt).isSortedAccordingTo(java.util.Comparator.reverseOrder());
        assertThat(recent).extracting(Execution::getId).doesNotContain(p1Old.getId(), p1New.getId());
        assertThat(executions.findTop5ByProjectIdOrderByCreatedAtDesc("nobody")).isEmpty();
    }
}
