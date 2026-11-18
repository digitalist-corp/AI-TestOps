package com.playops.api.controller;

import com.playops.api.dto.DefectDtos.DefectResponse;
import com.playops.api.dto.DefectDtos.RerunRequest;
import com.playops.api.dto.ExecutionResponse;
import com.playops.api.service.DefectService;
import org.springframework.web.bind.annotation.*;

/** 통합 결함 리스트(F-4). 조회 · 다시 실행은 팀원도 할 수 있다 (다시 실행은 ProjectAccessInterceptor.MEMBER_WRITES). */
@RestController
@RequestMapping("/api/projects/{projectId}/defects")
public class DefectController {

    private final DefectService defectService;

    public DefectController(DefectService defectService) {
        this.defectService = defectService;
    }

    @GetMapping
    public DefectResponse list(@PathVariable String projectId,
                               @RequestParam(required = false) String status,
                               @RequestParam(required = false) Long assigneeUserId,
                               @RequestParam(required = false) Long suiteId,
                               @RequestParam(required = false) String screen) {
        return defectService.list(projectId, status, assigneeUserId, suiteId, screen);
    }

    /** 고른 결함(없으면 미해결 전부)을 다시 실행하고, 새 실행을 원래 실행에 잇는다 (#82). */
    @PostMapping("/rerun")
    public ExecutionResponse rerun(@PathVariable String projectId, @RequestBody(required = false) RerunRequest request) {
        return defectService.rerun(projectId, request == null ? null : request.items());
    }
}
