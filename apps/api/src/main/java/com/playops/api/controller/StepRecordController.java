package com.playops.api.controller;

import com.playops.api.service.StepRecordService;
import com.playops.api.service.StepRecordService.StepsResponse;
import org.springframework.web.bind.annotation.*;

/** 케이스별 단계 목록(V-2, #84). 조회라 팀원도 볼 수 있다. */
@RestController
@RequestMapping("/api/projects/{projectId}/executions/{executionId}/steps")
public class StepRecordController {

    private final StepRecordService stepRecordService;

    public StepRecordController(StepRecordService stepRecordService) {
        this.stepRecordService = stepRecordService;
    }

    @GetMapping
    public StepsResponse steps(@PathVariable String projectId, @PathVariable Long executionId) {
        return stepRecordService.steps(projectId, executionId);
    }
}
