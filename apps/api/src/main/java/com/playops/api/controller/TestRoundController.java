package com.playops.api.controller;

import com.playops.api.service.TestRoundService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** N차 테스트 목록과 한 차수의 지난번 대비 변화. */
@RestController
@RequestMapping("/api/projects/{projectId}/rounds")
public class TestRoundController {

    private final TestRoundService rounds;

    public TestRoundController(TestRoundService rounds) {
        this.rounds = rounds;
    }

    @GetMapping
    public List<TestRoundService.Round> list(@PathVariable String projectId) {
        return rounds.list(projectId);
    }

    @GetMapping("/{executionId}")
    public TestRoundService.RoundDetail detail(@PathVariable String projectId, @PathVariable Long executionId) {
        return rounds.detail(projectId, executionId);
    }
}
