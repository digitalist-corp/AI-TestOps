package com.playops.api.dto;

import java.time.Instant;
import java.util.List;

/** 학습 루프 E-04 · E-05 · V22 응답 */
public final class FailureDtos {

    private FailureDtos() {
    }

    /**
     * 같은 서명끼리 묶은 실패. cause: 원인 5종, causeSource: RULE(규칙) · HUMAN(사람이 고침).
     * summary: 쉬운 말 한 줄, pastFixes · recalled: 같은 서명 · 로케이터의 승인된 과거 수정(상위 3건) — 루프가 예시로 쓴다.
     */
    public record Cluster(String signature, String head, String locator, String specPath, String cause, String causeSource,
                          String summary, int count, List<String> cases, String sampleError, int pastFixes,
                          List<PastFix> recalled) {}

    /** 회상한 과거 수정. diff: 바뀐 줄만 (- 이전 / + 이후) */
    public record PastFix(Long aiJobId, String specPath, String cause, String head, String locator, String diff, Instant createdAt) {}

    public record CauseRequest(String cause) {}
}
