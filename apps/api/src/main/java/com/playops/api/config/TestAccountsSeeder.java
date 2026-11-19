package com.playops.api.config;

import com.playops.api.entity.ProjectMember;
import com.playops.api.entity.ProjectRole;
import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.repository.ProjectMemberRepository;
import com.playops.api.repository.ProjectRepository;
import com.playops.api.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * 역할별 화면을 손으로 확인하는 계정 admin1(관리자) · pm1(시연 프로젝트 PM) · user1(시연 프로젝트 팀원).
 * 비밀번호는 .env(TEST_ACCOUNTS_PASSWORD)로만 받고 비면 만들지 않는다. 같은 아이디가 이미 있으면 그 계정은 건드리지 않는다.
 * 시연 데이터(DemoDataSeeder) 다음에 돈다. 실패해도 서버 기동은 막지 않는다.
 */
@Component
@Order(30)
public class TestAccountsSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(TestAccountsSeeder.class);
    private static final String PROJECT = DemoDataSeeder.PROJECT;

    private final UserRepository userRepository;
    private final ProjectRepository projectRepository;
    private final ProjectMemberRepository memberRepository;
    private final PasswordEncoder passwordEncoder;
    private final String password;

    public TestAccountsSeeder(UserRepository userRepository, ProjectRepository projectRepository,
                              ProjectMemberRepository memberRepository, PasswordEncoder passwordEncoder,
                              @Value("${TEST_ACCOUNTS_PASSWORD:}") String password) {
        this.userRepository = userRepository;
        this.projectRepository = projectRepository;
        this.memberRepository = memberRepository;
        this.passwordEncoder = passwordEncoder;
        this.password = password;
    }

    @Override
    public void run(String... args) {
        if (password == null || password.isBlank()) return;
        try {
            create("admin1", "테스트 관리자", UserRole.ADMIN, null);
            create("pm1", "테스트 PM", UserRole.USER, ProjectRole.PM);
            create("user1", "테스트 팀원", UserRole.USER, ProjectRole.MEMBER);
        } catch (RuntimeException e) {
            log.warn("테스트 계정을 만들지 못했습니다: {}", e.getMessage());
        }
    }

    private void create(String username, String displayName, UserRole role, ProjectRole projectRole) {
        if (userRepository.findByUsername(username).isPresent()) return;
        User user = new User();
        user.setUsername(username);
        user.setDisplayName(displayName);
        user.setRole(role);
        user.setPassword(passwordEncoder.encode(password));
        user = userRepository.save(user);
        if (projectRole != null && projectRepository.existsById(PROJECT)
                && memberRepository.findByProjectIdAndUserId(PROJECT, user.getId()).isEmpty()) {
            memberRepository.save(ProjectMember.of(PROJECT, user.getId(), projectRole, null));
        }
        log.info("테스트 계정 {} 을 만들었습니다.", username);
    }
}
