package com.playops.api.controller;

import com.playops.api.dto.PlanDtos.BulkEnabledRequest;
import com.playops.api.dto.PlanDtos.ItemPatch;
import com.playops.api.dto.PlanDtos.OrderRequest;
import com.playops.api.dto.PlanDtos.PlanResponse;
import com.playops.api.service.PlanService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

/** 테스트 계획 표(F-1). */
@RestController
@RequestMapping("/api/projects/{projectId}/plan")
public class PlanController {

    private final PlanService planService;

    public PlanController(PlanService planService) {
        this.planService = planService;
    }

    @GetMapping
    public PlanResponse get(@PathVariable String projectId) {
        return planService.get(projectId);
    }

    @PatchMapping("/items")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void patch(@PathVariable String projectId, @RequestBody ItemPatch patch) {
        planService.patch(projectId, patch);
    }

    @PutMapping("/order")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void reorder(@PathVariable String projectId, @RequestBody OrderRequest request) {
        planService.reorder(projectId, request.items());
    }

    @PatchMapping("/items/enabled")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void setEnabled(@PathVariable String projectId, @RequestBody BulkEnabledRequest request) {
        planService.setEnabled(projectId, request.items(), request.enabled());
    }
}
