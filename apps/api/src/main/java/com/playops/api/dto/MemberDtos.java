package com.playops.api.dto;

import com.playops.api.entity.ProjectRole;

/** 프로젝트 멤버(#104) 요청·응답. */
public final class MemberDtos {

    private MemberDtos() {}

    public record Member(Long userId, String username, String displayName, ProjectRole role) {}

    /** 추가할 때 role 이 없으면 팀원. */
    public record MemberRequest(Long userId, ProjectRole role) {}

    public record RoleRequest(ProjectRole role) {}

    /** 멤버로 넣을 사용자를 고르는 검색 결과. 비밀번호 · 전역 역할은 싣지 않는다. */
    public record UserCandidate(Long id, String username, String displayName) {}
}
