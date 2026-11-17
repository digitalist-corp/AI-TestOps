package com.playops.api.service;

import com.playops.api.entity.AiJob;
import com.playops.api.entity.Project;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** 자동 적용은 사람이 요청한 작업에만, 켜져 있을 때만, 위험 표시가 없을 때만 된다. (D-03) */
class AiJobAutoApplyTest {

    private static final AiDiffRiskEvaluatorService.Assessment CLEAN =
            new AiDiffRiskEvaluatorService.Assessment(List.of(), List.of(), 3, 1);
    private static final AiDiffRiskEvaluatorService.Assessment WEAKENED =
            new AiDiffRiskEvaluatorService.Assessment(List.of("expect 삭제"), List.of(), 3, 1);

    private final Project project = new Project();
    private final AiJob job = new AiJob();

    @Test
    void autoCreatedJobNeverAutoApplies() {
        project.setAiAutoApplyEnabled(true);
        job.setAutoCreated(true);

        assertThat(AiJobService.canAutoApply(job, project, CLEAN)).isFalse();
    }

    @Test
    void userJobAutoAppliesOnlyWhenEnabledAndClean() {
        project.setAiAutoApplyEnabled(true);
        assertThat(AiJobService.canAutoApply(job, project, CLEAN)).isTrue();
        assertThat(AiJobService.canAutoApply(job, project, WEAKENED)).isFalse();

        project.setAiAutoApplyEnabled(false);
        assertThat(AiJobService.canAutoApply(job, project, CLEAN)).isFalse();
    }

    @Test
    void autoApplyIsOffByDefault() {
        assertThat(new Project().getAiAutoApplyEnabled()).isFalse();
        assertThat(new AiJob().isAutoCreated()).isFalse();
    }
}
