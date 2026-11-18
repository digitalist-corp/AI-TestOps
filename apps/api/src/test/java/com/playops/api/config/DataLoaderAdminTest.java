package com.playops.api.config;

import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.repository.ProjectMemberRepository;
import com.playops.api.repository.ProjectRepository;
import com.playops.api.repository.TestSuiteRepository;
import com.playops.api.repository.UserRepository;
import com.playops.api.service.AuthService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** .env 관리자 값은 최초 생성 · 기본값 교체에만 쓰고, 셀프 회귀 전용 계정은 .env 로 만든다 (3-1 보안). */
class DataLoaderAdminTest {

    private final PasswordEncoder encoder = new BCryptPasswordEncoder(4);
    private final Map<String, User> users = new HashMap<>();
    private UserRepository userRepository;
    private AuthService authService;

    @BeforeEach
    void setUp() {
        userRepository = mock(UserRepository.class);
        authService = mock(AuthService.class);
        when(userRepository.findByUsername(anyString())).thenAnswer(inv -> Optional.ofNullable(users.get(inv.<String>getArgument(0))));
        when(userRepository.existsByRole(any())).thenAnswer(inv -> users.values().stream().anyMatch(u -> u.getRole() == inv.getArgument(0)));
        when(userRepository.save(any(User.class))).thenAnswer(inv -> {
            User u = inv.getArgument(0);
            if (u.getId() == null) u.setId((long) users.size() + 1);
            users.put(u.getUsername(), u);
            return u;
        });
    }

    private DataLoader loader(String loginPassword, String selftestPassword) {
        return new DataLoader(userRepository, mock(ProjectRepository.class), mock(TestSuiteRepository.class),
                mock(ProjectMemberRepository.class), encoder, authService,
                "admin", loginPassword, "guest", "", "3000", "selftest", selftestPassword);
    }

    private User user(String username, String password, UserRole role, String displayName) {
        User u = new User();
        u.setUsername(username);
        u.setPassword(encoder.encode(password));
        u.setRole(role);
        u.setDisplayName(displayName);
        return userRepository.save(u);
    }

    @Test
    void createsAdminOnlyWhenNoAdminExists() {
        loader("", "").seedAdmin();
        User admin = users.get("admin");
        assertThat(encoder.matches("admin", admin.getPassword())).isTrue();
        assertThat(admin.isPasswordChangeRequired()).isTrue();

        users.clear();
        loader("strong-pass-1234", "").seedAdmin();
        assertThat(encoder.matches("strong-pass-1234", users.get("admin").getPassword())).isTrue();
        assertThat(users.get("admin").isPasswordChangeRequired()).isFalse();
    }

    @Test
    void doesNotCreateWhenAnotherAdminExists() {
        user("boss", "boss-pass-1234", UserRole.ADMIN, null);
        loader("", "").seedAdmin();
        assertThat(users).doesNotContainKey("admin");
    }

    @Test
    void replacesStoredDefaultWithEnvOnceAndRevokesSessions() {
        User admin = user("admin", "admin", UserRole.ADMIN, null);
        loader("strong-pass-1234", "").seedAdmin();
        assertThat(encoder.matches("strong-pass-1234", admin.getPassword())).isTrue();
        assertThat(admin.isPasswordChangeRequired()).isFalse();
        verify(authService).revokeAllSessions(admin.getId());
    }

    @Test
    void leavesCustomPasswordAlone() {
        User admin = user("admin", "custom-pass-1234", UserRole.ADMIN, null);
        loader("admin", "").seedAdmin();
        loader("other-pass-1234", "").seedAdmin();
        assertThat(encoder.matches("custom-pass-1234", admin.getPassword())).isTrue();
        assertThat(admin.isPasswordChangeRequired()).isFalse();
        verify(authService, never()).revokeAllSessions(anyLong());
    }

    @Test
    void storedDefaultWithDefaultEnvSetsFlag() {
        User admin = user("admin", "admin", UserRole.ADMIN, null);
        loader("admin", "").seedAdmin();
        assertThat(encoder.matches("admin", admin.getPassword())).isTrue();
        assertThat(admin.isPasswordChangeRequired()).isTrue();
    }

    @Test
    void seedsSelftestAdminFromEnv() {
        loader("x", "").seedSelftest();
        assertThat(users).doesNotContainKey("selftest");

        loader("x", "self-pass-1234").seedSelftest();
        User selftest = users.get("selftest");
        assertThat(selftest.getRole()).isEqualTo(UserRole.ADMIN);
        assertThat(selftest.getDisplayName()).isEqualTo(DataLoader.SELFTEST_NAME);
        assertThat(encoder.matches("self-pass-1234", selftest.getPassword())).isTrue();

        loader("x", "next-pass-1234").seedSelftest();
        assertThat(encoder.matches("next-pass-1234", selftest.getPassword())).isTrue();
    }

    @Test
    void leavesSomeoneElsesSelftestAccountAlone() {
        User person = user("selftest", "their-pass-1234", UserRole.USER, "김준호");
        loader("x", "self-pass-1234").seedSelftest();
        assertThat(encoder.matches("their-pass-1234", person.getPassword())).isTrue();
        assertThat(person.getRole()).isEqualTo(UserRole.USER);
    }
}
