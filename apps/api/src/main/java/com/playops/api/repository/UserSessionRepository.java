package com.playops.api.repository;

import com.playops.api.entity.UserSession;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface UserSessionRepository extends JpaRepository<UserSession, Long> {
    Optional<UserSession> findByTokenHash(String tokenHash);
    Optional<UserSession> findByToken(String token);
    void deleteByTokenHash(String tokenHash);
    void deleteByToken(String token);
    void deleteByUserId(Long userId);
    List<UserSession> findByUserIdAndRevokedAtIsNull(Long userId);
}
