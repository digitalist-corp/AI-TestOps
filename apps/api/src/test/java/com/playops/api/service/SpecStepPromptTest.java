package com.playops.api.service;

import com.playops.api.dto.AiTemplateRequest;
import com.playops.api.entity.Project;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** AI 가 만드는 spec 에 한국어 test.step 을 넣게 하는 프롬프트 규칙 (V-3). 단계 기록 화면이 그 제목을 그대로 보여 준다. */
class SpecStepPromptTest {

    private final LlmGatewayService llm = mock(LlmGatewayService.class);

    private static void assertAsksForKoreanSteps(String prompt) {
        assertThat(prompt)
                .contains("test.step('로그인 화면 열기', async () => {")
                .contains("short Korean")
                .contains("selector")
                .contains("locator")
                .contains("spec");
    }

    @Test
    void scenarioGenerationPromptAsksForKoreanSteps() {
        SiteMapPromptService siteMap = mock(SiteMapPromptService.class);
        when(siteMap.context(eq("p"), any())).thenReturn("");
        when(llm.chat(any(), anyString(), anyString(), anyString(), eq("p"))).thenReturn("code");
        AiJobService service = new AiJobService(mock(com.playops.api.repository.AiJobRepository.class),
                mock(ProjectService.class), mock(ExecutionLogService.class), mock(AiRunnerDockerService.class),
                mock(AiDiffRiskEvaluatorService.class), mock(AiPostApplyVerificationService.class),
                mock(SlackNotificationService.class), mock(GitCommitService.class), llm, siteMap,
                mock(AiProviderSettingsService.class), mock(AiJobService.class));
        Project project = new Project();
        project.setProjectId("p");

        service.generateSpecContent(project, "tests/login.spec.ts", "로그인 확인", List.of());

        ArgumentCaptor<String> system = ArgumentCaptor.forClass(String.class);
        verify(llm).chat(any(), system.capture(), anyString(), anyString(), eq("p"));
        assertAsksForKoreanSteps(system.getValue());
    }

    @Test
    void templateGenerationPromptAsksForKoreanSteps() {
        when(llm.chat(any(), anyString(), anyString(), anyString(), any())).thenReturn("{\"files\":[]}");
        AiTemplateService service = new AiTemplateService(llm, mock(AiProviderSettingsService.class));

        service.generateTemplate(new AiTemplateRequest());

        ArgumentCaptor<String> system = ArgumentCaptor.forClass(String.class);
        verify(llm).chat(any(), system.capture(), anyString(), anyString(), any());
        assertAsksForKoreanSteps(system.getValue());
    }

    @Test
    void titleRuleKeepsGrepFriendlyTitles() {
        // 제목은 --grep 정확 일치(#135, #149)로 케이스를 찾는다. '@단어' 는 Playwright 가 태그로 읽는다.
        assertThat(SpecStepRules.GENERATE).contains("test('").contains("'@'");
    }

    @Test
    void fixPromptsKeepExistingStepNames() {
        assertThat(SpecStepRules.KEEP).contains("test.step").contains("Korean").contains("English");
    }
}
