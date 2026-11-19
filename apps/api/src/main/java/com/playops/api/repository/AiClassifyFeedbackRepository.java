package com.playops.api.repository;

import com.playops.api.entity.AiClassifyFeedback;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface AiClassifyFeedbackRepository extends JpaRepository<AiClassifyFeedback, Long> {
    Optional<AiClassifyFeedback> findByProjectIdAndSignature(String projectId, String signature);

    List<AiClassifyFeedback> findByProjectIdAndSignatureIn(String projectId, Collection<String> signatures);
}
