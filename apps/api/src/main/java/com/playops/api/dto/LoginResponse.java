package com.playops.api.dto;

import com.playops.api.entity.UserRole;

import java.time.Instant;

public record LoginResponse(
        String token,
        String tokenType,
        Instant expiresAt,
        String username,
        UserRole role,
        UserSummary user
) {
    public LoginResponse(String token, String username, UserRole role) {
        this(token, "Bearer", null, username, role, new UserSummary(null, username, role));
    }

    public record UserSummary(String id, String username, UserRole role) {}
}
