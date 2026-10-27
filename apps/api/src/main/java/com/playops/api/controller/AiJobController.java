package com.playops.api.controller;

import com.playops.api.dto.AiJobFileDiff;
import com.playops.api.dto.AiJobResponse;
import com.playops.api.dto.CreateAiJobRequest;
import com.playops.api.dto.CreateTemplateGenerateJobRequest;
import com.playops.api.entity.AiJob;
import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.exception.ApiException;
import com.playops.api.service.AiJobService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
public class AiJobController {

    private final AiJobService aiJobService;

    public AiJobController(AiJobService aiJobService) {
        this.aiJobService = aiJobService;
    }

    @PostMapping("/api/projects/{projectId}/ai-jobs")
    public AiJobResponse create(
            @PathVariable String projectId,
            @RequestBody CreateAiJobRequest body,
            HttpServletRequest request
    ) {
        User user = currentUser(request);
        AiJob job = aiJobService.createCodeFixJob(
                projectId,
                body.getFailedExecutionId(),
                body.getTargetSpecPath(),
                body.getInstruction(),
                user != null ? user.getId() : null
        );
        return AiJobResponse.from(job);
    }

    @PostMapping("/api/projects/{projectId}/ai-jobs/template-generate")
    public AiJobResponse createTemplateGenerate(
            @PathVariable String projectId,
            @RequestBody CreateTemplateGenerateJobRequest body,
            HttpServletRequest request
    ) {
        User user = currentUser(request);
        AiJob job = aiJobService.createTemplateGenerateJob(
                projectId,
                body.getTargetSpecPath(),
                body.getInstruction(),
                body.getRouteKeys(),
                user != null ? user.getId() : null
        );
        return AiJobResponse.from(job);
    }

    @GetMapping("/api/projects/{projectId}/ai-jobs")
    public List<AiJobResponse> listByProject(@PathVariable String projectId) {
        return aiJobService.listByProject(projectId).stream().map(AiJobResponse::from).toList();
    }

    @GetMapping("/api/ai-jobs/needs-review")
    public List<AiJobResponse> needsReview(HttpServletRequest request) {
        requireAdmin(request);
        return aiJobService.listNeedsReview().stream().map(AiJobResponse::from).toList();
    }

    /**
     * 작업 한 건의 현재 상태.
     *
     * 채팅 패널의 작업 카드가 이걸 주기적으로 읽어 "검토 대기 → 적용됨"까지 따라간다.
     * 승인이 아니라 조회이므로 관리자 권한까지는 요구하지 않는다 —
     * 자기가 요청한 작업이 지금 어디까지 갔는지는 누구나 볼 수 있어야 한다.
     */
    @GetMapping("/api/ai-jobs/{id}")
    public AiJobResponse get(@PathVariable Long id) {
        return AiJobResponse.from(aiJobService.getJob(id));
    }

    @GetMapping("/api/ai-jobs/{id}/diff")
    public List<AiJobFileDiff> diff(@PathVariable Long id, HttpServletRequest request) {
        requireAdmin(request);
        return aiJobService.readChangedFileContents(id);
    }

    @PostMapping("/api/ai-jobs/{id}/approve")
    public AiJobResponse approve(
            @PathVariable Long id,
            @RequestBody(required = false) ApproveAiJobRequest body,
            HttpServletRequest request
    ) {
        User user = requireAuthenticated(request);
        Long expectedVersion = body != null ? body.expectedVersion() : null;
        Boolean riskAcknowledged = body != null ? body.riskAcknowledged() : null;
        return AiJobResponse.from(aiJobService.approve(
                id,
                user.getId(),
                user.getRole(),
                expectedVersion,
                riskAcknowledged
        ));
    }

    @PostMapping("/api/ai-jobs/{id}/reject")
    public AiJobResponse reject(
            @PathVariable Long id,
            @RequestBody(required = false) RejectAiJobRequest body,
            HttpServletRequest request
    ) {
        User user = requireAuthenticated(request);
        String reason = body != null ? body.reason() : null;
        return AiJobResponse.from(aiJobService.reject(id, user.getId(), reason));
    }

    public record ApproveAiJobRequest(Long expectedVersion, String baseCommitSha, Boolean riskAcknowledged) {}
    public record RejectAiJobRequest(String reason) {}

    private User currentUser(HttpServletRequest request) {
        return (User) request.getAttribute("currentUser");
    }

    private User requireAuthenticated(HttpServletRequest request) {
        User user = currentUser(request);
        if (user == null) {
            throw new ApiException(401, "UNAUTHENTICATED", "Authentication required");
        }
        return user;
    }

    private User requireAdmin(HttpServletRequest request) {
        User user = currentUser(request);
        if (user == null || user.getRole() != UserRole.ADMIN) {
            throw new ApiException(403, "Admin access required");
        }
        return user;
    }
}
