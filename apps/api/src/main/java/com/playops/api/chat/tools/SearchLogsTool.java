package com.playops.api.chat.tools;

import com.playops.api.chat.ChatTool;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolDisplay;
import com.playops.api.chat.ToolTier;
import com.playops.api.dto.ExecutionLogResponse;
import com.playops.api.entity.Execution;
import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolSpec;
import com.playops.api.repository.ExecutionRepository;
import com.playops.api.service.ExecutionLogService;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeSet;

/**
 * 실행 로그에서 글을 찾는다. (READ)
 *
 * executionId 를 주면 그 실행만, 비우면 이 프로젝트의 최근 5개 실행을 찾는다.
 * 맞은 줄마다 앞뒤 2줄을 함께 보여 줘 실패 직전에 무슨 일이 있었는지 볼 수 있게 한다.
 */
@Component
public class SearchLogsTool implements ChatTool {

    static final String NAME = "search_logs";

    static final int MAX_LINES = 80;
    static final int RECENT_EXECUTIONS = 5;
    private static final int CONTEXT_LINES = 2;
    private static final int MAX_SHOWN_LINE_CHARS = 300;
    /** 로그가 이보다 크면 뒤쪽만 본다. 실패 원인은 보통 끝에 있다. */
    private static final int MAX_LOG_CHARS = 5_000_000;

    private final ExecutionRepository executionRepository;
    private final ExecutionLogService executionLogService;
    private final LlmToolSpec spec;

    public SearchLogsTool(ExecutionRepository executionRepository, ExecutionLogService executionLogService) {
        this.executionRepository = executionRepository;
        this.executionLogService = executionLogService;

        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("query", LlmToolSpec.string("로그에서 찾을 글. 대소문자를 구분하지 않는다. 예: timeout, locator.click"));
        properties.put("executionId", LlmToolSpec.integer("찾을 실행 ID. 비우면 이 프로젝트의 최근 " + RECENT_EXECUTIONS + "개 실행을 찾는다"));
        this.spec = new LlmToolSpec(
                NAME,
                "테스트 실행 로그에서 글을 찾아 맞은 줄과 앞뒤 " + CONTEXT_LINES + "줄을 보여준다(최대 " + MAX_LINES + "줄). "
                        + "에러 메시지나 특정 요청이 로그 어디에 나오는지 찾을 때 쓴다. 한 실행의 결과 요약이 필요하면 get_execution_detail 을 쓴다.",
                LlmToolSpec.schema(ToolSupport.withProjectId(properties), "query"));
    }

    @Override
    public LlmToolSpec spec() {
        return spec;
    }

    @Override
    public ToolTier tier() {
        return ToolTier.READ;
    }

    @Override
    public ChatToolOutput execute(LlmToolCall call, ChatToolContext context) {
        String query = call.arg("query");
        if (query == null) {
            return ChatToolOutput.failed("query 인자가 필요합니다.");
        }
        boolean hasExecutionId = call.arg("executionId") != null;
        long executionId = call.argLong("executionId", -1);
        if (hasExecutionId && executionId < 0) {
            return ChatToolOutput.failed("executionId 는 숫자여야 합니다.");
        }

        try {
            List<Execution> executions = hasExecutionId
                    ? List.of(findExecution(executionId, call, context))
                    : executionRepository.findTop5ByProjectIdOrderByCreatedAtDesc(ToolSupport.requireProject(call, context));
            if (executions.isEmpty()) {
                return ChatToolOutput.ok("아직 실행 기록이 없습니다.", "0건");
            }
            return search(executions, query);
        } catch (ApiException e) {
            return ToolSupport.failed(e);
        }
    }

    private Execution findExecution(long executionId, LlmToolCall call, ChatToolContext context) {
        // 프로젝트를 지정했거나 대화 중인 프로젝트가 있으면 그 밖의 실행은 (관리자가 아닌 한) 볼 수 없다.
        String projectId = ToolSupport.optionalProject(call, context);
        Execution execution = executionRepository.findById(executionId)
                .orElseThrow(() -> new ApiException(404, "실행 #" + executionId + " 을 찾을 수 없습니다."));
        if (!context.admin() && !execution.getProjectId().equals(projectId)) {
            throw new ApiException(403, "실행 #" + executionId + " 은 이 프로젝트의 실행이 아닙니다.");
        }
        return execution;
    }

    private ChatToolOutput search(List<Execution> executions, String query) {
        String needle = query.toLowerCase(Locale.ROOT);
        StringBuilder content = new StringBuilder();
        List<Map<String, String>> items = new ArrayList<>();
        int emitted = 0;
        int matches = 0;
        boolean reachedLimit = false;
        List<String> searched = new ArrayList<>();

        for (Execution execution : executions) {
            searched.add("#" + execution.getId());
            String[] lines = readLog(execution).split("\\R", -1);

            TreeSet<Integer> matchLines = new TreeSet<>();
            for (int i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase(Locale.ROOT).contains(needle)) {
                    matchLines.add(i);
                }
            }
            if (matchLines.isEmpty()) {
                continue;
            }

            // 맞은 줄과 앞뒤 줄을 겹치지 않게 모은다.
            TreeSet<Integer> shown = new TreeSet<>();
            for (int i : matchLines) {
                for (int j = Math.max(0, i - CONTEXT_LINES); j <= Math.min(lines.length - 1, i + CONTEXT_LINES); j++) {
                    shown.add(j);
                }
            }

            content.append("== 실행 #").append(execution.getId()).append(" (").append(execution.getStatus()).append(") ==\n");
            int previous = -2;
            for (int i : shown) {
                if (emitted >= MAX_LINES) {
                    reachedLimit = true;
                    break;
                }
                if (previous >= 0 && i != previous + 1) {
                    content.append("--\n");
                }
                boolean isMatch = matchLines.contains(i);
                String text = ToolSupport.oneLine(lines[i], MAX_SHOWN_LINE_CHARS);
                content.append(i + 1).append(isMatch ? ": " : "- ").append(text).append('\n');
                emitted++;
                previous = i;
                if (isMatch) {
                    matches++;
                    Map<String, String> item = new LinkedHashMap<>();
                    item.put("label", "실행 #" + execution.getId() + " · " + (i + 1) + "번째 줄");
                    item.put("detail", text);
                    items.add(item);
                }
            }
            if (reachedLimit) {
                break;
            }
        }

        if (matches == 0) {
            return ChatToolOutput.ok(
                    "맞는 줄이 없습니다. (검색한 실행: " + String.join(", ", searched) + ")", "0건");
        }
        if (reachedLimit) {
            content.append("... ").append(MAX_LINES).append("줄에서 멈췄습니다. query 를 더 구체적으로 쓰거나 executionId 를 지정하세요.\n");
        }
        return ChatToolOutput.ok(
                ToolSupport.truncate(content.toString().stripTrailing()),
                matches + "건",
                ToolDisplay.of("list", Map.of("items", items)));
    }

    /** 로그 파일 내용. 파일이 없으면 실행 기록에 남겨 둔 로그를 쓴다. */
    private String readLog(Execution execution) {
        String text = "";
        try {
            ExecutionLogResponse chunk = executionLogService.readLog(execution.getId(), 0);
            text = chunk == null || chunk.content() == null ? "" : chunk.content();
        } catch (ApiException e) {
            // 로그 파일을 못 읽어도 DB 에 남은 로그로 찾아 본다.
        }
        if (text.isBlank() && execution.getLogOutput() != null) {
            text = execution.getLogOutput();
        }
        return text.length() > MAX_LOG_CHARS ? text.substring(text.length() - MAX_LOG_CHARS) : text;
    }
}
