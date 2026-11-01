package com.playops.api.chat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.entity.AiChatMessage;
import com.playops.api.entity.AiChatSession;
import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmMessage;
import com.playops.api.llm.LlmResult;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolResult;
import com.playops.api.llm.LlmToolSpec;
import com.playops.api.service.AiAnalysisService;
import com.playops.api.service.LlmGatewayService;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;

/**
 * AI 채팅 에이전트 — 세션의 질문 하나에 대해 "모델 호출 → 도구 실행 → 결과 전달"을 답이 나올 때까지 돌리고,
 * 그 과정을 SSE 이벤트로 실시간 흘려 보낸다. 이벤트 모양은 docs/design/ai-chat-agent-contract.md 를 따른다.
 *
 * 루프는 요청 스레드가 아니라 전용 실행기(aiChatExecutor)에서 돈다. 그래서 브라우저가 끊겨도 끝까지 돌고,
 * 턴이 끝날 때마다 결과를 저장해 다시 열면 GET 으로 볼 수 있다.
 *
 * 도구 권한 단계별 처리
 *   READ   — 바로 실행
 *   RUN    — permission_request 를 보내고 사용자 답을 기다린다(최대 5분, 넘으면 거부). ALLOW_SESSION 이면 그 세션 동안 다시 묻지 않는다.
 *   CHANGE — 승인 대기 AI 작업만 만들므로 묻지 않는다
 *
 * 한 답변이 끝없이 돌지 않게 턴 수(25)와 토큰 예산(입력+출력 30만)을 둔다. 상한에 닿으면 도구 없이 정리하라고
 * 한 번 더 물어 마무리하고 MAX_TURNS 로 끝낸다.
 */
@Service
public class ChatAgentService {

    private static final Logger log = LoggerFactory.getLogger(ChatAgentService.class);

    static final int MAX_TURNS = 25;
    static final long TOKEN_BUDGET = 300_000;
    static final String FEATURE = "AI 채팅";
    /** 화면에 보내는 도구 결과 글 상한 (계약: 4000자) */
    static final int MAX_SCREEN_OUTPUT = 4000;
    /** 모델에게 돌려줄 도구 결과 상한. 도구가 스스로 자르지만, 새 도구가 실수해도 컨텍스트가 터지지 않게 한 번 더 막는다. */
    static final int MAX_MODEL_RESULT = 20_000;
    static final long EMITTER_TIMEOUT_MS = Duration.ofMinutes(15).toMillis();
    static final Duration DEFAULT_PERMISSION_TIMEOUT = Duration.ofMinutes(5);

    static final String STOP_END = "END";
    static final String STOP_CANCELLED = "CANCELLED";
    static final String STOP_MAX_TURNS = "MAX_TURNS";
    static final String STOP_ERROR = "ERROR";

