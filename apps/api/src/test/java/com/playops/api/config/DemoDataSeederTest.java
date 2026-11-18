package com.playops.api.config;

import com.playops.api.dto.PlanDtos.ItemPatch;
import com.playops.api.dto.PlanDtos.PlanItem;
import com.playops.api.dto.PlanDtos.PlanResponse;
import com.playops.api.entity.Project;
import com.playops.api.repository.ProjectRepository;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.mockito.ArgumentCaptor;
import com.playops.api.repository.ProjectMemberRepository;
import com.playops.api.entity.ProjectRole;
import com.playops.api.entity.ProjectMember;
import com.playops.api.entity.UserRole;
import com.playops.api.entity.User;
import com.playops.api.repository.UserRepository;
import com.playops.api.service.PlanService;
import com.playops.api.service.PlaywrightTemplateService;
import com.playops.api.service.ProjectService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 시연 spec 갱신 (#142): 예전에 넣은 그대로일 때만 새 버전으로 바꾸고, 사람이 고친 파일은 둔다. */
class DemoDataSeederTest {

    @TempDir
    Path dir;

    private PlanService planService;
    private PlaywrightTemplateService templateService;
    private DemoDataSeeder seeder;
    private UserRepository users;
    private ProjectMemberRepository members;
    private PasswordEncoder encoder;
    private ProjectRepository projects;
    private ProjectService projectService;

    private DemoDataSeeder seeder(String demoPmPassword) {
        return new DemoDataSeeder(projects, projectService, templateService, planService, users, members, encoder,
                "admin", "guest", "demo-pm", demoPmPassword);
    }

    @BeforeEach
    void setUp() {
        projects = mock(ProjectRepository.class);
        when(projects.findById("example.com")).thenReturn(Optional.of(new Project()));
        projectService = mock(ProjectService.class);
        when(projectService.getProjectPath("example.com")).thenReturn(dir);
        planService = mock(PlanService.class);
        when(planService.get("example.com")).thenReturn(new PlanResponse(List.of(
                new PlanItem("tests/demo.spec.ts", "시연 확인 문의하기 링크가 보인다", "문의하기 링크가 보인다", "시연 확인", 1,
                        true, true, null, null, null, null, null, null, null, null, null)), null));
        templateService = mock(PlaywrightTemplateService.class);
        users = mock(UserRepository.class);
        members = mock(ProjectMemberRepository.class);
        encoder = new BCryptPasswordEncoder(4);
        seeder = seeder("pw-1234-abcd");
    }

    private Path demo() throws Exception {
        Path demo = dir.resolve("tests/demo.spec.ts");
        Files.createDirectories(demo.getParent());
        return demo;
    }

    @Test
    void oldSeededSpecIsReplacedAndPlanReseeded() throws Exception {
        Path demo = demo();
        Files.copy(getClass().getResourceAsStream("/demo/demo.spec.v1.ts"), demo);
        assertThat(DemoDataSeeder.sha256(demo)).isEqualTo(DemoDataSeeder.OLD_DEMO_SHA256);

        seeder.run();

        assertThat(Files.readString(demo)).contains("안내 링크가 보인다").doesNotContain("본문 제목이 보인다");
        verify(planService).patch(eq("example.com"), any(ItemPatch.class));
        verify(templateService, never()).scaffold(any(), any(), any(), org.mockito.ArgumentMatchers.anyBoolean());
    }

    @Test
    void specEditedByPeopleIsLeftAlone() throws Exception {
        Path demo = demo();
        Files.writeString(demo, "// 사람이 고친 시연 spec\n");

        seeder.run();

        assertThat(Files.readString(demo)).isEqualTo("// 사람이 고친 시연 spec\n");
        verify(planService, never()).patch(any(), any());
    }

    // ── 시연용 PM 계정 (3차 5번): 비밀번호는 .env(DEMO_PM_PASSWORD)로만 ──

    @Test
    void noPasswordNoDemoPm() throws Exception {
        seeder("").run();

        verify(users, never()).save(any());
    }

    @Test
    void createsDemoPmAsPmOfTheDemoProject() throws Exception {
        when(users.findByUsername("demo-pm")).thenReturn(Optional.empty());
        when(users.save(any())).thenAnswer(inv -> {
            User u = inv.getArgument(0);
            u.setId(42L);
            return u;
        });

        seeder.run();

        ArgumentCaptor<User> saved = ArgumentCaptor.forClass(User.class);
        verify(users).save(saved.capture());
        assertThat(saved.getValue().getRole()).isEqualTo(UserRole.USER);
        assertThat(saved.getValue().getDisplayName()).isEqualTo("시연 PM");
        assertThat(encoder.matches("pw-1234-abcd", saved.getValue().getPassword())).isTrue();
        ArgumentCaptor<ProjectMember> member = ArgumentCaptor.forClass(ProjectMember.class);
        verify(members).save(member.capture());
        assertThat(member.getValue().getProjectId()).isEqualTo("example.com");
        assertThat(member.getValue().getRole()).isEqualTo(ProjectRole.PM);
    }

    @Test
    void changedEnvPasswordIsAppliedOnNextBoot() throws Exception {
        User existing = demoPm("old-password");
        when(users.findByUsername("demo-pm")).thenReturn(Optional.of(existing));
        when(members.findByProjectIdAndUserId("example.com", 42L)).thenReturn(Optional.of(new ProjectMember()));

        seeder.run();

        assertThat(encoder.matches("pw-1234-abcd", existing.getPassword())).isTrue();
        verify(users).save(existing);
        verify(members, never()).save(any());
    }

    @Test
    void anotherPersonsAccountWithTheSameIdIsNotTouched() throws Exception {
        User someone = demoPm("their-password");
        someone.setDisplayName("김민지");
        String before = someone.getPassword();
        when(users.findByUsername("demo-pm")).thenReturn(Optional.of(someone));

        seeder.run();

        assertThat(someone.getPassword()).isEqualTo(before);
        verify(users, never()).save(any());
    }

    private User demoPm(String password) {
        User u = new User();
        u.setId(42L);
        u.setUsername("demo-pm");
        u.setDisplayName("시연 PM");
        u.setRole(UserRole.USER);
        u.setPassword(encoder.encode(password));
        return u;
    }
}
