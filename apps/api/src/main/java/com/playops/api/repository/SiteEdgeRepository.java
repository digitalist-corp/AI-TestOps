package com.playops.api.repository;

import com.playops.api.entity.SiteEdge;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SiteEdgeRepository extends JpaRepository<SiteEdge, Long> {
    List<SiteEdge> findByProjectId(String projectId);
    void deleteByProjectId(String projectId);
}
