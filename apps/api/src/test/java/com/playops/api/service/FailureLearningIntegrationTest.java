package com.playops.api.service;

import com.playops.api.dto.FailureDtos.Cluster;
import com.playops.api.entity.AiJob;
import com.playops.api.entity.AiJobStatus;
import com.playops.api.entity.AiJobType;
import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.repository.AiJobRepository;
import com.playops.api.repository.ExecutionCaseResultRepository;
import com.playops.api.repository.ExecutionRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** E-04 · E-05 · V22: 실패 묶음, 사람이 고친 분류, 승인된 수정 기억 → 다음 같은 실패에 "과거 수정 n건". */
@SpringBootTest(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:learning;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "playops.docker-enabled=false",
        "playops.projects-root=build/tmp/learning-projects",
        "playops.storage-root=build/tmp/learning-storage",
        "LOGIN_USERNAME=admin",
        "LOGIN_PASSWORD=admin-test-pass-1"
})
class FailureLearningIntegrationTest {

    private static final String CLICK_PAY = "Error: locator.click: Timeout 5000ms exceeded.\nCall log:\n"
            + "  - waiting for getByRole('button', { name: '결제하기' })";
    private static final String DOWN = "Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:4173/";

    @Autowired FailureService failures;
    @Autowired ExecutionRepository executions;
    @Autowired ExecutionCaseResultRepository results;
    @Autowired AiJobRepository aiJobs;
    @Autowired AiRunnerDockerService runnerDocker;

    private Long failedRun(String projectId, String... errors) {
        Execution e = new Execution();
        e.setProjectId(projectId);
        e.setStatus(ExecutionStatus.FAILED);
        Long id = executions.save(e).getId();
        int n = 0;
        for (String error : errors) {
            ExecutionCaseResult r = new ExecutionCaseResult();
            r.setExecutionId(id);
            r.setSpecPath("cart.spec.ts");
            r.setCaseTitle("장바구니 > 결제 " + n++);
            r.setStatus(error == null ? "PASSED" : "FAILED");
            r.setErrorMessage(error);
            results.save(r);
        }
        return id;
    }

    @Test
    void clustersGroupSameCauseAndClassifyByRules() {
        Long run = failedRun("learn-a", CLICK_PAY, DOWN, CLICK_PAY.replace("5000", "30000"), null);

        List<Cluster> clusters = failures.clusters("learn-a", run);

        assertThat(clusters).extracting(Cluster::count).containsExactly(2, 1);
        Cluster first = clusters.get(0);
        assertThat(first.cause()).isEqualTo("SCRIPT_ERROR");
        assertThat(first.causeSource()).isEqualTo("RULE");
        assertThat(first.summary()).isEqualTo("'결제하기' 버튼을 찾지 못했습니다");
        assertThat(first.cases()).containsExactly("장바구니 > 결제 0", "장바구니 > 결제 2");
        assertThat(first.pastFixes()).isZero();
        assertThat(clusters.get(1).cause()).isEqualTo("ENVIRONMENT");
    }

    @Test
    void humanCorrectionWinsAndStaysInItsProject() {
        Long run = failedRun("learn-b", CLICK_PAY);
        String signature = failures.clusters("learn-b", run).get(0).signature();

        failures.setCause("learn-b", signature, "FLAKY", 1L);
        failures.setCause("learn-b", signature, "PRODUCT_DEFECT", 1L);

        Cluster corrected = failures.clusters("learn-b", run).get(0);
        assertThat(corrected.cause()).isEqualTo("PRODUCT_DEFECT");
        assertThat(corrected.causeSource()).isEqualTo("HUMAN");
        Long other = failedRun("learn-c", CLICK_PAY);
        assertThat(failures.clusters("learn-c", other).get(0).causeSource()).isEqualTo("RULE");
    }

    @Test
    void approvedFixIsRememberedForTheNextSameFailureUntilReverted() throws Exception {
        Long run = failedRun("learn-d", CLICK_PAY);
        AiJob job = new AiJob();
        job.setProjectId("learn-d");
        job.setJobType(AiJobType.CODE_FIX);
        job.setStatus(AiJobStatus.NEEDS_REVIEW);
        job.setFailedExecutionId(run);
        job.setTargetSpecPath("tests/cart.spec.ts");
        Long jobId = aiJobs.save(job).getId();
        Path diffDir = runnerDocker.aiJobDir(jobId).resolve("result");
        Files.createDirectories(diffDir.getParent().resolve("pre-apply-snapshot"));
        Files.createDirectories(diffDir);
        Files.writeString(diffDir.getParent().resolve("pre-apply-snapshot/tests__cart.spec.ts"),
                "test('결제', async ({ page }) => {\n  await page.getByRole('button', { name: '결제하기' }).click();\n});\n");
        Files.writeString(diffDir.resolve("tests__cart.spec.ts"),
                "test('결제', async ({ page }) => {\n  await page.getByRole('button', { name: '결제' }).click();\n});\n");
        AiJob approved = aiJobs.findById(jobId).orElseThrow();
        approved.setDiffPath(diffDir.toString());
        approved.setStatus(AiJobStatus.APPLIED);
        approved.setReviewedBy(1L);
        aiJobs.save(approved);

        Long again = failedRun("learn-d", CLICK_PAY.replace("5000", "7000"));
        Cluster cluster = failures.clusters("learn-d", again).get(0);
        assertThat(cluster.pastFixes()).isEqualTo(1);
        assertThat(cluster.recalled()).singleElement().satisfies(fix -> {
            assertThat(fix.aiJobId()).isEqualTo(jobId);
            assertThat(fix.diff()).contains("-  await page.getByRole('button', { name: '결제하기' }).click();")
                    .contains("+  await page.getByRole('button', { name: '결제' }).click();");
        });
        assertThat(failures.clusters("learn-other", failedRun("learn-other", CLICK_PAY)).get(0).pastFixes()).isZero();

        AiJob reverted = aiJobs.findById(jobId).orElseThrow();
        reverted.setRevertedAt(Instant.now());
        aiJobs.save(reverted);
        assertThat(failures.clusters("learn-d", again).get(0).pastFixes()).isZero();
    }
}
