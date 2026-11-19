package com.playops.api.repository;

import com.playops.api.entity.AiFixMemory;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AiFixMemoryRepository extends JpaRepository<AiFixMemory, Long> {
    List<AiFixMemory> findByProjectIdOrderByIdDesc(String projectId);

    boolean existsByAiJobId(Long aiJobId);

    void deleteByAiJobId(Long aiJobId);
}
