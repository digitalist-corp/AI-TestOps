package com.playops.api.dto;

import com.playops.api.entity.UserRole;

/**
 * role/password/enabled 모두 선택 입력이다. null(또는 password는 blank)이면 해당 항목은 변경하지 않는다.
 */
public record UserUpdateRequest(UserRole role, String password, Boolean enabled) {
    public UserUpdateRequest(UserRole role, String password) {
        this(role, password, null);
    }
}
