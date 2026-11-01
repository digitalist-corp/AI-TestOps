package com.playops.api.chat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.entity.AiChatMessage;
import com.playops.api.entity.AiChatSession;
import com.playops.api.entity.AiModelProvider;
import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmClient;
import com.playops.api.llm.LlmCredentials;
import com.playops.api.llm.LlmMessage;
import com.playops.api.llm.LlmResult;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolSpec;
import com.playops.api.repository.AiUsageRepository;
import com.playops.api.service.AiAnalysisService;
import com.playops.api.service.AiProviderSettingsService;
import com.playops.api.service.LlmGatewayService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import java.util.function.UnaryOperator;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anySet;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 가짜 모델(LlmClient)과 가짜 도구로 에이전트 루프를 돌려 SSE 이벤트 순서와 저장 결과를 확인한다.
 * 실행기는 호출한 스레드에서 바로 돌게(Runnable::run) 해서 start() 가 끝나면 답변도 끝나 있다.
 */
class ChatAgentServiceTest {

    private static final long USER_ID = 1L;
    private static final long SESSION_ID = 10L;
    private static final long USER_MESSAGE_ID = 100L;
    private static final long ASSISTANT_MESSAGE_ID = 101L;

    private final ChatSessionService sessions = mock(ChatSessionService.class);
    private final AiAnalysisService analysis = mock(AiAnalysisService.class);
    private final AiProviderSettingsService settings = mock(AiProviderSettingsService.class);
    private final AiUsageRepository usageRepository = mock(AiUsageRepository.class);
    private final PermissionBroker broker = new PermissionBroker();
    private final ScriptedLlmClient llm = new ScriptedLlmClient();
    private final FakeTool readTool = new FakeTool("read_x", ToolTier.READ);
    private final FakeTool runTool = new FakeTool("run_x", ToolTier.RUN);
    private final RecordingSink sink = new RecordingSink();

    private AiChatSession session;
    private ChatAgentService service;

    @BeforeEach
    void setUp() {
        session = new AiChatSession();
        ReflectionTestUtils.setField(session, "id", SESSION_ID);
        session.setUserId(USER_ID);
        session.setProjectId("demo");
        session.setTitle("새 대화");

        when(sessions.getOwned(USER_ID, SESSION_ID)).thenReturn(session);
        when(sessions.messages(SESSION_ID)).thenReturn(List.of());
        when(sessions.addUserMessage(any(), anyString())).thenReturn(message(USER_MESSAGE_ID));
        when(sessions.startAssistantMessage(SESSION_ID)).thenReturn(message(ASSISTANT_MESSAGE_ID));
        when(analysis.prepareAgentChat(any(), any(), anySet()))
                .thenReturn(new AiAnalysisService.AgentChatSetup(AiModelProvider.CLAUDE, "sys"));
        when(settings.getDecryptedKey(AiModelProvider.CLAUDE)).thenReturn("key");

        LlmGatewayService gateway = new LlmGatewayService(List.of(llm), settings, usageRepository);
        ChatToolRegistry registry = new ChatToolRegistry(List.of(readTool, runTool));
        service = new ChatAgentService(sessions, registry, broker, gateway, analysis, new ObjectMapper(),
                Runnable::run, Duration.ofSeconds(5));
    }

    private static AiChatMessage message(long id) {
        AiChatMessage message = new AiChatMessage();
        ReflectionTestUtils.setField(message, "id", id);
        return message;
    }

    private void ask(String content) {
        service.start(SESSION_ID, USER_ID, false, content, "JUNIOR", sink);
    }

    @SuppressWarnings("unchecked")
    private List<ChatBlock> savedBlocks(String stopReason) {
        ArgumentCaptor<List<ChatBlock>> captor = ArgumentCaptor.forClass(List.class);
        verify(sessions).saveAssistantBlocks(eq(ASSISTANT_MESSAGE_ID), captor.capture(), eq(stopReason));
        return captor.getValue();
    }

