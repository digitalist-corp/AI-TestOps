package com.playops.api.config;

import com.playops.api.service.SiteAnalysisService;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/** 서버가 꺼지면서 끝나지 못한 구조 분석을 실패로 정리한다. */
@Component
public class SiteAnalysisStartupCleaner implements ApplicationRunner {

    private final SiteAnalysisService siteAnalysisService;

    public SiteAnalysisStartupCleaner(SiteAnalysisService siteAnalysisService) {
        this.siteAnalysisService = siteAnalysisService;
    }

    @Override
    public void run(ApplicationArguments args) {
        siteAnalysisService.failInterruptedRuns();
    }
}
