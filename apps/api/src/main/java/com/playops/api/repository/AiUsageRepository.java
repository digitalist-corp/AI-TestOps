package com.playops.api.repository;

import com.playops.api.entity.AiUsage;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;

public interface AiUsageRepository extends JpaRepository<AiUsage, Long> {

    List<AiUsage> findByCreatedAtAfter(Instant from);
}
