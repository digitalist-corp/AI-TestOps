package com.playops.api.chat;

import com.playops.api.entity.AiChatMessage;
import com.playops.api.llm.LlmMessage;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolResult;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

/**
 * 저장된 세션 메시지(블록)를 모델에게 보낼 이전 대화(LlmMessage)로 되돌린다.
 *
 * assistant 메시지 하나에는 "글 → 도구 호출들 → 글 → 도구 호출들 → 글" 처럼 여러 턴이 섞여 있다.
 * 모델이 앞뒤를 이어 읽으려면 원래 모양대로 "도구 요청(assistant) → 도구 결과(user)" 짝으로 다시 쪼개야 한다.
 * 대화가 길면 최근 것 위주로 자른다(요약은 다음 단계).
 */
final class ChatHistory {

    /** 이전 대화로 넣을 최대 메시지 수 (사용자 · 답변 합쳐서) */
    static final int MAX_MESSAGES = 40;
    /** 이전 대화의 대략적인 글자 상한. 턴마다 다시 보내므로 크게 잡으면 토큰 예산이 금방 찬다. */
    static final int MAX_CHARS = 60_000;

    private ChatHistory() {
    }

    static List<LlmMessage> toLlmMessages(List<AiChatMessage> stored, Function<AiChatMessage, List<ChatBlock>> reader) {
        List<List<ChatBlock>> blocksPerMessage = new ArrayList<>();
        List<String> roles = new ArrayList<>();
        for (AiChatMessage message : stored) {
            blocksPerMessage.add(reader.apply(message));
            roles.add(message.getRole());
        }

        // 뒤에서부터 상한까지 담는다.
        int start = blocksPerMessage.size();
        int chars = 0;
        while (start > 0 && blocksPerMessage.size() - start < MAX_MESSAGES) {
            int size = sizeOf(blocksPerMessage.get(start - 1));
            if (chars + size > MAX_CHARS && start < blocksPerMessage.size()) {
                break;
            }
            chars += size;
            start--;
        }
        // 첫 메시지는 사용자 메시지여야 한다 (Claude 규칙).
        while (start < blocksPerMessage.size() && !AiChatMessage.ROLE_USER.equals(roles.get(start))) {
            start++;
        }

        List<LlmMessage> messages = new ArrayList<>();
        for (int i = start; i < blocksPerMessage.size(); i++) {
            if (AiChatMessage.ROLE_USER.equals(roles.get(i))) {
                String text = joinText(blocksPerMessage.get(i));
                if (!text.isBlank()) {
                    messages.add(LlmMessage.user(text));
                }
            } else {
                appendAssistant(messages, blocksPerMessage.get(i));
            }
        }
        return messages;
    }

    private static void appendAssistant(List<LlmMessage> messages, List<ChatBlock> blocks) {
        StringBuilder text = new StringBuilder();
        List<LlmToolCall> calls = new ArrayList<>();
        List<LlmToolResult> results = new ArrayList<>();
        for (ChatBlock block : blocks) {
            if (block.isTextBlock()) {
                if (!calls.isEmpty()) {
                    flushTools(messages, text, calls, results);
                }
                if (block.text != null) {
                    text.append(block.text);
                }
            } else if (block.isToolBlock() && block.callId != null && block.name != null) {
                calls.add(new LlmToolCall(block.callId, block.name, block.input == null ? java.util.Map.of() : block.input));
                results.add(resultOf(block));
            }
        }
        if (!calls.isEmpty()) {
            flushTools(messages, text, calls, results);
        }
        if (!text.toString().isBlank()) {
            messages.add(LlmMessage.assistant(text.toString()));
        }
    }

    private static void flushTools(List<LlmMessage> messages, StringBuilder text,
                                   List<LlmToolCall> calls, List<LlmToolResult> results) {
        messages.add(LlmMessage.toolRequest(text.toString(), List.copyOf(calls)));
        messages.add(LlmMessage.toolResponse(List.copyOf(results)));
        text.setLength(0);
        calls.clear();
        results.clear();
    }

    private static LlmToolResult resultOf(ChatBlock block) {
        String status = block.status == null ? "" : block.status;
        return switch (status) {
            case "ok" -> LlmToolResult.ok(block.callId, block.output == null ? "" : block.output);
            case "error" -> LlmToolResult.failed(block.callId, block.output == null ? "도구 실행 실패" : block.output);
            case "denied" -> LlmToolResult.failed(block.callId, "사용자가 이 도구 실행을 거부했습니다.");
            case "cancelled" -> LlmToolResult.failed(block.callId, "사용자가 답변을 멈춰 실행하지 않았습니다.");
            default -> LlmToolResult.failed(block.callId, "결과 없이 중단되었습니다.");
        };
    }

    private static String joinText(List<ChatBlock> blocks) {
        StringBuilder sb = new StringBuilder();
        for (ChatBlock block : blocks) {
            if (block.isTextBlock() && block.text != null) {
                sb.append(block.text);
            }
        }
        return sb.toString();
    }

    private static int sizeOf(List<ChatBlock> blocks) {
        int size = 0;
        for (ChatBlock block : blocks) {
            size += block.text == null ? 0 : block.text.length();
            size += block.output == null ? 0 : block.output.length();
            size += block.input == null ? 0 : block.input.toString().length();
        }
        return size;
    }
}