    @Test
    void answerWithoutToolsStreamsTextAndEnds() {
        llm.then(Turn.text("안녕", "하세요").tokens(10, 5));

        ask("안녕?");

        assertThat(sink.names()).containsExactly(
                "message_start", "text_delta", "text_delta", "usage", "message_end");
        assertThat(sink.data("message_start")).containsEntry("userMessageId", USER_MESSAGE_ID)
                .containsEntry("messageId", ASSISTANT_MESSAGE_ID);
        assertThat(sink.all("text_delta")).extracting(d -> d.get("delta")).containsExactly("안녕", "하세요");
        assertThat(sink.data("usage")).containsEntry("inputTokens", 10L).containsEntry("outputTokens", 5L);
        assertThat(sink.data("message_end")).containsEntry("stopReason", "END");
        assertThat(sink.closed).isTrue();

        List<ChatBlock> blocks = savedBlocks("END");
        assertThat(blocks).hasSize(1);
        assertThat(blocks.get(0).text).isEqualTo("안녕하세요");
        assertThat(llm.calls.get(0).messages()).containsExactly(LlmMessage.user("안녕?"));
        assertThat(service.isRunning(SESSION_ID)).isFalse();
    }

    @Test
    void readToolRunsWithoutAskingAndTextAfterItStartsANewBlock() {
        readTool.output = ChatToolOutput.ok("파일 내용", "a.spec.ts");
        llm.then(Turn.text("볼게요").calls(call("c1", "read_x", Map.of("path", "a.spec.ts"))))
           .then(Turn.text("다 봤어요"));

        ask("파일 봐 줘");

        assertThat(sink.names()).containsExactly(
                "message_start", "text_delta", "tool_start", "tool_end", "text_delta", "usage", "message_end");
        assertThat(sink.data("tool_start")).containsEntry("callId", "c1").containsEntry("name", "read_x")
                .containsEntry("tier", "READ").containsEntry("input", Map.of("path", "a.spec.ts"));
        assertThat(sink.data("tool_end")).containsEntry("callId", "c1").containsEntry("status", "ok")
                .containsEntry("summary", "a.spec.ts").containsEntry("output", "파일 내용")
                .containsKey("durationMs");
        assertThat(readTool.contexts).hasSize(1);
        assertThat(readTool.contexts.get(0).projectId()).isEqualTo("demo");
        assertThat(readTool.contexts.get(0).sessionId()).isEqualTo(SESSION_ID);

        // 두 번째 호출에는 도구 요청과 결과가 짝으로 들어간다.
        List<LlmMessage> second = llm.calls.get(1).messages();
        assertThat(second).hasSize(3);
        assertThat(second.get(1).toolCalls()).extracting(LlmToolCall::id).containsExactly("c1");
        assertThat(second.get(2).toolResults().get(0).content()).isEqualTo("파일 내용");

        List<ChatBlock> blocks = savedBlocks("END");
        assertThat(blocks).extracting(b -> b.type).containsExactly("text", "tool", "text");
        assertThat(blocks.get(0).text).isEqualTo("볼게요");
        assertThat(blocks.get(1).status).isEqualTo("ok");
        assertThat(blocks.get(2).text).isEqualTo("다 봤어요");
    }

    @Test
    void runToolAskedAndAllowedRunsOnce() {
        sink.onEvent = answer("ALLOW");
        llm.then(Turn.text().calls(call("c1", "run_x", Map.of())))
           .then(Turn.text("돌렸어요"));

        ask("돌려 줘");

        assertThat(sink.names()).containsExactly(
                "message_start", "tool_start", "permission_request", "permission_resolved", "tool_end",
                "text_delta", "usage", "message_end");
        Map<String, Object> request = sink.data("permission_request");
        assertThat(request).containsEntry("callId", "c1").containsEntry("name", "run_x")
                .containsEntry("reason", "run_x 설명");
        assertThat(sink.data("permission_resolved")).containsEntry("requestId", request.get("requestId"))
                .containsEntry("decision", "ALLOW");
        assertThat(sink.data("tool_end")).containsEntry("status", "ok");
        assertThat(runTool.contexts).hasSize(1);
        verify(sessions, never()).allowTool(anyLong(), anyString());

        ChatBlock tool = savedBlocks("END").get(0);
        assertThat(tool.permission.requestId).isEqualTo(request.get("requestId"));
        assertThat(tool.permission.decision).isEqualTo("ALLOW");
    }

