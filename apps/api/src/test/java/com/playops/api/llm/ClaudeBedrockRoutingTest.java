package com.playops.api.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ClaudeBedrockRoutingTest {

    /** 실제 AWS 호출 없이, 보낸 본문을 붙잡고 Messages API 형식의 응답을 돌려준다. */
    private static class FakeBedrock extends BedrockTransport {
        String sentBody;

        @Override public boolean enabled() { return true; }
        @Override public String model() { return "global.anthropic.claude-haiku-4-5-20251001-v1:0"; }
        @Override public String invoke(String bodyJson) {
            sentBody = bodyJson;
            return """
                    {"content":[{"type":"text","text":"안녕하세요"},
                                {"type":"tool_use","id":"tu_1","name":"read_file","input":{"path":"a.ts"}}],
                     "usage":{"input_tokens":11,"output_tokens":29}}
                    """;
        }
    }

    @Test
    void sendsMessagesBodyThroughBedrockWithoutApiKey() throws Exception {
        FakeBedrock bedrock = new FakeBedrock();
        ClaudeLlmClient client = new ClaudeLlmClient();
        client.bedrock = bedrock;

        LlmResult result = client.chat(
                new LlmCredentials("", null), "system prompt", List.of(LlmMessage.user("안녕")),
                List.of(new LlmToolSpec("read_file", "파일을 읽는다", Map.of("type", "object"))));

        JsonNode body = new ObjectMapper().readTree(bedrock.sentBody);
        assertThat(body.has("model")).isFalse();
        assertThat(body.path("anthropic_version").asText()).isEqualTo("bedrock-2023-05-31");
        assertThat(body.path("system").asText()).isEqualTo("system prompt");
        assertThat(body.path("messages").get(0).path("content").asText()).isEqualTo("안녕");
        assertThat(body.path("tools").get(0).path("name").asText()).isEqualTo("read_file");

        assertThat(result.text()).isEqualTo("안녕하세요");
        assertThat(result.inputTokens()).isEqualTo(11);
        assertThat(result.outputTokens()).isEqualTo(29);
        assertThat(result.model()).isEqualTo("global.anthropic.claude-haiku-4-5-20251001-v1:0");
        assertThat(result.toolCalls()).hasSize(1);
        assertThat(result.toolCalls().get(0).name()).isEqualTo("read_file");
    }
}
