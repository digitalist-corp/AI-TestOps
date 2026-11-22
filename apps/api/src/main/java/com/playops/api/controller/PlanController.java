package com.playops.api.controller;

import com.playops.api.dto.AiJobResponse;
import com.playops.api.dto.PlanDtos.BulkCreated;
import com.playops.api.dto.PlanDtos.BulkEnabledRequest;
import com.playops.api.dto.PlanDtos.BulkEntriesRequest;
import com.playops.api.dto.PlanDtos.EntryPatch;
import com.playops.api.dto.PlanDtos.EntryRequest;
import com.playops.api.dto.PlanDtos.GenerateRequest;
import com.playops.api.dto.PlanDtos.GenerateResponse;
import com.playops.api.dto.PlanDtos.ItemPatch;
import com.playops.api.dto.PlanDtos.LinkRequest;
import com.playops.api.dto.PlanDtos.OrderRequest;
import com.playops.api.dto.PlanDtos.PlanItem;
import com.playops.api.dto.PlanDtos.PlanResponse;
import com.playops.api.dto.PlanDtos.SuggestionsResponse;
import com.playops.api.entity.User;
import com.playops.api.service.PlanEntryService;
import com.playops.api.service.PlanService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

/** 테스트 계획 표(F-1). 쓰기는 PM 이상 (ProjectAccessInterceptor). */
@RestController
@RequestMapping("/api/projects/{projectId}/plan")
public class PlanController {

    private final PlanService planService;
    private final PlanEntryService entryService;

    public PlanController(PlanService planService, PlanEntryService entryService) {
        this.planService = planService;
        this.entryService = entryService;
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

    // ── 계획 행 (계획 우선 흐름) ──

    @PostMapping("/entries")
    public PlanItem create(@PathVariable String projectId, @RequestBody EntryRequest request) {
        return entryService.create(projectId, request);
    }

    @PostMapping("/entries/bulk")
    public BulkCreated createAll(@PathVariable String projectId, @RequestBody BulkEntriesRequest request) {
        return new BulkCreated(entryService.createAll(projectId, request.entries()));
    }

    @PatchMapping("/entries/{planId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void update(@PathVariable String projectId, @PathVariable Long planId, @RequestBody EntryPatch patch) {
        entryService.update(projectId, planId, patch);
    }

    @DeleteMapping("/entries/{planId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String projectId, @PathVariable Long planId) {
        entryService.delete(projectId, planId);
    }

    @PutMapping("/entries/{planId}/link")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void link(@PathVariable String projectId, @PathVariable Long planId, @RequestBody LinkRequest request) {
        entryService.link(projectId, planId, request.specPath(), request.grep());
    }

    @DeleteMapping("/entries/{planId}/link")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unlink(@PathVariable String projectId, @PathVariable Long planId) {
        entryService.unlink(projectId, planId);
    }

    @PostMapping("/entries/{planId}/generate")
    public AiJobResponse generate(@PathVariable String projectId, @PathVariable Long planId, HttpServletRequest http) {
        return entryService.generate(projectId, planId, userId(http));
    }

    @PostMapping("/entries/generate")
    public GenerateResponse generateAll(@PathVariable String projectId, @RequestBody GenerateRequest request,
                                        HttpServletRequest http) {
        return new GenerateResponse(entryService.generateAll(projectId, request.planIds(), userId(http)));
    }

    @PostMapping("/link-suggestions")
    public SuggestionsResponse suggestions(@PathVariable String projectId) {
        return new SuggestionsResponse(entryService.suggest(projectId));
    }

    private static Long userId(HttpServletRequest request) {
        User user = (User) request.getAttribute("currentUser");
        return user != null ? user.getId() : null;
    }
}
