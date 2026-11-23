package com.playops.api.repository;

import com.playops.api.entity.AiChatMessage;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

public interface AiChatMessageRepository extends JpaRepository<AiChatMessage, Long> {
    List<AiChatMessage> findBySessionIdOrderByIdAsc(Long sessionId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<AiChatMessage> findFirstBySessionIdAndRoleOrderByIdDesc(Long sessionId, String role);

    boolean existsBySessionIdAndRole(Long sessionId, String role);

    @Transactional
    long deleteBySessionId(Long sessionId);
}
