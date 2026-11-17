package com.playops.api.repository;

import com.playops.api.entity.ProjectMember;
import com.playops.api.entity.ProjectRole;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ProjectMemberRepository extends JpaRepository<ProjectMember, ProjectMember.Key> {
    Optional<ProjectMember> findByProjectIdAndUserId(String projectId, Long userId);

    List<ProjectMember> findByProjectId(String projectId);

    List<ProjectMember> findByUserId(Long userId);

    boolean existsByProjectIdAndRole(String projectId, ProjectRole role);
}
