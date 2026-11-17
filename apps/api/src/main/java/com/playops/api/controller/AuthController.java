package com.playops.api.controller;

import com.playops.api.dto.LoginRequest;
import com.playops.api.dto.LoginResponse;
import com.playops.api.dto.SignupRequest;
import com.playops.api.service.AuthService;
import com.playops.api.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;
    private final UserService userService;

    public AuthController(AuthService authService, UserService userService) {
        this.authService = authService;
        this.userService = userService;
    }

    @PostMapping("/login")
    public LoginResponse login(@RequestBody LoginRequest request, HttpServletRequest httpRequest) {
        String forwarded = httpRequest.getHeader("X-Forwarded-For");
        String clientIp = forwarded != null && !forwarded.isBlank()
                ? forwarded.split(",")[0].trim()
                : httpRequest.getRemoteAddr();
        String userAgent = httpRequest.getHeader("User-Agent");
        return authService.login(request, clientIp, userAgent);
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
