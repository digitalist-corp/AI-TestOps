package com.playops.api.dto;

import com.playops.api.entity.UserRole;

public record UserRequest(String username, String password, UserRole role, Boolean enabled) {
    public UserRequest(String username, String password, UserRole role) {
        this(username, password, role, true);
    }
}
