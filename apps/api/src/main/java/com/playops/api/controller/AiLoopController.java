package com.playops.api.controller;

import com.playops.api.dto.AiJobResponse;
import com.playops.api.entity.User;
import com.playops.api.service.AiLoopService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/** 학습 루프(E-06 ~ E-09). 켜짐 여부는 로그인한 누구나, 시작은 PM 이상(ProjectAccessInterceptor 기본 쓰기 규칙) */
@RestController
public class AiLoopController {

    private final AiLoopService aiLoopService;

    public AiLoopController(AiLoopService aiLoopService) {
        this.aiLoopService = aiLoopService;
    }

    @GetMapping("/api/ai-loop/status")
    public Map<String, Boolean> status() {
        return Map.of("available", aiLoopService.available());
    }

    @PostMapping("/api/projects/{projectId}/executions/{executionId}/ai-loop")
    public AiJobResponse start(@PathVariable String projectId, @PathVariable Long executionId, HttpServletRequest request) {
        User user = (User) request.getAttribute("currentUser");
        return AiJobResponse.from(aiLoopService.start(projectId, executionId, user == null ? null : user.getId()));
    }
}
