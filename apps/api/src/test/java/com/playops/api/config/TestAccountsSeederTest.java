package com.playops.api.config;

import com.playops.api.entity.ProjectMember;
import com.playops.api.entity.ProjectRole;
import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.repository.ProjectMemberRepository;
import com.playops.api.repository.ProjectRepository;
import com.playops.api.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 역할별 화면 확인용 계정 admin1 · pm1 · user1. 비밀번호는 .env(TEST_ACCOUNTS_PASSWORD)로만, 없을 때만 만든다. */
class TestAccountsSeederTest {

    private final PasswordEncoder encoder = new BCryptPasswordEncoder(4);
    private final Map<String, User> users = new HashMap<>();
    private final List<ProjectMember> members = new ArrayList<>();
    private UserRepository userRepository;
    private ProjectMemberRepository memberRepository;

    @BeforeEach
    void setUp() {
        userRepository = mock(UserRepository.class);
        memberRepository = mock(ProjectMemberRepository.class);
        when(userRepository.findByUsername(anyString())).thenAnswer(inv -> Optional.ofNullable(users.get(inv.<String>getArgument(0))));
        when(userRepository.save(any(User.class))).thenAnswer(inv -> {
            User u = inv.getArgument(0);
            if (u.getId() == null) u.setId((long) users.size() + 1);
            users.put(u.getUsername(), u);
            return u;
        });
        when(memberRepository.findByProjectIdAndUserId(anyString(), anyLong())).thenAnswer(inv -> members.stream()
                .filter(m -> m.getProjectId().equals(inv.getArgument(0)) && m.getUserId().equals(inv.getArgument(1))).findFirst());
        when(memberRepository.save(any(ProjectMember.class))).thenAnswer(inv -> {
            members.add(inv.getArgument(0));
            return inv.getArgument(0);
        });
    }

    private TestAccountsSeeder seeder(String password) {
        ProjectRepository projects = mock(ProjectRepository.class);
        when(projects.existsById("example.com")).thenReturn(true);
        return new TestAccountsSeeder(userRepository, projects, memberRepository, encoder, password);
    }

    @Test
    void createsThreeRolesWithTheGivenPassword() {
        seeder("qwer1234").run();

        assertThat(users.get("admin1").getRole()).isEqualTo(UserRole.ADMIN);
        assertThat(users.get("pm1").getRole()).isEqualTo(UserRole.PM);
        assertThat(users.get("user1").getRole()).isEqualTo(UserRole.USER);
        users.values().forEach(u -> {
            assertThat(encoder.matches("qwer1234", u.getPassword())).as(u.getUsername()).isTrue();
            assertThat(u.isPasswordChangeRequired()).isFalse();
        });
        assertThat(members).extracting(ProjectMember::getProjectId, ProjectMember::getRole).containsExactlyInAnyOrder(
                org.assertj.core.groups.Tuple.tuple("example.com", ProjectRole.PM),
                org.assertj.core.groups.Tuple.tuple("example.com", ProjectRole.MEMBER));
    }

    @Test
    void skipsWhenNoPasswordAndNeverTouchesExistingAccounts() {
        seeder("").run();
        assertThat(users).isEmpty();

        User someone = new User();
        someone.setUsername("pm1");
        someone.setPassword(encoder.encode("their-own-pass"));
        someone.setRole(UserRole.USER);
        userRepository.save(someone);
        seeder("qwer1234").run();
        assertThat(encoder.matches("their-own-pass", users.get("pm1").getPassword())).isTrue();
        assertThat(members).noneMatch(m -> m.getUserId().equals(someone.getId()));
    }
}
