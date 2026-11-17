package com.playops.api.controller;

import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.service.ProjectMemberService;
import com.playops.api.service.SiteAnalysisService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 프로젝트를 가리지 않고 지금 돌고 있는 구조 분석. 프로젝트 목록과 상단의 진행 배지가 쓴다. */
@RestController
@RequestMapping("/api/sitemap")
public class SiteMapStatusController {

    private final SiteAnalysisService siteAnalysisService;
    private final ProjectMemberService memberService;

    public SiteMapStatusController(SiteAnalysisService siteAnalysisService, ProjectMemberService memberService) {
        this.siteAnalysisService = siteAnalysisService;
        this.memberService = memberService;
    }

    /** 관리자는 전체, 그 밖에는 멤버인 프로젝트의 분석만 (#105) */
    @GetMapping("/running")
    public List<SiteAnalysisService.Running> running(HttpServletRequest request) {
        User user = (User) request.getAttribute("currentUser");
        List<SiteAnalysisService.Running> all = siteAnalysisService.running();
        if (user == null || user.getRole() == UserRole.ADMIN) {
            return all;
        }
        var mine = memberService.projectsOf(user).keySet();
        return all.stream().filter(r -> mine.contains(r.projectId())).toList();
    }
}
