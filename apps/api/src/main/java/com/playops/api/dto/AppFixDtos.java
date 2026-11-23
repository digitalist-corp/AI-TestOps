package com.playops.api.dto;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.entity.AppFixProposal;

import java.time.Instant;
import java.util.List;

/** 제품 코드 수정안 1단계 (결함 상세의 "AI 수정 제안 보기"). 읽기 전용이라 원격 저장소에는 쓰지 않는다. */
public final class AppFixDtos {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private AppFixDtos() {}

    public record FileDiff(String path, String diff) {}

    /**
     * status: ANALYZING · DIFF_READY · DIAGNOSIS_ONLY · FAILED.
     * verification: DIFF_APPLIES(서버가 기준 원본에 적용해 봄, 재현 테스트는 미실행) · 진단만이면 null.
     * sourceSha: 실제로 읽은 커밋. 배포 버전과 대조하지 않았다 (1단계).
     */
    public record Proposal(Long id, String status, String category, Long executionId,
                           String sourceRepository, String sourceBranch, String sourceSha, String appRoot,
                           String verification, String evidence, String summary, List<String> causes, List<String> checks,
                           List<FileDiff> files, String limitation, String errorMessage, Long requestedBy,
                           Instant createdAt, Instant updatedAt) {

        public static Proposal from(AppFixProposal p) {
            return new Proposal(p.getId(), p.getStatus(), p.getCategory(), p.getExecutionId(),
                    p.getSourceRepository(), p.getSourceBranch(), p.getSourceSha(), p.getAppRoot(),
                    p.getVerification(), p.getEvidence(), p.getSummary(),
                    read(p.getCauses(), new TypeReference<List<String>>() {}),
                    read(p.getChecks(), new TypeReference<List<String>>() {}),
                    read(p.getFiles(), new TypeReference<List<FileDiff>>() {}),
                    p.getLimitation(), p.getErrorMessage(), p.getRequestedBy(), p.getCreatedAt(), p.getUpdatedAt());
        }

        private static <T> List<T> read(String json, TypeReference<List<T>> type) {
            try {
                return json == null || json.isBlank() ? List.of() : MAPPER.readValue(json, type);
            } catch (Exception e) {
                return List.of();
            }
        }
    }

    /**
     * category: 서버 분류 (APP_CODE · APP_API 만 후보). stale: 최근 수정안이 지금 결함의 마지막 실패 실행이 아닌 이전 실행 기준.
     * proposal: 이 결함의 가장 최근 수정안, 없으면 null.
     */
    public record View(String category, Long latestFailedExecutionId, boolean stale, Proposal proposal) {}

    /** executionId 를 비우면 결함의 마지막 실패 실행 */
    public record Request(String specPath, String grep, Long executionId) {}
}
