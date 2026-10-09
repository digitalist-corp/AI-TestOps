package com.playops.api.controller;

import com.playops.api.entity.SiteAnalysisRun;
import com.playops.api.service.SiteAnalysisService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 저장소 코드 분석으로 만든 화면 구조(사이트 맵). */
@RestController
@RequestMapping("/api/projects/{projectId}/sitemap")
public class SiteMapController {

    private final SiteAnalysisService siteAnalysisService;

    public SiteMapController(SiteAnalysisService siteAnalysisService) {
        this.siteAnalysisService = siteAnalysisService;
    }

    @GetMapping
    public SiteAnalysisService.SiteMap get(@PathVariable String projectId) {
        return siteAnalysisService.view(projectId);
    }

    @PutMapping("/source")
    public SiteAnalysisService.SiteMap updateSource(@PathVariable String projectId,
                                                    @RequestBody SiteAnalysisService.SourceRequest request) {
        siteAnalysisService.updateSource(projectId, request);
        return siteAnalysisService.view(projectId);
    }

    /** 화면 경로에 / 가 들어 있어 경로 변수 대신 쿼리로 받는다. */
    @GetMapping("/node")
    public SiteAnalysisService.NodeDetail getNode(@PathVariable String projectId, @RequestParam String route) {
        return siteAnalysisService.viewNode(projectId, route);
    }

    @PatchMapping("/node")
    public SiteAnalysisService.NodeDetail editNode(@PathVariable String projectId, @RequestParam String route,
                                                   @RequestBody SiteAnalysisService.NodeEditRequest request) {
        return siteAnalysisService.editNode(projectId, route, request);
    }

    /** 분석을 시작하고 바로 돌아온다. 진행 상황은 GET 으로 확인한다. */
    @PostMapping("/analyze")
    public SiteAnalysisService.SiteMap analyze(@PathVariable String projectId) {
        SiteAnalysisRun run = siteAnalysisService.start(projectId);
        siteAnalysisService.runAsync(run.getId());
        return siteAnalysisService.view(projectId);
    }
}
