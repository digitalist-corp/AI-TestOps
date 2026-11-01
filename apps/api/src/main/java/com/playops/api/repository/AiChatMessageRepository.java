package com.playops.api.repository;

import com.playops.api.entity.AiChatMessage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

public interface AiChatMessageRepository extends JpaRepository<AiChatMessage, Long> {
    List<AiChatMessage> findBySessionIdOrderByIdAsc(Long sessionId);

    boolean existsBySessionIdAndRole(Long sessionId, String role);

    @Transactional
    long deleteBySessionId(Long sessionId);
}
