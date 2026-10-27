package com.playops.api.controller;

import com.playops.api.service.SiteAnalysisService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 프로젝트를 가리지 않고 지금 돌고 있는 구조 분석. 프로젝트 목록과 상단의 진행 배지가 쓴다. */
@RestController
@RequestMapping("/api/sitemap")
public class SiteMapStatusController {

    private final SiteAnalysisService siteAnalysisService;

    public SiteMapStatusController(SiteAnalysisService siteAnalysisService) {
        this.siteAnalysisService = siteAnalysisService;
    }

    @GetMapping("/running")
    public List<SiteAnalysisService.Running> running() {
        return siteAnalysisService.running();
    }
}
