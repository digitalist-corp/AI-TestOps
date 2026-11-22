package com.playops.api.repository;

import com.playops.api.entity.PlanEntry;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface PlanEntryRepository extends JpaRepository<PlanEntry, Long> {
    List<PlanEntry> findByProjectIdOrderByIdAsc(String projectId);

    Optional<PlanEntry> findByIdAndProjectId(Long id, String projectId);
}
