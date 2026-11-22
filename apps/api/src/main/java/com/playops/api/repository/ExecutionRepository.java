package com.playops.api.repository;

import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface ExecutionRepository extends JpaRepository<Execution, Long> {
    List<Execution> findByProjectIdOrderByCreatedAtDesc(String projectId);

    Optional<Execution> findFirstByProjectIdOrderByCreatedAtDesc(String projectId);

    /** 채팅 도구(search_logs)가 최근 실행 몇 개만 볼 때 쓴다. 전체를 읽으면 실행마다 붙은 긴 로그까지 따라온다. */
    List<Execution> findTop5ByProjectIdOrderByCreatedAtDesc(String projectId);

    List<Execution> findByProjectIdAndGrepFilterInOrderByCreatedAtDesc(String projectId, Collection<String> grepFilters);

    boolean existsByProjectIdAndStatusIn(String projectId, Collection<ExecutionStatus> statuses);

    List<Execution> findByStatusIn(Collection<ExecutionStatus> statuses);

    /** 실행 소요시간 예상치(ETA) 계산용 — 최근 완료된 실행들의 durationMs만 있으면 된다. */
    List<Execution> findTop20ByDurationMsIsNotNullOrderByCreatedAtDesc();

    void deleteByProjectId(String projectId);

    /** 정기 실행이 한 번이라도 있었는지 (시연 정기 실행 기록 시드가 이미 넣었는지 · 진짜 기록이 있는지 본다) */
    @Query("""
            select count(e) > 0 from Execution e
            where e.projectId = :projectId and (e.scheduleId is not null or e.source = 'SCHEDULED')
            """)
    boolean existsScheduled(@Param("projectId") String projectId);
}
