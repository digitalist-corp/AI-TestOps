package com.playops.api.controller;

import com.playops.api.dto.AppFixDtos;
import com.playops.api.dto.DefectDtos.DefectResponse;
import com.playops.api.dto.DefectDtos.RerunRequest;
import com.playops.api.dto.ExecutionResponse;
import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.service.AppFixProposalService;
import com.playops.api.service.DefectService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

/** 통합 결함 리스트(F-4). 조회 · 다시 실행은 팀원도 할 수 있다 (다시 실행은 ProjectAccessInterceptor.MEMBER_WRITES). */
@RestController
@RequestMapping("/api/projects/{projectId}/defects")
public class DefectController {

    private final DefectService defectService;
    private final AppFixProposalService appFixProposalService;

    public DefectController(DefectService defectService, AppFixProposalService appFixProposalService) {
        this.defectService = defectService;
        this.appFixProposalService = appFixProposalService;
    }

    @GetMapping
    public DefectResponse list(@PathVariable String projectId,
                               @RequestParam(required = false) String status,
                               @RequestParam(required = false) Long assigneeUserId,
                               @RequestParam(required = false) Long suiteId,
                               @RequestParam(required = false) String screen) {
        return defectService.list(projectId, status, assigneeUserId, suiteId, screen);
    }

    /** 고른 결함(없으면 미해결 전부)을 다시 실행하고, 새 실행을 원래 실행에 잇는다 (#82). */
    @PostMapping("/rerun")
    public ExecutionResponse rerun(@PathVariable String projectId, @RequestBody(required = false) RerunRequest request) {
        return defectService.rerun(projectId, request == null ? null : request.items());
    }

    /** 결함의 서버 분류와 가장 최근 제품 코드 수정안 (없으면 proposal 이 null). 팀원도 본다 */
    @GetMapping("/fix-proposals")
    public AppFixDtos.View fixProposal(@PathVariable String projectId, @RequestParam String specPath, @RequestParam String grep,
                                       HttpServletRequest http) {
        User user = (User) http.getAttribute("currentUser");
        return appFixProposalService.get(projectId, specPath, grep, user == null ? null : user.getId(), isAdmin(user));
    }

    /** 수정안을 찾거나 만든다 (같은 실패 · 같은 기준 SHA 면 재사용). 읽기 전용이라 팀원도 요청한다 (MEMBER_WRITES) */
    @PostMapping("/fix-proposals")
    public AppFixDtos.View requestFixProposal(@PathVariable String projectId, @RequestBody AppFixDtos.Request request,
                                              HttpServletRequest http) {
        User user = (User) http.getAttribute("currentUser");
        return appFixProposalService.request(projectId, request.specPath(), request.grep(), request.executionId(),
                user == null ? null : user.getId(), isAdmin(user));
    }

    private static boolean isAdmin(User user) {
        return user != null && user.getRole() == UserRole.ADMIN;
    }
}