    @Test
    void redactedInputGoesToEventsAndSavedBlockButExecuteGetsTheOriginal() {
        runTool.redactor = input -> {
            Map<String, Object> shown = new LinkedHashMap<>(input);
            shown.put("password", "***");
            return shown;
        };
        sink.onEvent = answer("ALLOW");
        Map<String, Object> args = new LinkedHashMap<>();
        args.put("loginId", "kim");
        args.put("password", "hunter2");
        llm.then(Turn.text().calls(call("c1", "run_x", args)))
           .then(Turn.text("저장했어요"));

        ask("계정 저장해 줘");

        Map<String, Object> shown = Map.of("loginId", "kim", "password", "***");
        assertThat(sink.data("tool_start")).containsEntry("input", shown);
        assertThat(sink.data("permission_request")).containsEntry("input", shown);
        assertThat(savedBlocks("END").get(0).input).isEqualTo(shown);
        // 어느 이벤트에도 원래 비밀번호가 실려 가지 않는다
        assertThat(sink.payloads.toString()).doesNotContain("hunter2");
        // 실제 실행에는 원래 값이 간다
        assertThat(runTool.executed).hasSize(1);
        assertThat(runTool.executed.get(0).arguments()).containsEntry("password", "hunter2");
    }

    @Test
    void redactedInputIsAlsoUsedWhenTheToolIsAlreadyAllowedForTheSession() {
        session.allowTool("run_x");
        runTool.redactor = input -> Map.of("password", "***");
        llm.then(Turn.text().calls(call("c1", "run_x", Map.of("password", "hunter2"))))
           .then(Turn.text("저장했어요"));

        ask("계정 저장해 줘");

        assertThat(sink.names()).doesNotContain("permission_request");
        assertThat(sink.data("tool_start")).containsEntry("input", Map.of("password", "***"));
        assertThat(savedBlocks("END").get(0).input).isEqualTo(Map.of("password", "***"));
        assertThat(runTool.executed.get(0).arguments()).containsEntry("password", "hunter2");
    }

    @Test
    void ifRedactingFailsNothingOfTheInputIsShown() {
        runTool.redactor = input -> {
            throw new IllegalStateException("가리기 실패");
        };
        sink.onEvent = answer("ALLOW");
        llm.then(Turn.text().calls(call("c1", "run_x", Map.of("password", "hunter2"))))
           .then(Turn.text("끝"));

        ask("돌려 줘");

        assertThat(sink.data("tool_start")).containsEntry("input", Map.of());
        assertThat(sink.data("permission_request")).containsEntry("input", Map.of());
        assertThat(savedBlocks("END").get(0).input).isEmpty();
        assertThat(runTool.executed.get(0).arguments()).containsEntry("password", "hunter2");
    }

    @Test
    void unregisteredToolKeepsItsInputAsIs() {
        llm.then(Turn.text().calls(call("c1", "nope_x", Map.of("password", "hunter2"))))
           .then(Turn.text("없는 도구였어요"));

        ask("이상한 거 해 줘");

        assertThat(sink.data("tool_start")).containsEntry("input", Map.of("password", "hunter2"));
        assertThat(sink.data("tool_end")).containsEntry("status", "error");
        assertThat(savedBlocks("END").get(0).input).isEqualTo(Map.of("password", "hunter2"));
    }

    @Test
    void deniedRunToolIsNotExecutedAndModelHearsTheRefusal() {
        sink.onEvent = answer("DENY");
        llm.then(Turn.text().calls(call("c1", "run_x", Map.of())))
           .then(Turn.text("알겠어요"));

        ask("돌려 줘");

        assertThat(sink.names()).containsExactly(
                "message_start", "tool_start", "permission_request", "permission_resolved", "tool_end",
                "text_delta", "usage", "message_end");
        assertThat(sink.data("tool_end")).containsEntry("status", "denied");
        assertThat(runTool.contexts).isEmpty();
        var result = llm.calls.get(1).messages().get(2).toolResults().get(0);
        assertThat(result.error()).isTrue();
        assertThat(result.content()).contains("거부");
        assertThat(savedBlocks("END").get(0).status).isEqualTo("denied");
    }

