package com.playops.api.service;

import com.playops.api.dto.LoginResponse;
import com.playops.api.dto.SignupRequest;
import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.UserAuditLogRepository;
import com.playops.api.repository.UserRepository;
import com.playops.api.repository.UserSessionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 회원가입은 누구나 하고 가입 즉시 팀원(USER)이 된다. 게스트 입장은 관리자가 아닌 게스트 계정으로만 된다. */
class SignupTest {

    private UserRepository users;
    private PasswordEncoder encoder;
    private AuthService authService;
    private UserService userService;

    @BeforeEach
    void setUp() {
        users = mock(UserRepository.class);
        encoder = new BCryptPasswordEncoder(4);
        when(users.save(any(User.class))).thenAnswer(inv -> {
            User u = inv.getArgument(0);
            if (u.getId() == null) u.setId(7L);
            return u;
        });
        authService = new AuthService(users, mock(UserSessionRepository.class), encoder, "guest");
        userService = new UserService(users, mock(UserAuditLogRepository.class), encoder, authService);
    }

    @Test
    void signupCreatesTeamMemberAndLogsIn() {
        LoginResponse res = userService.signup(new SignupRequest(" kim ", "김윤재", "password123"), null);

        assertThat(res.token()).isNotBlank();
        assertThat(res.username()).isEqualTo("kim");
        assertThat(res.role()).isEqualTo(UserRole.USER);
        verify(users, org.mockito.Mockito.atLeastOnce()).save(org.mockito.ArgumentMatchers.argThat(u ->
                u.getRole() == UserRole.USER
                        && "김윤재".equals(u.getDisplayName())
                        && encoder.matches("password123", u.getPassword())));
    }

    @Test
    void signupRejectsDuplicateUsernameWith409() {
        when(users.existsByUsername("kim")).thenReturn(true);

        assertThatThrownBy(() -> userService.signup(new SignupRequest("kim", "김윤재", "password123"), null))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(409));
        verify(users, never()).save(any());
    }

    @Test
    void signupRejectsShortPasswordWith400() {
        assertThatThrownBy(() -> userService.signup(new SignupRequest("kim", "김윤재", "short"), null))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(400));
        verify(users, never()).save(any());
    }

    @Test
    void signupRequiresName() {
        assertThatThrownBy(() -> userService.signup(new SignupRequest("kim", " ", "password123"), null))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(400));
    }

    @Test
    void guestLoginUsesTheGuestTeamMemberAccount() {
        User guest = new User();
        guest.setId(3L);
        guest.setUsername("guest");
        guest.setRole(UserRole.USER);
        when(users.findByUsername("guest")).thenReturn(Optional.of(guest));

        LoginResponse res = authService.guestLogin(null);

        assertThat(res.username()).isEqualTo("guest");
        assertThat(res.role()).isEqualTo(UserRole.USER);
    }

    @Test
    void guestLoginRefusesAnAdminAccount() {
        User admin = new User();
        admin.setId(1L);
        admin.setUsername("guest");
        admin.setRole(UserRole.ADMIN);
        when(users.findByUsername("guest")).thenReturn(Optional.of(admin));

        assertThatThrownBy(() -> authService.guestLogin(null))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(403));
    }
}
