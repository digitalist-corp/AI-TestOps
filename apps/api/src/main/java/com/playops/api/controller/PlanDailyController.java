package com.playops.api.controller;

import com.playops.api.dto.PlanDtos.DailyResponse;
import com.playops.api.service.PlanDailyService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 일자별 정기 실행 결과 격자 (F-3). days 는 1~31 로 맞춘다. */
@RestController
@RequestMapping("/api/projects/{projectId}/plan")
public class PlanDailyController {

    private final PlanDailyService dailyService;

    public PlanDailyController(PlanDailyService dailyService) {
        this.dailyService = dailyService;
    }

    @GetMapping("/daily")
    public DailyResponse daily(@PathVariable String projectId, @RequestParam(required = false) Integer days) {
        return dailyService.daily(projectId, days);
    }
}
