package com.playops.api.recorder;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;
import java.util.Map;

/** 녹화 API 의 요청 · 응답 모양. docs/design/recorder-contract.md 의 타입과 같다. */
public final class RecorderDtos {

    private RecorderDtos() {
    }

    public record CreateSessionRequest(String url, Boolean useLogin) {
    }

    public record StepsRequest(List<RecordedStep> steps) {
    }

    public record SaveRequest(String specPath, String title) {
    }

    public record CodeResponse(String specPath, String code) {
    }

    public record SaveResponse(String specPath) {
    }

    public record Viewport(int width, int height) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record RecordedStep(
            String id,
            String action,
            String selector,
            boolean fragile,
            String label,
            String value,
            String secretEnv,
            String url
    ) {
        RecordedStep withLabelAndValue(String newLabel, String newValue) {
            return new RecordedStep(id, action, selector, fragile, newLabel, newValue, secretEnv, url);
        }
    }

    /** record.js 가 돌려주는 상태. sessionId 는 api 가 채운다. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record RecorderState(
            String sessionId,
            String status,
            String url,
            String title,
            Viewport viewport,
            List<RecordedStep> steps,
            long screenshotVersion,
            String error,
            Map<String, Object> inspected
    ) {
        public static final Viewport DEFAULT_VIEWPORT = new Viewport(1280, 800);

        RecorderState with(String newSessionId, String newStatus, String newError) {
            return new RecorderState(newSessionId, newStatus, url, title,
                    viewport != null ? viewport : DEFAULT_VIEWPORT,
                    steps != null ? steps : List.of(), screenshotVersion, newError, inspected);
        }

        RecorderState withSteps(List<RecordedStep> newSteps) {
            return new RecorderState(sessionId, status, url, title, viewport, newSteps, screenshotVersion, error, inspected);
        }

        static RecorderState starting(String sessionId) {
            return new RecorderState(sessionId, "STARTING", null, null, DEFAULT_VIEWPORT, List.of(), 0, null, null);
        }
    }
}
