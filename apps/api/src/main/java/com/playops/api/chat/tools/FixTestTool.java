package com.playops.api.chat.tools;

import com.playops.api.chat.ChatTool;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolTier;
import com.playops.api.dto.ExecutionResponse;
import com.playops.api.entity.AiJob;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolSpec;
import com.playops.api.service.AiJobService;
import com.playops.api.service.ExecutionQueryService;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * 기존 테스트 코드 수정 요청. 파일을 바로 고치지 않고 승인 대기(NEEDS_REVIEW) AI 작업만 만든다.
 */
@Component
public class FixTestTool implements ChatTool {

    private final AiJobService aiJobService;
    private final ExecutionQueryService executionQueryService;

    public FixTestTool(AiJobService aiJobService, ExecutionQueryService executionQueryService) {
        this.aiJobService = aiJobService;
        this.executionQueryService = executionQueryService;
    }

    @Override
    public LlmToolSpec spec() {
        return new LlmToolSpec(
                "fix_test",
                "기존 테스트 코드 수정을 요청한다. 코드가 곧바로 바뀌지는 않고 'AI 검토' 목록에 올라가 "
                        + "사람이 승인해야 반영된다. 무엇을 왜 고쳐야 하는지 instruction 에 구체적으로 적는다.",
                LlmToolSpec.schema(
                        CoreToolSupport.withProjectId(Map.of(
                                "specPath", LlmToolSpec.string("고칠 파일 경로. 예: tests/login.spec.ts"),
                                "instruction", LlmToolSpec.string("무엇을 어떻게 고쳐야 하는지에 대한 구체적인 지시"),
                                "executionId", LlmToolSpec.integer("수정의 근거가 된 실패 실행 ID. 모르면 생략하면 최근 실패 실행을 쓴다")
                        )),
                        "specPath", "instruction"));
    }

    @Override
    public ToolTier tier() {
        return ToolTier.CHANGE;
    }

    @Override
    public ChatToolOutput execute(LlmToolCall call, ChatToolContext context) {
        String specPath = call.arg("specPath");
        String instruction = call.arg("instruction");
        if (specPath == null || instruction == null) {
            return ChatToolOutput.failed("specPath 와 instruction 이 모두 필요합니다.");
        }
        String projectId = context.projectIdFor(call);
        long executionId = call.argLong("executionId", -1);
        Long failedExecutionId = executionId >= 0 ? Long.valueOf(executionId) : recentFailedExecutionId(projectId);

        AiJob job = aiJobService.createCodeFixJob(projectId, failedExecutionId, specPath, instruction, context.userId());
        return ChatToolOutput.ok(
                "AI 작업 #" + job.getId() + " 을 만들었습니다. 상태는 '검토 대기'이며, "
                        + "사용자가 'AI 검토' 화면에서 승인해야 실제 파일에 반영됩니다. "
                        + "사용자에게 이 사실과 승인이 필요하다는 점을 알려주세요.",
                specPath + " 수정 요청",
                JobDisplay.of(job));
    }

    /** 실패 로그를 수정 근거로 넘기기 위해, 지정이 없으면 그 프로젝트의 가장 최근 실패 실행을 고른다. */
    private Long recentFailedExecutionId(String projectId) {
        try {
            List<ExecutionResponse> executions = executionQueryService.listByProject(projectId);
            for (ExecutionResponse execution : executions) {
                String status = String.valueOf(execution.status());
                if (status.equals("FAILED") || status.equals("ERROR")) {
                    return execution.id();
                }
            }
        } catch (Exception ignored) {
            // 근거 실행이 없어도 수정 작업은 만들 수 있다.
        }
        return null;
    }
}
