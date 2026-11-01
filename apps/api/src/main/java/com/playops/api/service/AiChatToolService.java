package com.playops.api.service;

import com.playops.api.chat.ChatTool;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ChatToolRegistry;
import com.playops.api.chat.ToolTier;
import com.playops.api.dto.AiChatAction;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolResult;
import com.playops.api.llm.LlmToolSpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 한 번에 답하는 기존 채팅(POST /api/ai/chat, AI 분석 탭)용 도구 어댑터.
 *
 * 도구 자체는 com.playops.api.chat.tools 의 ChatTool 구현으로 옮겨 채팅 에이전트와 같이 쓴다.
 * 여기서는 두 가지만 한다.
 *   1. 허락을 물을 화면이 없으므로 READ · CHANGE 도구만 준다 (RUN 도구는 주지 않는다).
 *   2. 도구가 만든 AI 작업을 예전 응답 모양(AiChatAction)으로 모아 화면이 승인 카드를 띄우게 한다.
 *
 * 설계 원칙은 그대로다 — 파일을 직접 고치는 도구는 두지 않고, 수정은 승인 대기 AI 작업으로만 만든다.
 */
@Service
public class AiChatToolService {

    private static final Logger log = LoggerFactory.getLogger(AiChatToolService.class);

    private static final Set<ToolTier> ALLOWED_TIERS = Set.of(ToolTier.READ, ToolTier.CHANGE);

    private final ChatToolRegistry registry;

    public AiChatToolService(ChatToolRegistry registry) {
        this.registry = registry;
    }

    /** 도구를 실행하며 쌓인 부수 효과(만들어진 작업)를 모으는 그릇. */
    public static class ToolContext {
        private final String projectId;
        private final Long userId;
        private final Long recentExecutionId;
        private final List<AiChatAction> actions = new ArrayList<>();

        public ToolContext(String projectId, Long userId, Long recentExecutionId) {
            this.projectId = projectId;
            this.userId = userId;
            this.recentExecutionId = recentExecutionId;
        }

        public List<AiChatAction> actions() {
            return actions;
        }

        public boolean hasProject() {
            return projectId != null && !projectId.isBlank();
        }

        ChatToolContext toChatContext() {
            return new ChatToolContext(projectId, userId, false, null);
        }
    }

    /**
     * 모델에게 알려줄 도구 목록.
     * 프로젝트를 열지 않은 화면에서는 대상이 없으므로 도구를 주지 않는다.
     */
    public List<LlmToolSpec> toolsFor(ToolContext context) {
        if (!context.hasProject()) {
            return List.of();
        }
        return registry.specs(ALLOWED_TIERS);
    }

    /** 모델이 요청한 도구를 실제로 실행한다. 실패는 숨기지 않고 모델에게 그대로 알린다. */
    public LlmToolResult execute(LlmToolCall call, ToolContext context) {
        Optional<ChatTool> tool = registry.find(call.name()).filter(t -> ALLOWED_TIERS.contains(t.tier()));
        if (tool.isEmpty()) {
            return LlmToolResult.failed(call.id(), "알 수 없는 도구입니다: " + call.name());
        }
        try {
            LlmToolCall effective = withRecentExecution(call, context);
            ChatToolOutput output = tool.get().execute(effective, context.toChatContext());
            if (output.error()) {
                return LlmToolResult.failed(call.id(), output.content());
            }
            collectAction(effective, output, context);
            return LlmToolResult.ok(call.id(), output.content());
        } catch (Exception e) {
            log.warn("채팅 도구 실행 실패 [{}]: {}", call.name(), e.getMessage());
            return LlmToolResult.failed(call.id(), "도구 실행 실패: " + e.getMessage());
        }
    }

    /** 예전처럼, 화면이 보고 있던 실행을 fix_test 의 근거 실행으로 넘긴다 (모델이 따로 정하지 않았을 때만). */
    private LlmToolCall withRecentExecution(LlmToolCall call, ToolContext context) {
        if (!"fix_test".equals(call.name()) || context.recentExecutionId == null || call.arg("executionId") != null) {
            return call;
        }
        Map<String, Object> arguments = new LinkedHashMap<>(call.arguments() == null ? Map.of() : call.arguments());
        arguments.put("executionId", String.valueOf(context.recentExecutionId));
        return new LlmToolCall(call.id(), call.name(), arguments);
    }

    private void collectAction(LlmToolCall call, ChatToolOutput output, ToolContext context) {
        if (output.display() == null || !"job".equals(output.display().kind())) {
            return;
        }
        String type = switch (call.name()) {
            case "fix_test" -> "FIX_TEST";
            case "generate_scenario" -> "GENERATE_SCENARIO";
            default -> null;
        };
        if (type == null) {
            return;
        }
        Map<String, Object> data = output.display().data();
        Object jobId = data.get("jobId");
        Object specPath = data.get("specPath");
        context.actions.add(AiChatAction.created(
                type,
                output.summary(),
                summarize(call.arg("instruction")),
                jobId instanceof Number number ? number.longValue() : null,
                context.toChatContext().projectIdFor(call),
                specPath == null ? call.arg("specPath") : String.valueOf(specPath)));
    }

    private String summarize(String instruction) {
        if (instruction == null) {
            return "";
        }
        String oneLine = instruction.replaceAll("\\s+", " ").trim();
        return oneLine.length() <= 160 ? oneLine : oneLine.substring(0, 160) + "…";
    }
}
