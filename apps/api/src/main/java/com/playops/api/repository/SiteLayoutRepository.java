package com.playops.api.repository;

import com.playops.api.entity.SiteLayout;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SiteLayoutRepository extends JpaRepository<SiteLayout, Long> {
    List<SiteLayout> findByProjectId(String projectId);
}
