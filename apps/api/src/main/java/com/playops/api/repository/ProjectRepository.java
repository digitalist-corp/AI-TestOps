package com.playops.api.repository;

import com.playops.api.entity.Project;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface ProjectRepository extends JpaRepository<Project, String> {
    boolean existsByProjectId(String projectId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Project p where p.projectId = :projectId")
    Optional<Project> findByProjectIdForUpdate(@Param("projectId") String projectId);
}
