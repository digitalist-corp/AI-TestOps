package com.playops.api.controller;

import com.playops.api.dto.FailureDtos.CauseRequest;
import com.playops.api.dto.FailureDtos.Cluster;
import com.playops.api.entity.User;
import com.playops.api.service.FailureService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** 학습 루프: 실패 묶음 · 원인(E-04 · E-05)과 사람이 고친 원인(V22). 조회는 멤버, 원인 고치기는 PM (ProjectAccessInterceptor) */
@RestController
@RequestMapping("/api/projects/{projectId}")
public class FailureController {

    private final FailureService failureService;

    public FailureController(FailureService failureService) {
        this.failureService = failureService;
    }

    @GetMapping("/executions/{executionId}/failure-clusters")
    public List<Cluster> clusters(@PathVariable String projectId, @PathVariable Long executionId) {
        return failureService.clusters(projectId, executionId);
    }

    @PutMapping("/failure-causes/{signature}")
    public ResponseEntity<Void> setCause(@PathVariable String projectId, @PathVariable String signature,
                                         @RequestBody CauseRequest request, HttpServletRequest servletRequest) {
        User user = (User) servletRequest.getAttribute("currentUser");
        failureService.setCause(projectId, signature, request == null ? null : request.cause(), user == null ? null : user.getId());
        return ResponseEntity.noContent().build();
    }
}
