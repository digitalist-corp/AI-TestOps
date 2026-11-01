package com.playops.api.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.exception.ApiException;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ClaudeStreamParserTest {

    private static final String STREAM = """
            event: message_start
            data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"claude-sonnet-5-20260101","stop_reason":null,"usage":{"input_tokens":25,"output_tokens":1}}}

            event: content_block_start
            data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

            event: ping
            data: {"type": "ping"}

            event: content_block_delta
            data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"파일을 "}}

            event: content_block_delta
            data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"확인할게요."}}

            event: content_block_stop
            data: {"type":"content_block_stop","index":0}

            event: content_block_start
            data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01","name":"read_file","input":{}}}

            event: content_block_delta
            data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":""}}

            event: content_block_delta
            data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\": \\"tests/lo"}}

            event: content_block_delta
            data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"gin.spec.ts\\", \\"limit\\": 3}"}}

            event: content_block_stop
            data: {"type":"content_block_stop","index":1}

            event: content_block_start
            data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_02","name":"list_files","input":{}}}

            event: content_block_stop
            data: {"type":"content_block_stop","index":2}

            event: message_delta
            data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":89}}

            event: message_stop
            data: {"type":"message_stop"}
            """;

    @Test
    void collectsTextDeltasToolInputPiecesAndUsage() throws Exception {
        List<String> deltas = new ArrayList<>();
        ClaudeStreamParser parser = new ClaudeStreamParser(new ObjectMapper(), "fallback", deltas::add);

        for (String line : STREAM.split("\n")) {
            parser.accept(line);
        }
        LlmResult result = parser.result();

        assertThat(deltas).containsExactly("파일을 ", "확인할게요.");
        assertThat(result.text()).isEqualTo("파일을 확인할게요.");
        assertThat(result.model()).isEqualTo("claude-sonnet-5-20260101");
        assertThat(result.inputTokens()).isEqualTo(25);
        assertThat(result.outputTokens()).isEqualTo(89);
        assertThat(result.toolCalls()).hasSize(2);
        LlmToolCall read = result.toolCalls().get(0);
        assertThat(read.id()).isEqualTo("toolu_01");
        assertThat(read.name()).isEqualTo("read_file");
        assertThat(read.arg("path")).isEqualTo("tests/login.spec.ts");
        assertThat(read.argLong("limit", -1)).isEqualTo(3);
        // 인자 조각이 하나도 오지 않은 도구는 빈 인자로 본다.
        assertThat(result.toolCalls().get(1).name()).isEqualTo("list_files");
        assertThat(result.toolCalls().get(1).arguments()).isEmpty();
    }

    @Test
    void errorEventInsideTheStreamFailsLoudly() {
        ClaudeStreamParser parser = new ClaudeStreamParser(new ObjectMapper(), "m", d -> {});

        assertThatThrownBy(() -> parser.accept(
                "data: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}"))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Overloaded");
    }
}
