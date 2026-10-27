package com.playops.api.repository;

import com.playops.api.entity.SiteNode;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SiteNodeRepository extends JpaRepository<SiteNode, Long> {
    List<SiteNode> findByProjectIdOrderByRouteKey(String projectId);
}
