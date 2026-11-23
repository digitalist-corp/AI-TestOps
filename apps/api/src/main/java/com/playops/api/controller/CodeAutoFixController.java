package com.playops.api.controller;

import com.playops.api.dto.CodeAutoFixDtos.AccessRequest;
import com.playops.api.dto.CodeAutoFixDtos.GrantRequest;
import com.playops.api.dto.CodeAutoFixDtos.Mine;
import com.playops.api.dto.CodeAutoFixDtos.RequestView;
import com.playops.api.entity.User;
import com.playops.api.service.CodeAutoFixAccessService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 프로젝트의 "코드 자동 수정" 사용권. 팀원은 본인 요청(ProjectAccessInterceptor.MEMBER_WRITES), 목록 · 부여 · 거절 · 회수는 PM · 관리자.
 * 역할은 서비스가 요청마다 DB 에서 다시 확인한다. 실제 자동 수정 · PR 쓰기는 이 컨트롤러에 없다.
 */
@RestController
@RequestMapping("/api/projects/{projectId}/code-auto-fix")
public class CodeAutoFixController {

    private final CodeAutoFixAccessService access;

    public CodeAutoFixController(CodeAutoFixAccessService access) {
        this.access = access;
    }

    @GetMapping("/me")
    public Mine me(@PathVariable String projectId, HttpServletRequest http) {
        return access.me(projectId, user(http));
    }

    @PostMapping("/requests")
    public RequestView request(@PathVariable String projectId, @RequestBody(required = false) AccessRequest body,
                               HttpServletRequest http) {
        return access.request(projectId, user(http), body == null ? null : body.note());
    }

    @GetMapping("/requests")
    public List<RequestView> list(@PathVariable String projectId, HttpServletRequest http) {
        return access.list(projectId, user(http));
    }

    @PostMapping("/requests/{requestId}/grant")
    public RequestView grant(@PathVariable String projectId, @PathVariable Long requestId, @RequestBody GrantRequest body,
                             HttpServletRequest http) {
        return access.grant(projectId, requestId, body.scopes(), user(http));
    }

    @PostMapping("/requests/{requestId}/reject")
    public RequestView reject(@PathVariable String projectId, @PathVariable Long requestId, HttpServletRequest http) {
        return access.reject(projectId, requestId, user(http));
    }

    @PostMapping("/requests/{requestId}/revoke")
    public RequestView revoke(@PathVariable String projectId, @PathVariable Long requestId, HttpServletRequest http) {
        return access.revoke(projectId, requestId, user(http));
    }

    private static User user(HttpServletRequest http) {
        return (User) http.getAttribute("currentUser");
    }
}
