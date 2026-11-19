package com.playops.api.chat.tools;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.chat.ChatTool;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolTier;
import com.playops.api.dto.FailureDtos.Cluster;
import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolSpec;
import com.playops.api.service.FailureService;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * 학습 루프(E-04 · E-05 · E-06)가 읽는 실패 묶음: 서명 · 원인 · 쉬운 말 · 승인된 과거 수정(상위 3건). JSON 으로 돌려준다.
 * 실행이 그 프로젝트 것이 아니면 거절한다 (#158).
 */
@Component
public class ListFailureClustersTool implements ChatTool {

    private final FailureService failureService;
    private final ObjectMapper json;

    public ListFailureClustersTool(FailureService failureService, ObjectMapper json) {
        this.failureService = failureService;
        this.json = json;
    }

    @Override
    public LlmToolSpec spec() {
        return new LlmToolSpec(
                "list_failure_clusters",
                "실행 하나의 실패를 같은 원인끼리 묶어 원인(제품 결함 · 스크립트 오류 · 환경 · 불안정 · 미분류)과 비슷한 과거 수정을 본다.",
                LlmToolSpec.schema(CoreToolSupport.withProjectId(Map.of("executionId", LlmToolSpec.integer("실행 ID"))), "executionId"));
    }

    @Override
    public ToolTier tier() {
        return ToolTier.READ;
    }

    @Override
    public ChatToolOutput execute(LlmToolCall call, ChatToolContext context) {
        long executionId = call.argLong("executionId", -1);
        if (executionId < 0) return ChatToolOutput.failed("executionId 인자가 필요합니다.");
        try {
            List<Cluster> clusters = failureService.clusters(context.projectIdFor(call), executionId);
            return ChatToolOutput.ok(json.writeValueAsString(clusters), clusters.size() + "묶음");
        } catch (ApiException e) {
            return ChatToolOutput.failed(e.getMessage());
        } catch (JsonProcessingException e) {
            return ChatToolOutput.failed("결과를 만들지 못했습니다.");
        }
    }
}
