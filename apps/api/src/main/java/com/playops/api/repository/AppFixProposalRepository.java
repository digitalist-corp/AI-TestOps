package com.playops.api.repository;

import com.playops.api.entity.AppFixProposal;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;

public interface AppFixProposalRepository extends JpaRepository<AppFixProposal, Long> {
    Optional<AppFixProposal> findByIdentityKey(String identityKey);

    Optional<AppFixProposal> findFirstByProjectIdAndSpecPathAndGrepOrderByIdDesc(String projectId, String specPath, String grep);

    /**
     * 다시 분석할 차례를 한 요청만 얻는다: 실패한 분석, 또는 AI 를 돌리지 못한 진단(요약 없음 — 키가 없었다) → ANALYZING.
     * 결과 칸은 비우고 한계 문구는 요청 때 기준(limitation)으로 되돌린다. 바뀐 행 수가 1 이면 내 차례
     */
    @Transactional
    @Modifying(clearAutomatically = true)
    @Query("UPDATE AppFixProposal p SET p.status = 'ANALYZING', p.errorMessage = NULL, p.requestedBy = :userId, p.updatedAt = :now, "
            + "p.limitation = :limitation, p.summary = NULL, p.causes = NULL, p.checks = NULL, p.files = NULL, p.verification = NULL "
            + "WHERE p.id = :id AND (p.status = 'FAILED' OR (p.status = 'DIAGNOSIS_ONLY' AND p.summary IS NULL))")
    int retry(@Param("id") Long id, @Param("userId") Long userId, @Param("limitation") String limitation,
              @Param("now") Instant now);

    /** 서버가 꺼지며 끝나지 못한 분석(기동 전부터 분석 중)을 실패로 돌린다. 다시 요청하면 retry 로 한 번만 분석한다 */
    @Transactional
    @Modifying(clearAutomatically = true)
    @Query("UPDATE AppFixProposal p SET p.status = 'FAILED', p.errorMessage = :message, p.updatedAt = :now "
            + "WHERE p.status = 'ANALYZING' AND p.updatedAt < :bootedAt")
    int failInterrupted(@Param("bootedAt") Instant bootedAt, @Param("message") String message, @Param("now") Instant now);
}
