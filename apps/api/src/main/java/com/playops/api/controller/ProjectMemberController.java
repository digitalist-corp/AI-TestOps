package com.playops.api.controller;

import com.playops.api.dto.MemberDtos.Member;
import com.playops.api.dto.MemberDtos.MemberRequest;
import com.playops.api.dto.MemberDtos.RoleRequest;
import com.playops.api.dto.MemberDtos.UserCandidate;
import com.playops.api.entity.User;
import com.playops.api.exception.ApiException;
import com.playops.api.service.ProjectMemberService;
import com.playops.api.service.ProjectService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** 프로젝트 설정의 "팀원" 탭 (#104). 누가 무엇을 할 수 있는지는 ProjectMemberService 가 판단한다. */
@RestController
@RequestMapping("/api/projects/{projectId}/members")
public class ProjectMemberController {

    private final ProjectMemberService memberService;
    private final ProjectService projectService;

    public ProjectMemberController(ProjectMemberService memberService, ProjectService projectService) {
        this.memberService = memberService;
        this.projectService = projectService;
    }

    @GetMapping
    public List<Member> list(@PathVariable String projectId) {
        projectService.getProject(projectId);
        return memberService.list(projectId);
    }

    /** 멤버로 넣을 사용자 검색 (아이디 · 이름) */
    @GetMapping("/candidates")
    public List<UserCandidate> candidates(@PathVariable String projectId, @RequestParam(defaultValue = "") String q,
                                          HttpServletRequest request) {
        return memberService.search(projectId, q, currentUser(request));
    }

    @PostMapping
    public Member add(@PathVariable String projectId, @RequestBody MemberRequest body, HttpServletRequest request) {
        projectService.getProject(projectId);
        if (body == null || body.userId() == null) {
            throw new ApiException(400, "VALIDATION_ERROR", "추가할 사용자를 고르세요.");
        }
        return memberService.add(projectId, body.userId(), body.role(), currentUser(request));
    }

    @PatchMapping("/{userId}")
    public void changeRole(@PathVariable String projectId, @PathVariable Long userId, @RequestBody RoleRequest body,
                           HttpServletRequest request) {
        memberService.changeRole(projectId, userId, body != null ? body.role() : null, currentUser(request));
    }

    @DeleteMapping("/{userId}")
    public void remove(@PathVariable String projectId, @PathVariable Long userId, HttpServletRequest request) {
        memberService.remove(projectId, userId, currentUser(request));
    }

    private static User currentUser(HttpServletRequest request) {
        return (User) request.getAttribute("currentUser");
    }
}
