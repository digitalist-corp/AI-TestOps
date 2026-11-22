package com.playops.api.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.entity.Execution;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ExecutionRepository;
import com.playops.api.service.StepRecordService.CaseSteps;
import com.playops.api.service.StepRecordService.Step;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 실제 리포터가 남긴 steps.json(Playwright 1.53, 러너에서 찍음)을 문장 목록으로 바꾼다. */
class StepRecordServiceTest {

    @Test
    void parsesRecordedStepsIntoSentencesAndMarksTheFailedStep() throws Exception {
        var root = new ObjectMapper().readTree(getClass().getResourceAsStream("/steps/steps.json"));

        CaseSteps c = StepRecordService.parse(root).get(0);

        assertThat(c.title()).isEqualTo("demo.spec.ts > 로그인 > 로그인 화면");
        assertThat(c.status()).isEqualTo("FAILED");
        assertThat(c.steps()).extracting(Step::text).startsWith(
                "'/login' 페이지로 이동",
                "'#username' 입력란에 '****' 입력",
                "'비밀번호' 입력란에 '****' 입력",
                "'#password' 입력란에 '****' 입력",
                "'로그인' 버튼 클릭");
        assertThat(c.steps()).extracting(Step::text).contains("제목 확인", "'로그인' 제목이 보이는지 확인", "페이지 주소 확인");
        Step failed = c.steps().get(c.failedStep());
        assertThat(failed.text()).isEqualTo("'절대 없는 글자' 글자가 보이는지 확인");
        assertThat(failed.error()).startsWith("Error: Timed out 1000ms").doesNotContain("\u001B");
        assertThat(c.failedStep()).isEqualTo(c.steps().size() - 1);
    }

    @Test
    void koreanTestStepsBecomeGroupHeadingsAboveTheirDetailSteps() throws Exception {
        // 리포터가 test.step 제목을 먼저, 그 안의 클릭 · 입력 · 확인을 그 뒤에 순서대로 편 모양 (steps-reporter.cjs flat)
        var root = new ObjectMapper().readTree("""
                [{"file":"login.spec.ts","titlePath":["chromium","login.spec.ts","올바른 계정으로 로그인하면 대시보드가 열린다"],"status":"passed",
                  "steps":[{"category":"test.step","title":"로그인 화면 열기","offsetMs":10},
                           {"category":"pw:api","title":"Navigate to \\"/login\\"","offsetMs":12},
                           {"category":"test.step","title":"아이디와 비밀번호 입력","offsetMs":300},
                           {"category":"pw:api","title":"Fill \\"admin\\" getByLabel('아이디')","offsetMs":302},
                           {"category":"pw:api","title":"Fill \\"****\\" getByLabel('비밀번호')","offsetMs":330},
                           {"category":"test.step","title":"대시보드로 이동했는지 확인","offsetMs":600},
                           {"category":"expect","title":"toHaveURL","code":"await expect(page).toHaveURL(/dashboard/);","offsetMs":602}]}]
                """);

        CaseSteps c = StepRecordService.parse(root).get(0);

        assertThat(c.title()).isEqualTo("login.spec.ts > 올바른 계정으로 로그인하면 대시보드가 열린다");
        assertThat(c.steps()).extracting(Step::text).containsExactly(
                "로그인 화면 열기",
                "'/login' 페이지로 이동",
                "아이디와 비밀번호 입력",
                "'아이디' 입력란에 'admin' 입력",
                "'비밀번호' 입력란에 '****' 입력",
                "대시보드로 이동했는지 확인",
                "페이지 주소 확인");
        assertThat(c.steps()).extracting(Step::category)
                .containsExactly("test.step", "pw:api", "test.step", "pw:api", "pw:api", "test.step", "expect");
    }

    @Test
    void failedTestStepShowsTheErrorOnlyOnceOnTheDetailStep() throws Exception {
        // 안의 단계가 실패하면 Playwright 는 test.step 에도 같은 오류를 단다. 묶음 제목은 실패로만 표시하고 오류 글은 세부 단계에만 남긴다.
        var root = new ObjectMapper().readTree("""
                [{"file":"login.spec.ts","titlePath":["chromium","login.spec.ts","로그인"],"status":"failed",
                  "steps":[{"category":"test.step","title":"로그인 화면 열기"},
                           {"category":"pw:api","title":"Navigate to \\"/login\\""},
                           {"category":"test.step","title":"로그인 버튼 누르기","error":"TimeoutError: locator.click: Timeout 5000ms exceeded."},
                           {"category":"pw:api","title":"Click getByRole('button', { name: '로그인' })","error":"TimeoutError: locator.click: Timeout 5000ms exceeded."}]}]
                """);

        CaseSteps c = StepRecordService.parse(root).get(0);

        assertThat(c.steps()).extracting(Step::status).containsExactly("PASSED", "PASSED", "FAILED", "FAILED");
        assertThat(c.steps()).extracting(Step::error)
                .containsExactly(null, null, null, "TimeoutError: locator.click: Timeout 5000ms exceeded.");
        assertThat(c.failedStep()).isEqualTo(3);
        assertThat(c.steps().get(c.failedStep()).text()).isEqualTo("'로그인' 버튼 클릭");
    }

