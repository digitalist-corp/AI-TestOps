package com.playops.api.controller;

import com.playops.api.util.ClientIp;
import com.playops.api.dto.LoginRequest;
import com.playops.api.dto.LoginResponse;
import com.playops.api.dto.SignupRequest;
import com.playops.api.entity.ProjectRole;
import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.service.AuthService;
import com.playops.api.service.ProjectMemberService;
import com.playops.api.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;
    private final UserService userService;
    private final ProjectMemberService memberService;

    public AuthController(AuthService authService, UserService userService, ProjectMemberService memberService) {
        this.authService = authService;
        this.userService = userService;
        this.memberService = memberService;
    }

    public record ProjectRoleItem(String projectId, ProjectRole role) {}

    public record Me(Long id, String username, String displayName, UserRole role, java.util.List<ProjectRoleItem> projects) {}

    /** 로그인한 사람의 전역 역할과 프로젝트별 역할. 웹은 이것만 보고 버튼을 나눈다 (#105). */
    @GetMapping("/me")
    public Me me(HttpServletRequest request) {
        User user = (User) request.getAttribute("currentUser");
        return new Me(user.getId(), user.getUsername(), user.getDisplayName(), user.getRole(),
                memberService.projectsOf(user).entrySet().stream()
                        .map(e -> new ProjectRoleItem(e.getKey(), e.getValue()))
                        .sorted(java.util.Comparator.comparing(ProjectRoleItem::projectId))
                        .toList());
    }

    @PostMapping("/login")
    public LoginResponse login(@RequestBody LoginRequest request, HttpServletRequest httpRequest) {
        // 가입 횟수 제한(AuthInterceptor)과 같은 판단 — 믿을 프록시에서 온 X-Forwarded-For 만 (#121)
        return authService.login(request, ClientIp.of(httpRequest), httpRequest.getHeader("User-Agent"));
    }

    @PostMapping("/signup")
    public LoginResponse signup(@RequestBody SignupRequest request, HttpServletRequest httpRequest) {
        return userService.signup(request, httpRequest.getHeader("User-Agent"));
    }

    @PostMapping("/guest")
    public LoginResponse guest(HttpServletRequest httpRequest) {
        return authService.guestLogin(httpRequest.getHeader("User-Agent"));
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(@RequestHeader(value = "Authorization", required = false) String authorization) {
        if (authorization != null && authorization.startsWith("Bearer ")) {
            authService.logout(authorization.substring(7));
        }
    }
}
