package com.playops.api.chat.tools;

import com.playops.api.chat.ChatTool;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolDisplay;
import com.playops.api.chat.ToolTier;
import com.playops.api.dto.ExecutionDetailResponse;
import com.playops.api.dto.ExecutionResponse;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolSpec;
import com.playops.api.service.ExecutionQueryService;
import org.springframework.stereotype.Component;

import java.util.Map;

/** 실행 하나의 실패 케이스와 로그. */
@Component
public class GetExecutionDetailTool implements ChatTool {

    private final ExecutionQueryService executionQueryService;

    public GetExecutionDetailTool(ExecutionQueryService executionQueryService) {
        this.executionQueryService = executionQueryService;
    }

    @Override
    public LlmToolSpec spec() {
        return new LlmToolSpec(
                "get_execution_detail",
                "특정 실행의 상세 결과와 로그를 읽는다. 실패 원인을 짚을 때 쓴다.",
                LlmToolSpec.schema(
                        Map.of("executionId", LlmToolSpec.integer("실행 ID")),
                        "executionId"));
    }

    @Override
    public ToolTier tier() {
        return ToolTier.READ;
    }

    @Override
    public ChatToolOutput execute(LlmToolCall call, ChatToolContext context) {
        long executionId = call.argLong("executionId", -1);
        if (executionId < 0) {
            return ChatToolOutput.failed("executionId 인자가 필요합니다.");
        }
        ExecutionDetailResponse detail = executionQueryService.getDetail(executionId);
        ExecutionResponse execution = detail.execution();
        StringBuilder sb = new StringBuilder();
        sb.append("실행 #").append(execution.id()).append(" 상태 ").append(execution.status())
          .append(" | 통과 ").append(execution.passedTests())
          .append(" / 실패 ").append(execution.failedTests()).append('\n');

        if (detail.caseResults() != null) {
            for (var caseResult : detail.caseResults()) {
                String status = String.valueOf(caseResult.status());
                if (status.equals("FAILED") || status.equals("ERROR")) {
                    sb.append("실패: ").append(caseResult.caseTitle())
                      .append(" (").append(caseResult.specPath()).append(")\n");
                    if (caseResult.errorMessage() != null) {
                        sb.append("  ").append(caseResult.errorMessage()).append('\n');
                    }
                }
            }
        }
        if (detail.logOutput() != null && !detail.logOutput().isBlank()) {
            sb.append("\n[로그]\n").append(detail.logOutput());
        }
        return ChatToolOutput.ok(CoreToolSupport.truncate(sb.toString()),
                "#" + execution.id() + " " + execution.status(),
                ToolDisplay.of("execution", Map.of(
                        "executionId", execution.id(),
                        "status", String.valueOf(execution.status()),
                        "projectId", String.valueOf(execution.projectId()))));
    }
}
