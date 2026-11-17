package com.playops.api.dto;

import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;

import java.time.Instant;

public record UserResponse(
        Long id,
        String username,
        String displayName,
        UserRole role,
        boolean enabled,
        Instant createdAt,
        Instant updatedAt,
        Instant lastLoginAt
) {
    public static UserResponse from(User user) {
        return new UserResponse(
                user.getId(),
                user.getUsername(),
                user.getDisplayName(),
                user.getRole(),
                user.isEnabled(),
                user.getCreatedAt(),
                user.getUpdatedAt(),
                user.getLastLoginAt()
        );
    }
}
