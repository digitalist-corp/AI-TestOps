package com.playops.api.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.exception.ApiException;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OpenAiStreamParserTest {

    private static final String STREAM = """
            data: {"id":"c1","object":"chat.completion.chunk","model":"gpt-4o-mini-2024-07-18","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}],"usage":null}

            data: {"id":"c1","object":"chat.completion.chunk","model":"gpt-4o-mini-2024-07-18","choices":[{"index":0,"delta":{"content":"먼저 "},"finish_reason":null}],"usage":null}

            data: {"id":"c1","object":"chat.completion.chunk","model":"gpt-4o-mini-2024-07-18","choices":[{"index":0,"delta":{"content":"볼게요"},"finish_reason":null}],"usage":null}

            data: {"id":"c1","object":"chat.completion.chunk","model":"gpt-4o-mini-2024-07-18","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"read_file","arguments":""}}]},"finish_reason":null}],"usage":null}

            data: {"id":"c1","object":"chat.completion.chunk","model":"gpt-4o-mini-2024-07-18","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"pa"}}]},"finish_reason":null}],"usage":null}

            data: {"id":"c1","object":"chat.completion.chunk","model":"gpt-4o-mini-2024-07-18","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\": \\"a.spec.ts\\"}"}}]},"finish_reason":null}],"usage":null}

            data: {"id":"c1","object":"chat.completion.chunk","model":"gpt-4o-mini-2024-07-18","choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_b","type":"function","function":{"name":"get_job_status","arguments":"{\\"jobId\\": 7}"}}]},"finish_reason":null}],"usage":null}

            data: {"id":"c1","object":"chat.completion.chunk","model":"gpt-4o-mini-2024-07-18","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":null}

            data: {"id":"c1","object":"chat.completion.chunk","model":"gpt-4o-mini-2024-07-18","choices":[],"usage":{"prompt_tokens":120,"completion_tokens":34,"total_tokens":154}}

            data: [DONE]
            """;

    @Test
    void collectsContentToolArgumentPiecesAndUsage() throws Exception {
        List<String> deltas = new ArrayList<>();
        OpenAiStreamParser parser = new OpenAiStreamParser(new ObjectMapper(), "fallback", deltas::add);

        for (String line : STREAM.split("\n")) {
            parser.accept(line);
        }
        LlmResult result = parser.result();

        assertThat(deltas).containsExactly("먼저 ", "볼게요");
        assertThat(result.text()).isEqualTo("먼저 볼게요");
        assertThat(result.model()).isEqualTo("gpt-4o-mini-2024-07-18");
        assertThat(result.inputTokens()).isEqualTo(120);
        assertThat(result.outputTokens()).isEqualTo(34);
        assertThat(result.toolCalls()).hasSize(2);
        assertThat(result.toolCalls().get(0).id()).isEqualTo("call_a");
        assertThat(result.toolCalls().get(0).name()).isEqualTo("read_file");
        assertThat(result.toolCalls().get(0).arg("path")).isEqualTo("a.spec.ts");
        assertThat(result.toolCalls().get(1).id()).isEqualTo("call_b");
        assertThat(result.toolCalls().get(1).argLong("jobId", -1)).isEqualTo(7);
    }

    @Test
    void errorChunkFailsLoudly() {
        OpenAiStreamParser parser = new OpenAiStreamParser(new ObjectMapper(), "m", d -> {});

        assertThatThrownBy(() -> parser.accept("data: {\"error\":{\"message\":\"Rate limit reached\"}}"))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Rate limit reached");
    }
}
