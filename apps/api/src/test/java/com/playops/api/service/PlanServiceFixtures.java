package com.playops.api.service;

import com.playops.api.dto.PlanDtos.PlanItem;
import com.playops.api.dto.ScenarioTreeResponse;

import java.util.List;

/** 다른 패키지 테스트가 계획 항목을 만들 때 쓴다. PlanItem 생성자를 직접 부르지 않아 칸이 늘어도 그대로 돈다. */
public final class PlanServiceFixtures {

    private PlanServiceFixtures() {}

    public static List<PlanItem> flatten(ScenarioTreeResponse tree) {
        return PlanService.flatten(tree);
    }
}
