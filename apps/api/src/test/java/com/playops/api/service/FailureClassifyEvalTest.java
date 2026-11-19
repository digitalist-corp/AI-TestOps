package com.playops.api.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** E-05: 원인을 아는 실패 20건(docs/eval/failure-classify.json)으로 분류 정확도를 잰다. */
class FailureClassifyEvalTest {

    private static final Path EVAL = Path.of("../../docs/eval/failure-classify.json");

    @Test
    void accuracyIsAtLeastSeventyPercent() throws Exception {
        Assumptions.assumeTrue(Files.exists(EVAL), "저장소 루트를 마운트해야 평가셋이 보입니다 (docs/eval/README.md)");
        JsonNode cases = new ObjectMapper().readTree(EVAL.toFile());
        List<String> misses = new ArrayList<>();
        for (JsonNode c : cases) {
            List<String> history = new ArrayList<>();
            c.path("history").forEach(h -> history.add(h.asText()));
            FailureRules.Cause got = FailureRules.classify(c.path("error").asText(), history);
            if (!got.name().equals(c.path("expected").asText())) {
                misses.add(c.path("id").asText() + " 기대 " + c.path("expected").asText() + " · 결과 " + got);
            }
        }
        double accuracy = (cases.size() - misses.size()) / (double) cases.size();
        System.out.printf("eval failure-classify: %d/%d = %.0f%%, 틀림 %s%n",
                cases.size() - misses.size(), cases.size(), accuracy * 100, misses);
        assertThat(cases.size()).isEqualTo(20);
        assertThat(accuracy).isGreaterThanOrEqualTo(0.70);
    }
}
