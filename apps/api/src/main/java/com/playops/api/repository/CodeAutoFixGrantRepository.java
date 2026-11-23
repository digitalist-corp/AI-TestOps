package com.playops.api.repository;

import com.playops.api.entity.CodeAutoFixGrant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

/** 상태 전이는 조건부 갱신으로만 한다: 바뀐 행이 1 이면 내 요청이 이겼다 (동시 재요청 · 동시 결정이 서로 덮지 않게). */
public interface CodeAutoFixGrantRepository extends JpaRepository<CodeAutoFixGrant, Long> {
    Optional<CodeAutoFixGrant> findByProjectIdAndUserId(String projectId, Long userId);

    List<CodeAutoFixGrant> findByProjectIdOrderByRequestedAtDesc(String projectId);

    /** 거절 · 회수됐거나 이전 멤버십의 줄을 대기로 다시 연다. 이미 지금 멤버십으로 대기 · 부여 중이면 0 */
    @Transactional
    @Modifying(clearAutomatically = true)
    @Query("UPDATE CodeAutoFixGrant g SET g.status = 'PENDING', g.scopes = NULL, g.memberSince = :since, g.note = :note, "
            + "g.requestedAt = :now, g.decidedBy = NULL, g.decidedAt = NULL "
            + "WHERE g.id = :id AND (g.memberSince <> :since OR g.status IN ('REJECTED', 'REVOKED'))")
    int reopen(@Param("id") Long id, @Param("since") Instant since, @Param("note") String note, @Param("now") Instant now);

    /** 지금 상태가 from 중 하나일 때만 to 로 바꾼다 (부여 · 거절 · 회수) */
    @Transactional
    @Modifying(clearAutomatically = true)
    @Query("UPDATE CodeAutoFixGrant g SET g.status = :to, g.scopes = :scopes, g.decidedBy = :by, g.decidedAt = :now "
            + "WHERE g.id = :id AND g.status IN :from")
    int transition(@Param("id") Long id, @Param("from") Collection<String> from, @Param("to") String to,
                   @Param("scopes") String scopes, @Param("by") Long by, @Param("now") Instant now);
}
