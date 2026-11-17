package com.playops.api.repository;

import com.playops.api.entity.AiJob;
import com.playops.api.entity.AiJobStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AiJobRepository extends JpaRepository<AiJob, Long> {
    List<AiJob> findByProjectIdOrderByCreatedAtDesc(String projectId);

    List<AiJob> findByStatusOrderByCreatedAtAsc(AiJobStatus status);

    Optional<AiJob> findByIdAndCallbackToken(Long id, String callbackToken);

    /** 같은 spec 에 열린 작업이 있는지 (수정 제안 중복 검사) */
    boolean existsByProjectIdAndTargetSpecPathAndStatusIn(String projectId, String targetSpecPath, java.util.Collection<AiJobStatus> statuses);

    /** 자동으로 만든(요청자 없는) 작업 수 (수정 제안 하루 상한) */
    long countByProjectIdAndAutoCreatedTrueAndCreatedAtAfter(String projectId, java.time.Instant after);
}
