package com.playops.api.dto;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.entity.AiJob;
import com.playops.api.entity.AiJobStatus;
import com.playops.api.entity.AiJobType;
import com.playops.api.entity.AiModelProvider;
import com.playops.api.entity.PostApplyVerificationStatus;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public record AiJobResponse(
        Long id,
        String projectId,
        AiJobType jobType,
        AiJobStatus status,
        AiModelProvider aiModelProvider,
        String instruction,
        String targetSpecPath,
        List<String> changedFiles,
        Long failedExecutionId,
        Integer iterationsUsed,
        String summary,
        String errorMessage,
        String riskFlags,
        PostApplyVerificationStatus postApplyVerificationStatus,
        Instant revertedAt,
        String appliedCommitSha,
        Long requestedBy,
        Long reviewedBy,
        String rejectionReason,
        Long version,
        Long parentJobId,
        /** 실패에서 자동으로 만든 제안(FixProposalService) · 학습 루프가 띄운 수정이면 true */
        boolean autoCreated,
        Instant createdAt,
        Instant updatedAt
) {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static AiJobResponse from(AiJob job) {
        return new AiJobResponse(
                job.getId(),
                job.getProjectId(),
                job.getJobType(),
                job.getStatus(),
                job.getAiModelProvider(),
                job.getInstruction(),
                job.getTargetSpecPath(),
                parseChangedFiles(job),
                job.getFailedExecutionId(),
                job.getIterationsUsed(),
                job.getSummary(),
                job.getErrorMessage(),
                job.getRiskFlags(),
                job.getPostApplyVerificationStatus(),
                job.getRevertedAt(),
                job.getAppliedCommitSha(),
                job.getRequestedBy(),
                job.getReviewedBy(),
                job.getRejectionReason(),
                job.getVersion(),
                job.getParentJobId(),
                job.isAutoCreated(),
                job.getCreatedAt(),
                job.getUpdatedAt()
        );
    }

    private static List<String> parseChangedFiles(AiJob job) {
        List<String> files = new ArrayList<>();
        if (job.getChangedFiles() == null || job.getChangedFiles().isBlank()) {
            return files;
        }
        try {
            MAPPER.readTree(job.getChangedFiles()).forEach(node -> files.add(node.asText()));
        } catch (Exception ignored) {}
        return files;
    }
}