    @Test
    void allowSessionIsRememberedSoTheSecondCallIsNotAsked() {
        sink.onEvent = answer("ALLOW_SESSION");
        llm.then(Turn.text().calls(call("c1", "run_x", Map.of())))
           .then(Turn.text().calls(call("c2", "run_x", Map.of())))
           .then(Turn.text("두 번 돌렸어요"));

        ask("두 번 돌려 줘");

        assertThat(sink.names()).containsExactly(
                "message_start",
                "tool_start", "permission_request", "permission_resolved", "tool_end",
                "tool_start", "tool_end",
                "text_delta", "usage", "message_end");
        assertThat(runTool.contexts).hasSize(2);
        verify(sessions).allowTool(SESSION_ID, "run_x");
    }

    @Test
    void toolAllowedEarlierInTheSessionIsNotAsked() {
        session.allowTool("run_x");
        llm.then(Turn.text().calls(call("c1", "run_x", Map.of())))
           .then(Turn.text("돌렸어요"));

        ask("돌려 줘");

        assertThat(sink.names()).containsExactly(
                "message_start", "tool_start", "tool_end", "text_delta", "usage", "message_end");
    }

    @Test
    void unansweredPermissionTimesOutAsDeny() {
        service = new ChatAgentService(sessions, new ChatToolRegistry(List.of(readTool, runTool)), broker,
                new LlmGatewayService(List.of(llm), settings, usageRepository), analysis, new ObjectMapper(),
                Runnable::run, Duration.ofMillis(50));
        llm.then(Turn.text().calls(call("c1", "run_x", Map.of())))
           .then(Turn.text("시간이 지나 실행하지 않았어요"));

        ask("돌려 줘");

        assertThat(sink.data("permission_resolved")).containsEntry("decision", "DENY");
        assertThat(sink.data("tool_end")).containsEntry("status", "denied");
        assertThat(runTool.contexts).isEmpty();
    }

    @Test
    void turnLimitEndsWithOneMoreToolFreeSummaryCall() {
        for (int i = 0; i < ChatAgentService.MAX_TURNS; i++) {
            llm.then(Turn.text().calls(call("c" + i, "read_x", Map.of())));
        }
        llm.then(Turn.text("정리").calls(call("ignored", "read_x", Map.of())));

        ask("끝없이 찾아 줘");

        assertThat(llm.calls).hasSize(ChatAgentService.MAX_TURNS + 1);
        assertThat(readTool.contexts).hasSize(ChatAgentService.MAX_TURNS); // 마지막 호출의 도구는 실행하지 않는다
        List<LlmMessage> last = llm.calls.get(ChatAgentService.MAX_TURNS).messages();
        assertThat(last.get(last.size() - 1).content()).contains("상한");
        assertThat(sink.names()).endsWith("text_delta", "usage", "message_end");
        assertThat(sink.data("message_end")).containsEntry("stopReason", "MAX_TURNS");
        assertThat(savedBlocks("MAX_TURNS")).last().satisfies(b -> assertThat(b.text).isEqualTo("정리"));
    }

    @Test
    void tokenBudgetAlsoEndsTheLoop() {
        llm.then(Turn.text().calls(call("c1", "read_x", Map.of())).tokens(150_000, 10_000))
           .then(Turn.text().calls(call("c2", "read_x", Map.of())).tokens(150_000, 10_000))
           .then(Turn.text("정리"));

        ask("많이 찾아 줘");

        assertThat(llm.calls).hasSize(3);
        assertThat(sink.data("message_end")).containsEntry("stopReason", "MAX_TURNS");
        assertThat(sink.data("usage")).containsEntry("inputTokens", 300_000L).containsEntry("outputTokens", 20_000L);
    }

