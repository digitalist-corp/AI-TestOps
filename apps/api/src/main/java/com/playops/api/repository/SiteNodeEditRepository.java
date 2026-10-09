package com.playops.api.repository;

import com.playops.api.entity.SiteNodeEdit;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SiteNodeEditRepository extends JpaRepository<SiteNodeEdit, Long> {
    List<SiteNodeEdit> findByProjectId(String projectId);
}
