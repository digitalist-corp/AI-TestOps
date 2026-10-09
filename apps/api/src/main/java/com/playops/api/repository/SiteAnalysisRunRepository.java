package com.playops.api.repository;

import com.playops.api.entity.SiteAnalysisRun;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SiteAnalysisRunRepository extends JpaRepository<SiteAnalysisRun, Long> {
    Optional<SiteAnalysisRun> findFirstByProjectIdOrderByIdDesc(String projectId);
    boolean existsByProjectIdAndStatus(String projectId, String status);
    List<SiteAnalysisRun> findByStatus(String status);
}
