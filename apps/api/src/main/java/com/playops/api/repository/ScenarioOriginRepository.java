package com.playops.api.repository;

import com.playops.api.entity.ScenarioOrigin;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface ScenarioOriginRepository extends JpaRepository<ScenarioOrigin, Long> {
    Optional<ScenarioOrigin> findByProjectIdAndSpecPath(String projectId, String specPath);

    java.util.List<ScenarioOrigin> findByProjectId(String projectId);
}
