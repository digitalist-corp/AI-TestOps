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
