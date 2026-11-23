package com.playops.api.chat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.controller.AiChatSessionController;
import com.playops.api.entity.AiChatMessage;
import com.playops.api.entity.AiChatSession;
import com.playops.api.entity.AiModelProvider;
import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.exception.GlobalExceptionHandler;
import com.playops.api.llm.LlmMessage;
import com.playops.api.llm.LlmResult;
import com.playops.api.repository.AiChatMessageRepository;
import com.playops.api.repository.AiChatSessionRepository;
import com.playops.api.service.AiAnalysisService;
import com.playops.api.service.LlmGatewayService;
import com.playops.api.service.ProjectService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anySet;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ChatUiActionTest {

    private static final long SESSION_ID = 10L;
    private static final long QUESTION_ID = 123L;
    private static final String SURFACE_ID = "chat-123-call_1";
    private static final String SESSION = "/api/ai/chat/sessions/" + SESSION_ID;

    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<Long, AiChatMessage> stored = new LinkedHashMap<>();
    private final List<List<LlmMessage>> prompts = new ArrayList<>();
    private final User owner = user(1L, UserRole.USER);
    private final User other = user(2L, UserRole.ADMIN);
    private long nextId = QUESTION_ID + 1;
    private ChatSessionService sessions;
    private ChatAgentService agent;
    private MockMvc mvc;

    @BeforeEach
    void setUp() throws Exception {
        AiChatSessionRepository sessionRepository = mock(AiChatSessionRepository.class);
        AiChatMessageRepository messages = mock(AiChatMessageRepository.class);
        ProjectService projects = mock(ProjectService.class);
        AiChatSession session = new AiChatSession();
        ReflectionTestUtils.setField(session, "id", SESSION_ID);
        session.setUserId(owner.getId());
        session.setTitle("다시 실행");
        when(sessionRepository.findByIdAndUserId(SESSION_ID, owner.getId())).thenReturn(Optional.of(session));
        when(sessionRepository.findById(SESSION_ID)).thenReturn(Optional.of(session));
        when(messages.findBySessionIdOrderByIdAsc(SESSION_ID))
                .thenAnswer(inv -> stored.values().stream().sorted(Comparator.comparing(AiChatMessage::getId)).toList());
        when(messages.findFirstBySessionIdAndRoleOrderByIdDesc(SESSION_ID, AiChatMessage.ROLE_ASSISTANT))
                .thenAnswer(inv -> stored.values().stream()
                        .filter(m -> AiChatMessage.ROLE_ASSISTANT.equals(m.getRole()))
                        .max(Comparator.comparing(AiChatMessage::getId)));
        when(messages.existsBySessionIdAndRole(SESSION_ID, AiChatMessage.ROLE_USER)).thenReturn(true);
        when(messages.findById(any())).thenAnswer(inv -> Optional.ofNullable(stored.get(inv.getArgument(0))));
        when(messages.save(any(AiChatMessage.class))).thenAnswer(inv -> {
            AiChatMessage message = inv.getArgument(0);
            if (message.getId() == null) {
                ReflectionTestUtils.setField(message, "id", nextId++);
            }
            stored.put(message.getId(), message);
            return message;
        });

        ChatBlock question = ChatBlock.tool("call_1", "ask_user", ToolTier.READ, Map.of());
        question.status = "ok";
        question.output = "사용자에게 질문 화면을 보여 줬습니다.";
        question.display = ToolDisplay.of("a2ui", Map.of("surfaceId", SURFACE_ID, "question", "다시 돌릴 테스트는?"));
        store(QUESTION_ID - 1, AiChatMessage.ROLE_USER, List.of(ChatBlock.text("테스트를 다시 돌리자")));
        store(QUESTION_ID, AiChatMessage.ROLE_ASSISTANT, List.of(question));

        AiAnalysisService analysis = mock(AiAnalysisService.class);
        when(analysis.prepareAgentChat(any(), any(), anySet()))
                .thenReturn(new AiAnalysisService.AgentChatSetup(AiModelProvider.CLAUDE, "sys"));
        LlmGatewayService gateway = mock(LlmGatewayService.class);
        when(gateway.chatStream(any(), anyString(), anyList(), anyList(), anyString(), any(), any()))
                .thenAnswer(inv -> {
                    List<LlmMessage> messagesForModel = inv.getArgument(2);
                    prompts.add(List.copyOf(messagesForModel));
                    return new LlmResult("", 1, 1, "fake", List.of());
                });
        sessions = new ChatSessionService(sessionRepository, messages, projects, mapper);
        agent = new ChatAgentService(sessions, new ChatToolRegistry(List.of()), new PermissionBroker(),
                gateway, analysis, mapper, Runnable::run, ChatAgentService.DEFAULT_PERMISSION_TIMEOUT);
        mvc = MockMvcBuilders.standaloneSetup(new AiChatSessionController(sessions, agent, projects))
                .setControllerAdvice(new GlobalExceptionHandler()).build();
    }

    @AfterEach
    void stopAgent() {
        agent.shutdown();
    }

    @Test
    void savesAnswerAndUsesTheSameModelTextOnTheNextTurn() throws Exception {
        String summary = "고른 항목: 로그인";
        Map<String, Object> context = Map.of("selected", List.of("login"));
        finish(send(owner, Map.of("content", summary, "uiAction", action(QUESTION_ID, SURFACE_ID, "submit", context))));

        Map<String, Object> display = sessions.readBlocks(stored.get(QUESTION_ID)).getFirst().display.data();
        JsonNode answer = mapper.valueToTree(display.get("answer"));
        assertThat(answer.get("name").asText()).isEqualTo("submit");
        assertThat(answer.get("context")).isEqualTo(mapper.valueToTree(context));
        assertThat(answer.get("summary").asText()).isEqualTo(summary);
        assertThat(Instant.parse(answer.get("answeredAt").asText())).isBetween(
                stored.get(QUESTION_ID).getCreatedAt(), Instant.now());
        assertThat(sessions.readBlocks(stored.get(QUESTION_ID + 1)).getFirst().text).isEqualTo(summary);
        String modelText = """
                [질문 화면 응답] 질문: 다시 돌릴 테스트는?
                동작: submit
                값: {"selected":["login"]}
                사용자 표시: 고른 항목: 로그인""";
        assertThat(prompts.getFirst().getLast()).isEqualTo(LlmMessage.user(modelText));

        JsonNode response = mapper.readTree(mvc.perform(get(SESSION).requestAttr("currentUser", owner))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray());
        assertThat(response.at("/messages/2/blocks/0")).isEqualTo(
                mapper.valueToTree(Map.of("type", "text", "text", summary)));
        assertThat(response.at("/messages/1/blocks/0/display/data/answer")).isEqualTo(answer);

        finish(send(owner, Map.of("content", "다음 질문")));
        assertThat(prompts.getLast()).contains(LlmMessage.user(modelText));
        assertThat(prompts.getLast().getLast()).isEqualTo(LlmMessage.user("다음 질문"));
    }

    @Test
    void cancelUsesTheDefaultSummaryAndCancellationPrefix() throws Exception {
        finish(send(owner, Map.of("content", " ", "uiAction", action(QUESTION_ID, SURFACE_ID, "cancel", Map.of()))));

        assertThat(prompts.getFirst().getLast()).isEqualTo(LlmMessage.user("""
                사용자가 질문을 취소했습니다.
                [질문 화면 응답] 질문: 다시 돌릴 테스트는?
                동작: cancel
                값: {}
                사용자 표시: 응답을 보냈어요"""));
        assertThat(sessions.readBlocks(stored.get(QUESTION_ID + 1)).getFirst().text)
                .isEqualTo("응답을 보냈어요");
    }

    @ParameterizedTest
    @MethodSource("invalidActions")
    void rejectsInvalidActionBeforeStartingSse(Map<String, Object> action) throws Exception {
        rejected(owner, action, 400);
    }

    private static Stream<Map<String, Object>> invalidActions() {
        return Stream.of(
                action(QUESTION_ID - 1, SURFACE_ID, "submit", Map.of()),
                action(QUESTION_ID, "chat-123-wrong", "submit", Map.of()),
                action(QUESTION_ID, SURFACE_ID, "other", Map.of()),
                action(QUESTION_ID, SURFACE_ID, "submit", Map.of("text", "가".repeat(1_400))),
                action(QUESTION_ID, SURFACE_ID, "submit", "not an object"));
    }

    @Test
    void rejectsAQuestionInAnOlderAssistantMessage() throws Exception {
        store(nextId++, AiChatMessage.ROLE_ASSISTANT, List.of(ChatBlock.text("이미 다음 답변이에요")));

        rejected(owner, action(QUESTION_ID, SURFACE_ID, "submit", Map.of()), 400);
    }

    @Test
    void rejectsAnAlreadyAnsweredSurface() throws Exception {
        List<ChatBlock> blocks = sessions.readBlocks(stored.get(QUESTION_ID));
        blocks.getFirst().display.data().put("answer", Map.of("name", "submit"));
        store(QUESTION_ID, AiChatMessage.ROLE_ASSISTANT, blocks);

        rejected(owner, action(QUESTION_ID, SURFACE_ID, "submit", Map.of()), 400);
    }

    @Test
    void anotherUserCannotAnswerEvenAsAnAdmin() throws Exception {
        rejected(other, action(QUESTION_ID, SURFACE_ID, "submit", Map.of()), 404);
    }

    private static Map<String, Object> action(long messageId, String surfaceId, String name, Object context) {
        return Map.of("messageId", messageId, "surfaceId", surfaceId, "name", name, "context", context);
    }

    private void store(long id, String role, List<ChatBlock> blocks) throws Exception {
        AiChatMessage message = new AiChatMessage();
        ReflectionTestUtils.setField(message, "id", id);
        message.setSessionId(SESSION_ID);
        message.setRole(role);
        message.setBlocks(mapper.writeValueAsString(blocks));
        stored.put(id, message);
    }

    private void finish(ResultActions result) throws Exception {
        mvc.perform(asyncDispatch(result.andExpect(request().asyncStarted()).andReturn()))
                .andExpect(status().isOk()).andExpect(content().contentTypeCompatibleWith(MediaType.TEXT_EVENT_STREAM))
                .andExpect(content().string(containsString("event: message_end")));
    }

    private ResultActions send(User user, Map<String, Object> body) throws Exception {
        return mvc.perform(post(SESSION + "/messages").requestAttr("currentUser", user)
                .contentType(MediaType.APPLICATION_JSON).accept(MediaType.TEXT_EVENT_STREAM)
                .content(mapper.writeValueAsBytes(body)));
    }

    private void rejected(User user, Map<String, Object> action, int code) throws Exception {
        int originalMessageCount = stored.size();
        String originalQuestion = stored.get(QUESTION_ID).getBlocks();
        send(user, Map.of("uiAction", action))
                .andExpect(status().is(code)).andExpect(request().asyncNotStarted())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON));
        assertThat(prompts).isEmpty();
        assertThat(stored).hasSize(originalMessageCount);
        assertThat(stored.get(QUESTION_ID).getBlocks()).isEqualTo(originalQuestion);
        assertThat(agent.isRunning(SESSION_ID)).isFalse();
    }

    private static User user(long id, UserRole role) {
        User user = new User();
        ReflectionTestUtils.setField(user, "id", id);
        user.setRole(role);
        return user;
    }
}