    @Test
    void testStepThatFailedWithoutAFailingDetailStepKeepsItsError() throws Exception {
        // 안에서 직접 throw 한 경우처럼 세부 단계에 오류가 없으면 묶음 제목의 오류를 그대로 보여 준다.
        var root = new ObjectMapper().readTree("""
                [{"file":"a.spec.ts","titlePath":["a.spec.ts","흐름"],"status":"failed",
                  "steps":[{"category":"test.step","title":"값 계산하기","error":"Error: 합계가 다릅니다"}]}]
                """);

        CaseSteps c = StepRecordService.parse(root).get(0);

        assertThat(c.steps().get(0).error()).isEqualTo("Error: 합계가 다릅니다");
        assertThat(c.failedStep()).isEqualTo(0);
    }

    @Test
    void keepsStepTimesAndAttachmentsInsideTheReport() throws Exception {
        var root = new ObjectMapper().readTree("""
                [{"file":"a.spec.ts","titlePath":["a.spec.ts","로그인"],"status":"failed",
                  "attachments":[{"name":"screenshot","contentType":"image/png","path":"test-results/a-로그인/test-failed-1.png"},
                                 {"name":"video","contentType":"video/webm","path":"test-results/a-로그인/video.webm"},
                                 {"name":"bad","contentType":"image/png","path":"test-results/../../etc/passwd"},
                                 {"name":"bad2","contentType":"image/png","path":"/etc/passwd"}],
                  "steps":[{"category":"pw:api","title":"Navigate to \\"/\\"","offsetMs":320},
                           {"category":"pw:api","title":"Click locator('#go')","offsetMs":5200,"error":"TimeoutError: x"}]}]
                """);

        CaseSteps c = StepRecordService.parse(root).get(0);

        assertThat(c.steps()).extracting(Step::offsetMs).containsExactly(320L, 5200L);
        assertThat(c.failedStep()).isEqualTo(1);
        assertThat(c.attachments()).extracting(StepRecordService.Attachment::path)
                .containsExactly("test-results/a-로그인/test-failed-1.png", "test-results/a-로그인/video.webm");
    }

    @Test
    void subfolderFilesKeepTheirPathInTheTitleAndRetriesKeepTheLastAttempt() throws Exception {
        var root = new ObjectMapper().readTree("""
                [{"file":"auth/login.spec.ts","titlePath":["chromium","auth/login.spec.ts","로그인"],"status":"failed",
                  "steps":[{"category":"pw:api","title":"Navigate to \\"/login\\"","error":"Error: 실패"}]},
                 {"file":"auth/login.spec.ts","titlePath":["chromium","auth/login.spec.ts","로그인"],"status":"passed",
                  "steps":[{"category":"pw:api","title":"Navigate to \\"/login\\""}]}]
                """);

        List<CaseSteps> cases = StepRecordService.parse(root);

        assertThat(cases).hasSize(1);
        assertThat(cases.get(0).title()).isEqualTo("auth/login.spec.ts > 로그인");
        assertThat(cases.get(0).status()).isEqualTo("PASSED");
        assertThat(cases.get(0).failedStep()).isNull();
    }

    @Test
    void executionOfAnotherProjectIsNotFoundAndOldRunsHaveNoRecord(@TempDir Path dir) throws Exception {
        ExecutionRepository executions = mock(ExecutionRepository.class);
        ExecutionLogService logs = mock(ExecutionLogService.class);
        Execution mine = new Execution();
        mine.setProjectId("p1");
        when(executions.findById(1L)).thenReturn(Optional.of(mine));
        when(logs.resolveReportDir(mine)).thenReturn(dir);
        StepRecordService service = new StepRecordService(executions, logs);

        assertThat(service.steps("p1", 1L).recorded()).isFalse();
        assertThatThrownBy(() -> service.steps("p2", 1L)).isInstanceOf(ApiException.class);

        Files.copy(getClass().getResourceAsStream("/steps/steps.json"), dir.resolve("steps.json"));
        assertThat(service.steps("p1", 1L).cases()).hasSize(1);
    }
}
