package com.playops.api.repository;

import com.playops.api.entity.AiChatSession;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AiChatSessionRepository extends JpaRepository<AiChatSession, Long> {
    List<AiChatSession> findByUserIdAndProjectIdOrderByUpdatedAtDesc(Long userId, String projectId, Pageable pageable);

    List<AiChatSession> findByUserIdAndProjectIdIsNullOrderByUpdatedAtDesc(Long userId, Pageable pageable);

    Optional<AiChatSession> findByIdAndUserId(Long id, Long userId);
}
