package com.playops.api.config;

import com.playops.api.service.SiteAnalysisService;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.time.Instant;

/** 서버가 꺼지면서 끝나지 못한 구조 분석을 실패로 정리한다. */
@Component
public class SiteAnalysisStartupCleaner implements ApplicationRunner {

    private final SiteAnalysisService siteAnalysisService;
    /** 이번 기동 시각 — 요청을 받기 시작한 뒤 새로 시작한 분석은 건드리지 않는다 (#137) */
    private final Instant bootedAt = Instant.now();

    public SiteAnalysisStartupCleaner(SiteAnalysisService siteAnalysisService) {
        this.siteAnalysisService = siteAnalysisService;
    }

    @Override
    public void run(ApplicationArguments args) {
        siteAnalysisService.failInterruptedRuns(bootedAt);
    }
}
