package com.playops.api.controller;

import com.playops.api.chat.ChatAgentService;
import com.playops.api.chat.ChatDtos;
import com.playops.api.chat.ChatSessionService;
import com.playops.api.entity.AiChatSession;
import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.exception.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;

/**
 * AI 채팅 에이전트의 세션 API. 모양은 docs/design/ai-chat-agent-contract.md 의 REST 절을 따른다.
 * 모든 경로는 내 세션만 다룬다 — 남의 세션 id 를 넣으면 404 다.
 */
@RestController
@RequestMapping("/api/ai/chat/sessions")
public class AiChatSessionController {

    private final ChatSessionService sessionService;
    private final ChatAgentService agentService;
    private final com.playops.api.service.ProjectService projectService;

    public AiChatSessionController(ChatSessionService sessionService, ChatAgentService agentService,
                                   com.playops.api.service.ProjectService projectService) {
        this.sessionService = sessionService;
        this.agentService = agentService;
        this.projectService = projectService;
    }

    @PostMapping
    public ChatDtos.SessionResponse create(@RequestBody(required = false) ChatDtos.CreateSessionRequest body,
                                           HttpServletRequest request) {
        User user = requireAuthenticated(request);
        String projectId = body == null ? null : body.projectId();
        if (projectId != null && !projectId.isBlank()) {
            // 채팅 도구는 대화 중인 프로젝트만 다루므로, 그 프로젝트의 멤버여야 대화를 연다 (#105)
            projectService.getProjectForUser(projectId, user);
        }
        return ChatDtos.SessionResponse.from(sessionService.create(user.getId(), projectId));
    }

    @GetMapping
    public List<ChatDtos.SessionResponse> list(@RequestParam(required = false) String projectId,
                                               HttpServletRequest request) {
        User user = requireAuthenticated(request);
        return sessionService.list(user.getId(), projectId).stream().map(ChatDtos.SessionResponse::from).toList();
    }

    @GetMapping("/{id}")
    public ChatDtos.SessionDetailResponse get(@PathVariable Long id, HttpServletRequest request) {
        User user = requireAuthenticated(request);
        AiChatSession session = sessionService.getOwned(user.getId(), id);
        return new ChatDtos.SessionDetailResponse(
                ChatDtos.SessionResponse.from(session),
                sessionService.messages(session.getId()).stream().map(sessionService::toResponse).toList());
    }

    /** 답변이 진행 중이면 먼저 멈춘다. 멈춘 답변은 저장할 세션이 없으므로 조용히 버려진다. */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id, HttpServletRequest request) {
        User user = requireAuthenticated(request);
        sessionService.getOwned(user.getId(), id);
        agentService.cancel(id);
        sessionService.delete(user.getId(), id);
        return ResponseEntity.noContent().build();
    }

    /** 답변 하나를 SSE 로 흘린다. 같은 세션에서 답변이 진행 중이면 409. */
    @PostMapping(value = "/{id}/messages", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter send(@PathVariable Long id, @RequestBody ChatDtos.SendMessageRequest body,
                           HttpServletRequest request) {
        User user = requireAuthenticated(request);
        return agentService.reply(id, user.getId(), user.getRole() == UserRole.ADMIN,
                body == null ? null : body.content(), body == null ? null : body.userLevel());
    }

    @PostMapping("/{id}/permissions/{requestId}")
    public ResponseEntity<Void> decide(@PathVariable Long id, @PathVariable String requestId,
                                       @RequestBody ChatDtos.PermissionDecisionRequest body,
                                       HttpServletRequest request) {
        User user = requireAuthenticated(request);
        sessionService.getOwned(user.getId(), id);
        agentService.decide(id, requestId, body == null ? null : body.decision());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/cancel")
    public ResponseEntity<Void> cancel(@PathVariable Long id, HttpServletRequest request) {
        User user = requireAuthenticated(request);
        sessionService.getOwned(user.getId(), id);
        agentService.cancel(id);
        return ResponseEntity.noContent().build();
    }

    private User requireAuthenticated(HttpServletRequest request) {
        User user = (User) request.getAttribute("currentUser");
        if (user == null) {
            throw new ApiException(401, "UNAUTHENTICATED", "Authentication required");
        }
        return user;
    }
}
