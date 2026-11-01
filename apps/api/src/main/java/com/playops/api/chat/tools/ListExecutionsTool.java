package com.playops.api.chat.tools;

import com.playops.api.chat.ChatTool;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolDisplay;
import com.playops.api.chat.ToolTier;
import com.playops.api.dto.ExecutionResponse;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolSpec;
import com.playops.api.service.ExecutionQueryService;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/** 프로젝트의 최근 실행 10건. */
@Component
public class ListExecutionsTool implements ChatTool {

    private static final int MAX_ROWS = 10;

    private final ExecutionQueryService executionQueryService;

    public ListExecutionsTool(ExecutionQueryService executionQueryService) {
        this.executionQueryService = executionQueryService;
    }

    @Override
    public LlmToolSpec spec() {
        return new LlmToolSpec(
                "list_executions",
                "프로젝트의 최근 테스트 실행 목록을 본다. 언제 무엇이 실패했는지 훑을 때 쓴다.",
                LlmToolSpec.schema(CoreToolSupport.withProjectId(Map.of())));
    }

    @Override
    public ToolTier tier() {
        return ToolTier.READ;
    }

    @Override
    public ChatToolOutput execute(LlmToolCall call, ChatToolContext context) {
        List<ExecutionResponse> executions = executionQueryService.listByProject(context.projectIdFor(call));
        if (executions.isEmpty()) {
            return ChatToolOutput.ok("아직 실행 기록이 없습니다.", "0건");
        }
        StringBuilder sb = new StringBuilder();
        List<List<Object>> rows = new ArrayList<>();
        for (ExecutionResponse execution : executions.subList(0, Math.min(MAX_ROWS, executions.size()))) {
            String target = execution.specPath() == null ? "전체" : execution.specPath();
            sb.append("실행 #").append(execution.id())
              .append(" | 상태 ").append(execution.status())
              .append(" | 통과 ").append(execution.passedTests())
              .append(" / 실패 ").append(execution.failedTests())
              .append(" | 대상 ").append(target)
              .append('\n');
            rows.add(Arrays.asList(execution.id(), String.valueOf(execution.status()),
                    execution.passedTests(), execution.failedTests(), target));
        }
        return ChatToolOutput.ok(sb.toString(), rows.size() + "건",
                ToolDisplay.of("table", Map.of(
                        "columns", List.of("실행", "상태", "통과", "실패", "대상"),
                        "rows", rows,
                        "truncated", executions.size() > MAX_ROWS)));
    }
}
