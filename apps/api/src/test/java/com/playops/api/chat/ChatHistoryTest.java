package com.playops.api.chat;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.entity.AiChatMessage;
import com.playops.api.llm.LlmMessage;
import com.playops.api.llm.LlmRole;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ChatHistoryTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    private AiChatMessage stored(String role, List<ChatBlock> blocks) throws Exception {
        AiChatMessage message = new AiChatMessage();
        message.setRole(role);
        message.setBlocks(objectMapper.writeValueAsString(blocks));
        return message;
    }

    private List<ChatBlock> read(AiChatMessage message) {
        try {
            return objectMapper.readValue(message.getBlocks(), new TypeReference<>() {});
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static ChatBlock tool(String callId, String status, String output) {
        ChatBlock block = ChatBlock.tool(callId, "read_x", ToolTier.READ, Map.of("path", "a.ts"));
        block.status = status;
        block.output = output;
        return block;
    }

    @Test
    void assistantBlocksAreSplitBackIntoToolRequestAndResultPairs() throws Exception {
        List<AiChatMessage> messages = List.of(
                stored("user", List.of(ChatBlock.text("질문1"))),
                stored("assistant", List.of(
                        ChatBlock.text("확인할게요"),
                        tool("c1", "ok", "내용"),
                        tool("c2", "denied", null),
                        ChatBlock.text("답입니다"))),
                stored("user", List.of(ChatBlock.text("질문2"))));

        List<LlmMessage> history = ChatHistory.toLlmMessages(messages, this::read);

        assertThat(history).hasSize(5);
        assertThat(history.get(0)).isEqualTo(LlmMessage.user("질문1"));
        assertThat(history.get(1).role()).isEqualTo(LlmRole.ASSISTANT);
        assertThat(history.get(1).content()).isEqualTo("확인할게요");
        assertThat(history.get(1).toolCalls()).extracting(c -> c.id()).containsExactly("c1", "c2");
        assertThat(history.get(1).toolCalls().get(0).arg("path")).isEqualTo("a.ts");
        assertThat(history.get(2).toolResults()).hasSize(2);
        assertThat(history.get(2).toolResults().get(0).content()).isEqualTo("내용");
        assertThat(history.get(2).toolResults().get(0).error()).isFalse();
        assertThat(history.get(2).toolResults().get(1).error()).isTrue();
        assertThat(history.get(3)).isEqualTo(LlmMessage.assistant("답입니다"));
        assertThat(history.get(4)).isEqualTo(LlmMessage.user("질문2"));
    }

    @Test
    void longHistoryKeepsTheRecentPartAndStartsWithAUserMessage() throws Exception {
        List<AiChatMessage> messages = new ArrayList<>();
        String big = "가".repeat(ChatHistory.MAX_CHARS / 3);
        for (int i = 0; i < 5; i++) {
            messages.add(stored("user", List.of(ChatBlock.text("질문" + i))));
            messages.add(stored("assistant", List.of(ChatBlock.text(big))));
        }

        List<LlmMessage> history = ChatHistory.toLlmMessages(messages, this::read);

        assertThat(history).isNotEmpty();
        assertThat(history.get(0).role()).isEqualTo(LlmRole.USER);
        assertThat(history.get(history.size() - 1).content()).isEqualTo(big);
        assertThat(history.size()).isLessThan(10);
        int chars = history.stream().mapToInt(m -> m.content().length()).sum();
        assertThat(chars).isLessThanOrEqualTo(ChatHistory.MAX_CHARS);
    }

    @Test
    void emptyOrInterruptedAssistantMessagesDoNotBreakTheOrder() throws Exception {
        ChatBlock running = tool("c1", "running", null);
        List<AiChatMessage> messages = List.of(
                stored("user", List.of(ChatBlock.text("질문"))),
                stored("assistant", List.of()),
                stored("user", List.of(ChatBlock.text("다시"))),
                stored("assistant", List.of(running)));

        List<LlmMessage> history = ChatHistory.toLlmMessages(messages, this::read);

        assertThat(history).hasSize(4);
        assertThat(history.get(3).toolResults().get(0).error()).isTrue();
    }
}
