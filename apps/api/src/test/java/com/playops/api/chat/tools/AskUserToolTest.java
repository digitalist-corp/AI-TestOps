package com.playops.api.chat.tools;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolDisplay;
import com.playops.api.chat.ToolTier;
import com.playops.api.llm.LlmToolCall;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class AskUserToolTest {

    private final AskUserTool tool = new AskUserTool(new ChatUiValidator(new ObjectMapper()));

    @Test
    void emitsTwoVersionedA2uiMessagesAndModelContent() {
        String question = "계속할까요?";
        List<Map<String, Object>> components = List.of(
                Map.of("id", "root", "component", "Button", "label", "계속",
                        "action", Map.of("event", Map.of("name", "submit", "context", Map.of()))));
        Map<String, Object> data = Map.of("selected", List.of("login"));

        ChatToolOutput output = tool.execute(new LlmToolCall("call_1", "ask_user",
                Map.of("question", question, "components", components, "data", data)),
                new ChatToolContext("demo", 1L, false, 10L, 123L));

        assertThat(tool.spec().name()).isEqualTo("ask_user");
        assertThat(tool.tier()).isEqualTo(ToolTier.READ);
        assertThat(output.error()).isFalse();
        assertThat(output.summary()).isEqualTo(question);
        assertThat(output.content()).isEqualTo("사용자에게 질문 화면을 보여 줬습니다: 계속할까요?. 답은 다음 사용자 메시지로 옵니다.");
        assertThat(output.display()).isEqualTo(ToolDisplay.of("a2ui", Map.of(
                "surfaceId", "chat-123-call_1", "question", question,
                "messages", List.of(
                        Map.of("version", "1.0", "createSurface", Map.of("surfaceId", "chat-123-call_1",
                                "catalogId", "https://playops.dev/a2ui/catalogs/chat/v1", "dataModel", data)),
                        Map.of("version", "1.0", "updateComponents", Map.of("surfaceId", "chat-123-call_1",
                                "components", components))))));
    }

    @Test
    void invalidInputReturnsCorrectableFailure() {
        ChatToolOutput output = tool.execute(new LlmToolCall("call_1", "ask_user",
                Map.of("question", "계속?", "components", List.of(), "data", Map.of())),
                new ChatToolContext(null, 1L, false, 10L, 123L));

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("root");
        assertThat(output.display()).isNull();
    }
}
