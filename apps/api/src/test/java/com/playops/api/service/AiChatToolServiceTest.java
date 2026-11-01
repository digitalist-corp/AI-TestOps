package com.playops.api.service;

import com.playops.api.chat.ChatTool;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ChatToolRegistry;
import com.playops.api.chat.ToolDisplay;
import com.playops.api.chat.ToolTier;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolResult;
import com.playops.api.llm.LlmToolSpec;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** 한 번에 답하는 기존 채팅이 레지스트리 위에서도 예전처럼 동작하는지 본다. */
class AiChatToolServiceTest {

    private final List<LlmToolCall> fixCalls = new ArrayList<>();

    private final ChatTool fixTest = new ChatTool() {
        @Override
        public LlmToolSpec spec() {
            return new LlmToolSpec("fix_test", "수정", LlmToolSpec.schema(Map.of()));
        }

        @Override
        public ToolTier tier() {
            return ToolTier.CHANGE;
        }

        @Override
        public ChatToolOutput execute(LlmToolCall call, ChatToolContext context) {
            fixCalls.add(call);
            return ChatToolOutput.ok("AI 작업 #5", "tests/a.spec.ts 수정 요청", ToolDisplay.of("job",
                    Map.of("jobId", 5L, "jobType", "CODE_FIX", "status", "PENDING", "specPath", "tests/a.spec.ts")));
        }
    };

    private final ChatTool runTests = new ChatTool() {
        @Override
        public LlmToolSpec spec() {
            return new LlmToolSpec("run_tests", "실행", LlmToolSpec.schema(Map.of()));
        }

        @Override
        public ToolTier tier() {
            return ToolTier.RUN;
        }

        @Override
        public ChatToolOutput execute(LlmToolCall call, ChatToolContext context) {
            throw new AssertionError("허락을 물을 화면이 없는 채팅에서는 RUN 도구를 실행하면 안 된다");
        }
    };

    private final AiChatToolService service =
            new AiChatToolService(new ChatToolRegistry(List.of(fixTest, runTests)));

    @Test
    void onlyReadAndChangeToolsAreOfferedAndOnlyWithAProject() {
        assertThat(service.toolsFor(new AiChatToolService.ToolContext(null, 1L, null))).isEmpty();
        assertThat(service.toolsFor(new AiChatToolService.ToolContext("demo", 1L, null)))
                .extracting(LlmToolSpec::name).containsExactly("fix_test");
    }

    @Test
    void runToolIsRefusedEvenIfTheModelCallsIt() {
        LlmToolResult result = service.execute(new LlmToolCall("c1", "run_tests", Map.of()),
                new AiChatToolService.ToolContext("demo", 1L, null));
        assertThat(result.error()).isTrue();
    }

    @Test
    void fixTestGetsTheExecutionOnScreenAndBecomesAnActionCard() {
        AiChatToolService.ToolContext context = new AiChatToolService.ToolContext("demo", 1L, 42L);

        LlmToolResult result = service.execute(new LlmToolCall("c1", "fix_test",
                Map.of("specPath", "tests/a.spec.ts", "instruction", "셀렉터를 고쳐라")), context);

        assertThat(result.error()).isFalse();
        assertThat(fixCalls.get(0).arg("executionId")).isEqualTo("42");
        assertThat(context.actions()).singleElement().satisfies(action -> {
            assertThat(action.type()).isEqualTo("FIX_TEST");
            assertThat(action.status()).isEqualTo("CREATED");
            assertThat(action.jobId()).isEqualTo(5L);
            assertThat(action.projectId()).isEqualTo("demo");
            assertThat(action.specPath()).isEqualTo("tests/a.spec.ts");
            assertThat(action.detail()).isEqualTo("셀렉터를 고쳐라");
        });
    }
}