    private final ChatSessionService sessions;
    private final ChatToolRegistry registry;
    private final PermissionBroker broker;
    private final LlmGatewayService gateway;
    private final AiAnalysisService analysis;
    private final ObjectMapper objectMapper;
    private final Executor executor;
    private final Duration permissionTimeout;
    private final ScheduledExecutorService pingScheduler = Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "playops-ai-chat-ping");
        thread.setDaemon(true);
        return thread;
    });

    /** 세션 id → 진행 중인 답변. 한 세션에 동시에 하나만 돈다. */
    private final Map<Long, RunState> running = new ConcurrentHashMap<>();

    @Autowired
    public ChatAgentService(ChatSessionService sessions, ChatToolRegistry registry, PermissionBroker broker,
                            LlmGatewayService gateway, AiAnalysisService analysis, ObjectMapper objectMapper,
                            @Qualifier("aiChatExecutor") Executor executor) {
        this(sessions, registry, broker, gateway, analysis, objectMapper, executor, DEFAULT_PERMISSION_TIMEOUT);
    }

    ChatAgentService(ChatSessionService sessions, ChatToolRegistry registry, PermissionBroker broker,
                     LlmGatewayService gateway, AiAnalysisService analysis, ObjectMapper objectMapper,
                     Executor executor, Duration permissionTimeout) {
        this.sessions = sessions;
        this.registry = registry;
        this.broker = broker;
        this.gateway = gateway;
        this.analysis = analysis;
        this.objectMapper = objectMapper;
        this.executor = executor;
        this.permissionTimeout = permissionTimeout;
    }

    @PreDestroy
    void shutdown() {
        pingScheduler.shutdownNow();
    }

    /** POST .../messages — 답변 하나를 시작하고, 끝날 때까지 이벤트를 흘릴 SSE 스트림을 돌려준다. */
    public SseEmitter reply(Long sessionId, Long userId, boolean admin, String content, String userLevel) {
        SseEmitter emitter = new SseEmitter(EMITTER_TIMEOUT_MS);
        start(sessionId, userId, admin, content, userLevel, new SseChatEventSink(emitter, objectMapper, pingScheduler));
        return emitter;
    }

    /** POST .../cancel — 진행 중인 답변을 멈춘다. 진행 중인 답변이 없으면 아무것도 하지 않는다. */
    public void cancel(Long sessionId) {
        RunState state = running.get(sessionId);
        if (state != null) {
            state.cancel();
        }
        broker.cancelSession(sessionId);
    }

    public boolean isRunning(Long sessionId) {
        return running.containsKey(sessionId);
    }

    /** POST .../permissions/{requestId} */
    public void decide(Long sessionId, String requestId, String rawDecision) {
        PermissionBroker.Decision decision;
        try {
            decision = PermissionBroker.Decision.valueOf(rawDecision == null ? "" : rawDecision.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new ApiException(400, "decision 은 ALLOW, ALLOW_SESSION, DENY 중 하나여야 합니다.");
        }
        if (!broker.resolve(sessionId, requestId, decision)) {
            throw new ApiException(404, "기다리는 허락 요청이 없습니다. 이미 답했거나 시간이 지났습니다.");
        }
    }

    /**
     * 검증 · 저장을 요청 스레드에서 끝내고(그래야 404 · 409 가 일반 JSON 오류로 나간다) 루프만 실행기에 넘긴다.
     */
    void start(Long sessionId, Long userId, boolean admin, String content, String userLevel, ChatEventSink sink) {
        if (content == null || content.isBlank()) {
            throw new ApiException(400, "메시지를 입력해주세요.");
        }
        AiChatSession session = sessions.getOwned(userId, sessionId);
        RunState state = new RunState();
        if (running.putIfAbsent(sessionId, state) != null) {
            throw new ApiException(409, "이 대화에서 아직 답변을 만들고 있습니다. 끝나거나 멈춘 뒤 다시 보내세요.");
        }
        AiChatMessage assistant = null;
        try {
            List<AiChatMessage> history = sessions.messages(sessionId);
            AiChatMessage user = sessions.addUserMessage(session, content.trim());
            assistant = sessions.startAssistantMessage(sessionId);
            Run run = new Run(state, sink, sessionId, session.getProjectId(), userId, admin,
                    content.trim(), userLevel, history, session.getAllowedToolNames(), user.getId(), assistant.getId());
            executor.execute(() -> runSafely(run));
        } catch (RejectedExecutionException e) {
            running.remove(sessionId, state);
            if (assistant != null) {
                sessions.saveAssistantBlocks(assistant.getId(), List.of(), STOP_ERROR);
            }
            throw new ApiException(503, "지금은 AI 채팅 요청이 많아 처리할 수 없습니다. 잠시 뒤 다시 시도하세요.");
        } catch (RuntimeException e) {
            running.remove(sessionId, state);
            throw e;
        }
    }

    private void runSafely(Run run) {
        try {
            execute(run);
        } catch (Throwable t) {
            // execute 가 스스로 마무리하지 못한 경우의 마지막 안전망
            log.error("AI 채팅 루프가 예상치 못하게 끝남 (session {})", run.sessionId, t);
            run.sink.send("error", Map.of("message", "답변을 만드는 중 서버 오류가 났습니다."));
            run.sink.send("message_end", messageEnd(run.messageId, STOP_ERROR));
        } finally {
            running.remove(run.sessionId, run.state);
            run.sink.close();
        }
    }

    private void execute(Run run) {
        run.sink.open();
        Map<String, Object> start = new LinkedHashMap<>();
        start.put("userMessageId", run.userMessageId);
        start.put("messageId", run.messageId);
        run.sink.send("message_start", start);

        List<ChatBlock> blocks = new ArrayList<>();
        String stopReason = null;
        String errorMessage = null;
        try {
            AiAnalysisService.AgentChatSetup setup =
                    analysis.prepareAgentChat(run.projectId, run.userLevel, registry.names());
            List<LlmMessage> messages = new ArrayList<>(ChatHistory.toLlmMessages(run.history, sessions::readBlocks));
            messages.add(LlmMessage.user(run.content));
            List<LlmToolSpec> tools = registry.specs();
            ChatToolContext context = new ChatToolContext(run.projectId, run.userId, run.admin, run.sessionId);

            for (int turn = 0; turn < MAX_TURNS && run.totalTokens() < TOKEN_BUDGET; turn++) {
                LlmResult result = streamTurn(run, setup, messages, tools, blocks);
                if (!result.hasToolCalls()) {
                    stopReason = STOP_END;
                    break;
                }
                messages.add(LlmMessage.toolRequest(result.text(), result.toolCalls()));
                List<LlmToolResult> results = new ArrayList<>();
                for (LlmToolCall call : result.toolCalls()) {
                    run.state.checkCancelled();
                    results.add(runTool(run, call, context, blocks));
                }
                messages.add(LlmMessage.toolResponse(results));
                sessions.saveAssistantBlocks(run.messageId, blocks, null);
            }

            if (stopReason == null) {
                // 상한에 닿았다 — 지금까지 알아낸 것으로 정리하게 한 번 더 묻는다. 도구 목록은 그대로 넘긴다
                // (이전 턴의 도구 호출이 대화에 있으면 Claude 는 도구 정의를 요구한다). 이번에 부른 도구는 실행하지 않는다.
                messages.add(LlmMessage.user(
                        "도구 사용 상한(턴 수 또는 토큰 예산)에 닿았습니다. 더 이상 도구를 부르지 말고, "
                                + "지금까지 확인한 내용만으로 답을 정리해 주세요. 확인하지 못한 부분은 그렇다고 밝혀 주세요."));
                streamTurn(run, setup, messages, tools, blocks);
                stopReason = STOP_MAX_TURNS;
            }
        } catch (ChatCancelledException e) {
            stopReason = STOP_CANCELLED;
        } catch (Exception e) {
            if (run.state.cancelled) {
                stopReason = STOP_CANCELLED;
            } else {
                log.warn("AI 채팅 답변 실패 (session {}): {}", run.sessionId, e.getMessage());
                stopReason = STOP_ERROR;
                errorMessage = e instanceof ApiException ? e.getMessage() : "AI 호출 실패: " + e.getMessage();
            }
        }
        // 중단 신호로 남은 인터럽트 표시를 지워야 아래 DB 저장이 실패하지 않는다.
        Thread.interrupted();

        closeDanglingTools(run, blocks, stopReason);

        Map<String, Object> usage = new LinkedHashMap<>();
        usage.put("inputTokens", run.inputTokens);
        usage.put("outputTokens", run.outputTokens);
        run.sink.send("usage", usage);
        if (errorMessage != null) {
            run.sink.send("error", Map.of("message", errorMessage));
        }
        sessions.saveAssistantBlocks(run.messageId, blocks, stopReason);
        run.sink.send("message_end", messageEnd(run.messageId, stopReason));
    }

    /** 모델 한 번 호출. 글 조각은 받는 대로 text_delta 로 보내고 현재 text 블록에 이어 붙인다. */
    private LlmResult streamTurn(Run run, AiAnalysisService.AgentChatSetup setup, List<LlmMessage> messages,
                                 List<LlmToolSpec> tools, List<ChatBlock> blocks) {
        run.state.checkCancelled();
        ChatBlock[] current = {null};
        run.state.beginLlmCall();
        LlmResult result;
        try {
            result = gateway.chatStream(setup.provider(), setup.systemPrompt(), messages, tools, FEATURE,
                    run.projectId, delta -> {
                        // 브라우저로 쓰는 동안 인터럽트되면 SSE 연결이 깨져 message_end 를 못 보낸다. 쓰는 동안은 인터럽트를 받지 않는다.
                        run.state.leaveInterruptible();
                        try {
                            run.state.checkCancelled();
                            if (current[0] == null) {
                                // 도구 호출 뒤에 오는 글은 새 text 블록이 된다 (계약).
                                current[0] = ChatBlock.text("");
                                blocks.add(current[0]);
                            }
                            current[0].text += delta;
                            run.sink.send("text_delta", Map.of("delta", delta));
                        } finally {
                            run.state.enterInterruptible();
                        }
                    });
        } finally {
            run.state.endLlmCall();
        }
        run.inputTokens += result.inputTokens();
        run.outputTokens += result.outputTokens();
        return result;
    }

    private LlmToolResult runTool(Run run, LlmToolCall call, ChatToolContext context, List<ChatBlock> blocks) {
        Optional<ChatTool> found = registry.find(call.name());
        ToolTier tier = found.map(ChatTool::tier).orElse(ToolTier.READ);
        Map<String, Object> input = call.arguments() == null ? Map.of() : call.arguments();
        // 화면 · 이벤트 · 저장된 블록에는 가린 입력만 쓴다. 실제 실행(tool.execute)에는 원래 입력(call)이 간다.
        Map<String, Object> shownInput = found.map(t -> redactedInput(t, call, input)).orElse(input);
        ChatBlock block = ChatBlock.tool(call.id(), call.name(), tier, shownInput);
        blocks.add(block);

        Map<String, Object> toolStart = new LinkedHashMap<>();
        toolStart.put("callId", call.id());
        toolStart.put("name", call.name());
        toolStart.put("tier", tier.name());
        toolStart.put("input", shownInput);
        run.sink.send("tool_start", toolStart);

        if (found.isEmpty()) {
            return finishTool(run, call, block, ChatToolOutput.failed("알 수 없는 도구입니다: " + call.name()), System.currentTimeMillis());
        }
        ChatTool tool = found.get();

        if (tier == ToolTier.RUN && !run.allowedTools.contains(call.name())) {
            long askedAt = System.currentTimeMillis();
            PermissionBroker.Decision decision = askPermission(run, tool, call, context, shownInput, block);
            if (decision == null) {
                block.status = "cancelled";
                block.durationMs = System.currentTimeMillis() - askedAt;
                run.sink.send("tool_end", toolEnd(block));
                throw new ChatCancelledException();
            }
            if (decision == PermissionBroker.Decision.DENY) {
                block.status = "denied";
                block.summary = "사용자가 거부함";
                block.durationMs = System.currentTimeMillis() - askedAt;
                run.sink.send("tool_end", toolEnd(block));
                return LlmToolResult.failed(call.id(),
                        "사용자가 이 도구 실행을 거부했습니다. 같은 실행을 다시 요청하지 말고, 거부된 사실을 받아들여 답을 이어가세요.");
            }
        }

        long startedAt = System.currentTimeMillis();
        ChatToolOutput output;
        try {
            output = tool.execute(call, context);
            if (output == null) {
                output = ChatToolOutput.failed("도구가 결과를 돌려주지 않았습니다.");
            }
        } catch (Exception e) {
            log.warn("채팅 도구 실행 실패 [{}]: {}", call.name(), e.getMessage());
            output = ChatToolOutput.failed("도구 실행 실패: " + e.getMessage());
        }
        return finishTool(run, call, block, output, startedAt);
    }

    /** 도구가 정한 대로 입력을 가린다. 가리다 실패하면 아무것도 보이지 않게 비운다 (비밀이 새는 것보다 낫다). */
    private Map<String, Object> redactedInput(ChatTool tool, LlmToolCall call, Map<String, Object> input) {
        try {
            Map<String, Object> redacted = tool.redactInput(input);
            return redacted == null ? Map.of() : redacted;
        } catch (Exception e) {
            log.warn("채팅 도구 입력 가리기 실패 [{}]: {}", call.name(), e.getMessage());
            return Map.of();
        }
    }

    /** @return 사용자의 결정, 답변이 중단되면 null. input 은 화면에 보낼 가린 입력이다. */
    private PermissionBroker.Decision askPermission(Run run, ChatTool tool, LlmToolCall call, ChatToolContext context,
                                                    Map<String, Object> input, ChatBlock block) {
        String reason;
        try {
            reason = tool.permissionReason(call, context);
        } catch (Exception e) {
            reason = tool.spec().description();
        }
        String requestId = broker.open(run.sessionId);
        block.permission = new ChatBlock.Permission(requestId, reason);

        Map<String, Object> request = new LinkedHashMap<>();
        request.put("requestId", requestId);
        request.put("callId", call.id());
        request.put("name", call.name());
        request.put("input", input);
        request.put("reason", reason);
        run.sink.send("permission_request", request);

        // 취소가 open 과 이벤트 사이에 들어왔다면 cancelSession 이 이 요청을 못 봤을 수 있다.
        PermissionBroker.Decision decision = run.state.cancelled ? null : broker.await(requestId, permissionTimeout);
        if (decision == null || run.state.cancelled) {
            return null;
        }
        block.permission.decision = decision.name();
        Map<String, Object> resolved = new LinkedHashMap<>();
        resolved.put("requestId", requestId);
        resolved.put("decision", decision.name());
        run.sink.send("permission_resolved", resolved);

        if (decision == PermissionBroker.Decision.ALLOW_SESSION) {
            run.allowedTools.add(call.name());
            sessions.allowTool(run.sessionId, call.name());
        }
        return decision;
    }

    private LlmToolResult finishTool(Run run, LlmToolCall call, ChatBlock block, ChatToolOutput output, long startedAt) {
        String content = output.content() == null ? "" : output.content();
        block.status = output.error() ? "error" : "ok";
        block.summary = output.summary();
        block.output = truncate(content, MAX_SCREEN_OUTPUT);
        block.display = output.display();
        block.durationMs = System.currentTimeMillis() - startedAt;
        run.sink.send("tool_end", toolEnd(block));

        String forModel = truncate(content, MAX_MODEL_RESULT);
        return output.error() ? LlmToolResult.failed(call.id(), forModel) : LlmToolResult.ok(call.id(), forModel);
    }

    /** 끝났는데 아직 running 인 도구 블록(중단 · 오류로 끊긴 것)을 정리하고 tool_end 를 보내 화면 카드가 멈춰 있지 않게 한다. */
    private void closeDanglingTools(Run run, List<ChatBlock> blocks, String stopReason) {
        for (ChatBlock block : blocks) {
            if (block.isToolBlock() && "running".equals(block.status)) {
                block.status = STOP_CANCELLED.equals(stopReason) ? "cancelled" : "error";
                run.sink.send("tool_end", toolEnd(block));
            }
        }
    }

    private Map<String, Object> toolEnd(ChatBlock block) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("callId", block.callId);
        data.put("status", block.status);
        if (block.summary != null) {
            data.put("summary", block.summary);
        }
        if (block.output != null) {
            data.put("output", block.output);
        }
        if (block.display != null) {
            data.put("display", block.display);
        }
        data.put("durationMs", block.durationMs == null ? 0L : block.durationMs);
        return data;
    }

    private static Map<String, Object> messageEnd(Long messageId, String stopReason) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("messageId", messageId);
        data.put("stopReason", stopReason);
        return data;
    }

    private static String truncate(String text, int max) {
        if (text.length() <= max) {
            return text;
        }
        return text.substring(0, max) + "\n... (이후 생략)";
    }

    /** 답변 하나를 돌리는 데 필요한 값과 진행 중 누적값. 루프 스레드만 고친다. */
    private static final class Run {
        final RunState state;
        final ChatEventSink sink;
        final Long sessionId;
        final String projectId;
        final Long userId;
        final boolean admin;
        final String content;
        final String userLevel;
        final List<AiChatMessage> history;
        final Set<String> allowedTools;
        final Long userMessageId;
        final Long messageId;
        long inputTokens;
        long outputTokens;

        Run(RunState state, ChatEventSink sink, Long sessionId, String projectId, Long userId, boolean admin,
            String content, String userLevel, List<AiChatMessage> history, Set<String> allowedTools,
            Long userMessageId, Long messageId) {
            this.state = state;
            this.sink = sink;
            this.sessionId = sessionId;
            this.projectId = projectId;
            this.userId = userId;
            this.admin = admin;
            this.content = content;
            this.userLevel = userLevel;
            this.history = history;
            this.allowedTools = new HashSet<>(allowedTools);
            this.userMessageId = userMessageId;
            this.messageId = messageId;
        }

        long totalTokens() {
            return inputTokens + outputTokens;
        }
    }

    /**
     * 중단 신호. cancel() 은 다른 스레드(요청 스레드)에서 온다.
     * 모델 스트림을 읽는 동안에만 루프 스레드를 인터럽트해 HTTP 읽기를 끊는다 — 도구 실행 중에 끊으면
     * DB 작업이 어중간하게 멈출 수 있어서, 도구는 끝까지 실행한 뒤 다음 단계에서 멈춘다.
     */
    static final class RunState {
        volatile boolean cancelled;
        private Thread llmThread;

        void beginLlmCall() {
            enterInterruptible();
        }

        void endLlmCall() {
            leaveInterruptible();
        }

        /** 지금부터 cancel() 이 이 스레드를 인터럽트해도 된다. 이미 중단됐으면 바로 멈춘다. */
        synchronized void enterInterruptible() {
            checkCancelled();
            llmThread = Thread.currentThread();
        }

        /** 지금부터는 인터럽트하지 않는다. 그 사이 들어온 인터럽트 표시도 지운다 (cancelled 값은 남는다). */
        void leaveInterruptible() {
            synchronized (this) {
                llmThread = null;
            }
            Thread.interrupted();
        }

        synchronized void cancel() {
            cancelled = true;
            if (llmThread != null) {
                llmThread.interrupt();
            }
        }

        void checkCancelled() {
            if (cancelled) {
                throw new ChatCancelledException();
            }
        }
    }
}
