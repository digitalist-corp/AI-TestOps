package com.playops.api.repository;

import com.playops.api.entity.ExecutionCaseResult;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface ExecutionCaseResultRepository extends JpaRepository<ExecutionCaseResult, Long> {
    List<ExecutionCaseResult> findByExecutionIdOrderByIdAsc(Long executionId);

    List<ExecutionCaseResult> findTop100BySpecPathInOrderByIdDesc(java.util.Collection<String> specPaths);

    /**
     * spec 경로마다 그 프로젝트의 마지막 실행(건너뜀 제외)에서 나온 케이스 결과만 한 번에 가져온다. (구조 탭 확인 지도)
     * 흐름마다 따로 묻지 않으려고 경로를 모아 한 쿼리로 묻는다.
     */
    @Query("""
            select r from ExecutionCaseResult r
            where r.specPath in :specPaths and r.status <> 'SKIPPED'
              and r.executionId = (
                select max(r2.executionId) from ExecutionCaseResult r2
                where r2.specPath = r.specPath and r2.status <> 'SKIPPED'
                  and r2.executionId in (select e.id from Execution e where e.projectId = :projectId))
            order by r.id
            """)
    List<ExecutionCaseResult> findLatestBySpecPaths(
            @Param("projectId") String projectId,
            @Param("specPaths") java.util.Collection<String> specPaths);

    /**
     * 한 프로젝트 안에서 케이스 이름이 맞는 결과를 최신순으로 가져온다. (채팅 도구 get_case_history)
     * 결과 표에는 project_id 가 없어서 부모 실행으로 프로젝트를 거른다.
     *
     * @param pattern 소문자로 바꾼 LIKE 패턴. 이스케이프 글자는 '!' (GetCaseHistoryTool.likePattern 이 만든다)
     */
    @Query("""
            select r from ExecutionCaseResult r
            where r.executionId in (select e.id from Execution e where e.projectId = :projectId)
              and lower(r.caseTitle) like :pattern escape '!'
            order by r.id desc
            """)
    List<ExecutionCaseResult> findRecentByProjectAndCaseTitle(
            @Param("projectId") String projectId,
            @Param("pattern") String pattern,
            Pageable pageable);
}
