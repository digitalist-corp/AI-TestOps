package com.playops.api.controller;

import com.playops.api.dto.DefectDtos.DefectResponse;
import com.playops.api.service.DefectService;
import org.springframework.web.bind.annotation.*;

/** 통합 결함 리스트(F-4). 조회라 팀원도 볼 수 있다. */
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
}
