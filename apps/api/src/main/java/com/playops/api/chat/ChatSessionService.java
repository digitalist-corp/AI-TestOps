package com.playops.api.chat;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.entity.AiChatMessage;
import com.playops.api.entity.AiChatSession;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.AiChatMessageRepository;
import com.playops.api.repository.AiChatSessionRepository;
import com.playops.api.service.ProjectService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 채팅 세션과 메시지 저장. 세션은 만든 사람만 보고 쓸 수 있고, 남의 세션은 없는 것처럼 404 로 답한다.
 */
@Service
public class ChatSessionService {

    private static final Logger log = LoggerFactory.getLogger(ChatSessionService.class);

    static final String DEFAULT_TITLE = "새 대화";
    private static final int TITLE_LENGTH = 40;
    private static final int LIST_LIMIT = 30;
    private static final TypeReference<List<ChatBlock>> BLOCK_LIST = new TypeReference<>() {};

    private final AiChatSessionRepository sessionRepository;
    private final AiChatMessageRepository messageRepository;
    private final ProjectService projectService;
    private final ObjectMapper objectMapper;

    public ChatSessionService(AiChatSessionRepository sessionRepository,
                              AiChatMessageRepository messageRepository,
                              ProjectService projectService,
                              ObjectMapper objectMapper) {
        this.sessionRepository = sessionRepository;
        this.messageRepository = messageRepository;
        this.projectService = projectService;
        this.objectMapper = objectMapper;
    }

    public AiChatSession create(Long userId, String projectId) {
        String normalized = projectId == null || projectId.isBlank() ? null : projectId.trim();
        if (normalized != null) {
            projectService.getProject(normalized); // 없는 프로젝트면 여기서 404
        }
        AiChatSession session = new AiChatSession();
        session.setUserId(userId);
        session.setProjectId(normalized);
        session.setTitle(DEFAULT_TITLE);
        return sessionRepository.save(session);
    }

    /** 내 세션 최근 수정순 30개. projectId 가 없으면 프로젝트 없이 연 세션만. */
    public List<AiChatSession> list(Long userId, String projectId) {
        PageRequest page = PageRequest.of(0, LIST_LIMIT);
        if (projectId == null || projectId.isBlank()) {
            return sessionRepository.findByUserIdAndProjectIdIsNullOrderByUpdatedAtDesc(userId, page);
        }
        return sessionRepository.findByUserIdAndProjectIdOrderByUpdatedAtDesc(userId, projectId.trim(), page);
    }

    public AiChatSession getOwned(Long userId, Long sessionId) {
        return sessionRepository.findByIdAndUserId(sessionId, userId)
                .orElseThrow(() -> new ApiException(404, "대화를 찾을 수 없습니다."));
    }

    public List<AiChatMessage> messages(Long sessionId) {
        return messageRepository.findBySessionIdOrderByIdAsc(sessionId);
    }

    @Transactional
    public void delete(Long userId, Long sessionId) {
        AiChatSession session = getOwned(userId, sessionId);
        messageRepository.deleteBySessionId(session.getId());
        sessionRepository.delete(session);
    }

    /** 사용자 메시지를 남긴다. 세션의 첫 메시지면 앞 40자를 제목으로 삼는다. */
    public AiChatMessage addUserMessage(AiChatSession session, String content) {
        boolean first = !messageRepository.existsBySessionIdAndRole(session.getId(), AiChatMessage.ROLE_USER);
        AiChatMessage message = new AiChatMessage();
        message.setSessionId(session.getId());
        message.setRole(AiChatMessage.ROLE_USER);
        message.setBlocks(writeBlocks(List.of(ChatBlock.text(content))));
        message = messageRepository.save(message);

        if (first) {
            session.setTitle(titleOf(content));
        }
        session.touch();
        sessionRepository.save(session);
        return message;
    }

    /** 이번 답변의 assistant 메시지 자리를 먼저 만든다. id 를 message_start 로 알려 주기 위해서다. */
    public AiChatMessage startAssistantMessage(Long sessionId) {
        AiChatMessage message = new AiChatMessage();
        message.setSessionId(sessionId);
        message.setRole(AiChatMessage.ROLE_ASSISTANT);
        message.setBlocks("[]");
        return messageRepository.save(message);
    }

    /** 턴이 끝날 때마다, 그리고 답변이 끝날 때 블록을 덮어쓴다. 저장 실패가 답변을 망치지 않게 기록만 남긴다. */
    public void saveAssistantBlocks(Long messageId, List<ChatBlock> blocks, String stopReason) {
        try {
            AiChatMessage message = messageRepository.findById(messageId).orElse(null);
            if (message == null) {
                return; // 답변 도중 세션이 지워졌다
            }
            message.setBlocks(writeBlocks(blocks));
            message.setStopReason(stopReason);
            messageRepository.save(message);
            if (stopReason != null) {
                sessionRepository.findById(message.getSessionId()).ifPresent(session -> {
                    session.touch();
                    sessionRepository.save(session);
                });
            }
        } catch (Exception e) {
            log.warn("채팅 답변 저장 실패 (message {}): {}", messageId, e.getMessage());
        }
    }

    /** ALLOW_SESSION 으로 허락한 도구를 기록한다. 다음 답변부터는 묻지 않는다. */
    public void allowTool(Long sessionId, String toolName) {
        try {
            sessionRepository.findById(sessionId).ifPresent(session -> {
                session.allowTool(toolName);
                sessionRepository.save(session);
            });
        } catch (Exception e) {
            log.warn("세션 허락 기록 실패 (session {}, tool {}): {}", sessionId, toolName, e.getMessage());
        }
    }

    public List<ChatBlock> readBlocks(AiChatMessage message) {
        try {
            List<ChatBlock> blocks = objectMapper.readValue(message.getBlocks(), BLOCK_LIST);
            return blocks == null ? List.of() : blocks;
        } catch (Exception e) {
            log.warn("채팅 메시지 블록을 읽지 못함 (message {}): {}", message.getId(), e.getMessage());
            return List.of();
        }
    }

    public ChatDtos.MessageResponse toResponse(AiChatMessage message) {
        return new ChatDtos.MessageResponse(message.getId(), message.getRole(), message.getCreatedAt(),
                readBlocks(message),
                AiChatMessage.ROLE_ASSISTANT.equals(message.getRole()) ? message.getStopReason() : null);
    }

    private String writeBlocks(List<ChatBlock> blocks) {
        try {
            return objectMapper.writeValueAsString(blocks);
        } catch (Exception e) {
            throw new IllegalStateException("채팅 블록을 저장용 글자로 바꾸지 못했습니다: " + e.getMessage(), e);
        }
    }

    static String titleOf(String content) {
        String oneLine = content.replaceAll("\\s+", " ").trim();
        if (oneLine.isEmpty()) {
            return DEFAULT_TITLE;
        }
        if (oneLine.codePointCount(0, oneLine.length()) <= TITLE_LENGTH) {
            return oneLine;
        }
        // 이모지처럼 두 칸짜리 글자가 반으로 잘리지 않게 글자(code point) 단위로 자른다.
        return oneLine.substring(0, oneLine.offsetByCodePoints(0, TITLE_LENGTH));
    }
}
