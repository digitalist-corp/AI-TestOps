package com.playops.api.chat.tools;

import com.playops.api.chat.ChatTool;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolTier;
import com.playops.api.entity.AiJob;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolSpec;
import com.playops.api.service.AiJobService;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

/** 새 시나리오 파일 생성 요청. 역시 승인 대기 AI 작업만 만든다. */
@Component
public class GenerateScenarioTool implements ChatTool {

    private final AiJobService aiJobService;

    public GenerateScenarioTool(AiJobService aiJobService) {
        this.aiJobService = aiJobService;
    }

    @Override
    public LlmToolSpec spec() {
        return new LlmToolSpec(
                "generate_scenario",
                "새 테스트 시나리오 파일 생성을 요청한다. 역시 'AI 검토'에서 승인해야 프로젝트에 추가된다. "
                        + "경로는 반드시 tests/ 아래의 .spec.ts 여야 Playwright 가 인식한다.",
                LlmToolSpec.schema(
                        CoreToolSupport.withProjectId(Map.of(
                                "specPath", LlmToolSpec.string("새로 만들 파일 경로. 예: tests/checkout.spec.ts"),
                                "instruction", LlmToolSpec.string("어떤 시나리오를 만들지에 대한 설명"),
                                "routes", LlmToolSpec.string("테스트할 화면의 경로를 쉼표로 구분. get_sitemap 이 알려 준 경로만 쓴다. 예: /login,/signup. 모르면 비운다")
                        )),
                        "specPath", "instruction"));
    }

    @Override
    public ToolTier tier() {
        return ToolTier.CHANGE;
    }

    @Override
    public ChatToolOutput execute(LlmToolCall call, ChatToolContext context) {
        String specPath = CoreToolSupport.normalizeSpecPath(call.arg("specPath"));
        String instruction = call.arg("instruction");
        if (specPath == null || instruction == null) {
            return ChatToolOutput.failed("specPath 와 instruction 이 모두 필요합니다.");
        }
        String projectId = context.projectIdFor(call);
        String routes = call.arg("routes");
        List<String> routeKeys = routes == null ? List.of()
                : Arrays.stream(routes.split(",")).map(String::trim).filter(r -> !r.isEmpty()).toList();
        AiJob job = aiJobService.createTemplateGenerateJob(projectId, specPath, instruction, routeKeys, context.userId());
        return ChatToolOutput.ok(
                "AI 작업 #" + job.getId() + " 을 만들었습니다. 생성 경로는 " + specPath + " 이고, "
                        + "'AI 검토' 화면에서 승인해야 프로젝트에 추가됩니다.",
                specPath + " 생성 요청",
                JobDisplay.of(job));
    }
}