    @Test
    void cancelWhileStreamingStopsTheReplyAndKeepsWhatWasWritten() {
        llm.then(Turn.text("앞부분", "뒷부분").midStream(() -> service.cancel(SESSION_ID)));

        ask("길게 써 줘");

        assertThat(sink.names()).containsExactly("message_start", "text_delta", "usage", "message_end");
        assertThat(sink.data("message_end")).containsEntry("stopReason", "CANCELLED");
        assertThat(savedBlocks("CANCELLED").get(0).text).isEqualTo("앞부분");
        assertThat(Thread.currentThread().isInterrupted()).isFalse();
        assertThat(service.isRunning(SESSION_ID)).isFalse();
    }

    @Test
    void cancelWhileWaitingForPermissionClosesTheToolAsCancelled() {
        sink.onEvent = (name, data) -> {
            if (name.equals("permission_request")) {
                service.cancel(SESSION_ID);
            }
        };
        llm.then(Turn.text().calls(call("c1", "run_x", Map.of())));

        ask("돌려 줘");

        assertThat(sink.names()).containsExactly(
                "message_start", "tool_start", "permission_request", "tool_end", "usage", "message_end");
        assertThat(sink.data("tool_end")).containsEntry("status", "cancelled");
        assertThat(sink.data("message_end")).containsEntry("stopReason", "CANCELLED");
        assertThat(runTool.contexts).isEmpty();
        assertThat(llm.calls).hasSize(1);
    }

