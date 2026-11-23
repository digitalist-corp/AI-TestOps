package com.playops.api.dto;

import java.time.Instant;
import java.util.List;

/** 코드 자동 수정 사용권 (프로젝트 · 멤버별). 실제 자동 수정 · PR 연동은 아직 없다 (integrationReady=false). */
public final class CodeAutoFixDtos {

    private CodeAutoFixDtos() {}

    /** status: PENDING · GRANTED · REJECTED · REVOKED. scopes: 부여된 범위 (대기 · 거절 · 회수면 비어 있음) */
    public record RequestView(Long id, Long userId, String userName, String status, List<String> scopes, String note,
                              Instant requestedAt, Long decidedBy, Instant decidedAt) {}

    /**
     * role: ADMIN · PM · MEMBER. scopes: 지금 쓸 수 있는 범위 (관리자 · PM 은 전부, 팀원은 부여받은 것).
     * request: 내 요청 (팀원, 지금 멤버십에서 한 것만). integrationReady: 자동 수정 실행 · PR 연동이 준비됐는지 — 이번 단계는 false.
     */
    public record Mine(String role, List<String> scopes, boolean canManage, RequestView request, boolean integrationReady) {}

    public record AccessRequest(String note) {}

    public record GrantRequest(List<String> scopes) {}
}
