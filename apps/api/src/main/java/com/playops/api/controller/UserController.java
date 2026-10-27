package com.playops.api.controller;

import com.playops.api.dto.UserAuditLogResponse;
import com.playops.api.dto.UserRequest;
import com.playops.api.dto.UserResponse;
import com.playops.api.dto.UserUpdateRequest;
import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.exception.ApiException;
import com.playops.api.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping({"/api/users", "/api/admin/users"})
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping
    public List<UserResponse> list(HttpServletRequest request) {
        requireAdmin(request);
        return userService.findAll();
    }

    @GetMapping("/audit-log")
    public List<UserAuditLogResponse> auditLog(HttpServletRequest request) {
        requireAdmin(request);
        return userService.listAuditLog();
    }

    @PostMapping
    public UserResponse create(@RequestBody UserRequest body, HttpServletRequest request) {
        User actingUser = requireAdmin(request);
        return userService.create(body, actingUser);
    }

    @PutMapping("/{id}")
    public UserResponse update(@PathVariable Long id, @RequestBody UserUpdateRequest body, HttpServletRequest request) {
        User actingUser = requireAdmin(request);
        return userService.update(id, body, actingUser);
    }

    @PatchMapping("/{id}")
    public UserResponse patch(@PathVariable Long id, @RequestBody UserUpdateRequest body, HttpServletRequest request) {
        User actingUser = requireAdmin(request);
        return userService.update(id, body, actingUser);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable Long id, HttpServletRequest request) {
        User actingUser = requireAdmin(request);
        userService.delete(id, actingUser);
    }

    @DeleteMapping("/{id}/sessions")
    public void revokeSessions(@PathVariable Long id, HttpServletRequest request) {
        User actingUser = requireAdmin(request);
        userService.revokeAllSessions(id, actingUser);
    }

    private User requireAdmin(HttpServletRequest request) {
        User user = (User) request.getAttribute("currentUser");
        if (user == null || user.getRole() != UserRole.ADMIN) {
            throw new ApiException(403, "Admin access required");
        }
        return user;
    }
}