    @Test
    void secondMessageWhileAReplyIsRunningIsRejectedWith409() {
        List<Throwable> errors = new ArrayList<>();
        sink.onEvent = (name, data) -> {
            if (name.equals("message_start")) {
                try {
                    service.start(SESSION_ID, USER_ID, false, "또 질문", null, new RecordingSink());
                } catch (Throwable t) {
                    errors.add(t);
                }
            }
        };
        llm.then(Turn.text("답"));

        ask("질문");

        assertThat(errors).singleElement()
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(409));
        assertThat(sink.data("message_end")).containsEntry("stopReason", "END");
    }

    @Test
    void modelFailureEndsWithErrorEvent() {
        llm.then(Turn.failing(new ApiException(502, "Claude API 호출 실패: HTTP 529")));

        ask("질문");

        assertThat(sink.names()).containsExactly("message_start", "usage", "error", "message_end");
        assertThat(sink.data("error")).containsEntry("message", "Claude API 호출 실패: HTTP 529");
        assertThat(sink.data("message_end")).containsEntry("stopReason", "ERROR");
        savedBlocks("ERROR");
    }

    @Test
    void blankMessageIsRejectedBeforeAnythingIsSaved() {
        assertThatThrownBy(() -> ask("  "))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(400));
        verify(sessions, never()).addUserMessage(any(), anyString());
    }

    @Test
    void permissionDecisionForUnknownRequestIs404() {
        assertThatThrownBy(() -> service.decide(SESSION_ID, "nope", "ALLOW"))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(404));
        assertThatThrownBy(() -> service.decide(SESSION_ID, "nope", "MAYBE"))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(400));
    }

    // ---- 도우미 ----

    private BiConsumer<String, Map<String, Object>> answer(String decision) {
        return (name, data) -> {
            if (name.equals("permission_request")) {
                service.decide(SESSION_ID, (String) data.get("requestId"), decision);
            }
        };
    }

    private static LlmToolCall call(String id, String name, Map<String, Object> args) {
        return new LlmToolCall(id, name, args);
    }

    /** 가짜 모델이 한 번 호출될 때 돌려줄 내용. */
    static final class Turn {
        final List<String> deltas = new ArrayList<>();
        List<LlmToolCall> calls = List.of();
        int inputTokens;
        int outputTokens;
        Runnable midStream;
        RuntimeException failure;

        static Turn text(String... deltas) {
            Turn turn = new Turn();
            turn.deltas.addAll(List.of(deltas));
            return turn;
        }

        static Turn failing(RuntimeException failure) {
            Turn turn = new Turn();
            turn.failure = failure;
            return turn;
        }

        Turn calls(LlmToolCall... calls) {
            this.calls = List.of(calls);
            return this;
        }

        Turn tokens(int input, int output) {
            this.inputTokens = input;
            this.outputTokens = output;
            return this;
        }

        /** 첫 글 조각 뒤에 실행할 일 (중단 시험용) */
        Turn midStream(Runnable action) {
            this.midStream = action;
            return this;
        }
    }

    record RecordedCall(List<LlmMessage> messages, List<LlmToolSpec> tools) {}

    /** 정해 둔 순서대로 답하는 가짜 모델. 받은 대화는 복사해 남긴다. */
    static final class ScriptedLlmClient implements LlmClient {
        private final List<Turn> script = new ArrayList<>();
        final List<RecordedCall> calls = new ArrayList<>();

        ScriptedLlmClient then(Turn turn) {
            script.add(turn);
            return this;
        }

        @Override
        public AiModelProvider provider() {
            return AiModelProvider.CLAUDE;
        }

        @Override
        public LlmResult chat(LlmCredentials credentials, String systemPrompt, List<LlmMessage> messages,
                              List<LlmToolSpec> tools) {
            throw new UnsupportedOperationException("채팅 에이전트는 스트리밍만 쓴다");
        }

        @Override
        public LlmResult chatStream(LlmCredentials credentials, String systemPrompt, List<LlmMessage> messages,
                                    List<LlmToolSpec> tools, Consumer<String> onTextDelta) {
            calls.add(new RecordedCall(List.copyOf(messages), tools));
            Turn turn = script.get(calls.size() - 1);
            if (turn.failure != null) {
                throw turn.failure;
            }
            StringBuilder text = new StringBuilder();
            for (int i = 0; i < turn.deltas.size(); i++) {
                onTextDelta.accept(turn.deltas.get(i));
                text.append(turn.deltas.get(i));
                if (i == 0 && turn.midStream != null) {
                    turn.midStream.run();
                }
            }
            return new LlmResult(text.toString(), turn.inputTokens, turn.outputTokens, "fake", turn.calls);
        }
    }

    static final class FakeTool implements ChatTool {
        private final String name;
        private final ToolTier tier;
        final List<ChatToolContext> contexts = new ArrayList<>();
        /** execute 가 받은 호출 그대로 (가리지 않은 원래 입력이 왔는지 확인용) */
        final List<LlmToolCall> executed = new ArrayList<>();
        ChatToolOutput output = ChatToolOutput.ok("완료", "완료");
        /** 입력 가리기를 흉내 낸다. 기본은 가리지 않음 */
        UnaryOperator<Map<String, Object>> redactor = UnaryOperator.identity();

        FakeTool(String name, ToolTier tier) {
            this.name = name;
            this.tier = tier;
        }

        @Override
        public Map<String, Object> redactInput(Map<String, Object> input) {
            return redactor.apply(input);
        }

        @Override
        public LlmToolSpec spec() {
            return new LlmToolSpec(name, name + " 설명", LlmToolSpec.schema(Map.of()));
        }

        @Override
        public ToolTier tier() {
            return tier;
        }

        @Override
        public ChatToolOutput execute(LlmToolCall call, ChatToolContext context) {
            contexts.add(context);
            executed.add(call);
            return output;
        }
    }

    static final class RecordingSink implements ChatEventSink {
        final List<String> names = new ArrayList<>();
        final List<Map<String, Object>> payloads = new ArrayList<>();
        BiConsumer<String, Map<String, Object>> onEvent = (name, data) -> {};
        boolean closed;

        @Override
        public void send(String event, Map<String, Object> data) {
            names.add(event);
            payloads.add(data);
            onEvent.accept(event, data);
        }

        @Override
        public void close() {
            closed = true;
        }

        List<String> names() {
            return names;
        }

        Map<String, Object> data(String event) {
            int index = names.indexOf(event);
            assertThat(index).as("이벤트 %s", event).isNotNegative();
            return payloads.get(index);
        }

        List<Map<String, Object>> all(String event) {
            List<Map<String, Object>> found = new ArrayList<>();
            for (int i = 0; i < names.size(); i++) {
                if (names.get(i).equals(event)) {
                    found.add(payloads.get(i));
                }
            }
            return found;
        }
    }
}
