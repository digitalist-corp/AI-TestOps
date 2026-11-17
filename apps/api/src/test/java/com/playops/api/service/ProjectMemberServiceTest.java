package com.playops.api.service;

import com.playops.api.entity.ProjectMember;
import com.playops.api.entity.ProjectRole;
import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ProjectMemberRepository;
import com.playops.api.repository.UserRepository;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** PM 지정 · 해제는 관리자만, 팀원 추가 · 제외는 관리자 또는 그 프로젝트 PM. */
class ProjectMemberServiceTest {

    private final Map<String, ProjectMember> rows = new HashMap<>();
    private final User admin = user(1L, UserRole.ADMIN);
    private final User pm = user(2L, UserRole.USER);
    private final User member = user(3L, UserRole.USER);
    private final User newcomer = user(4L, UserRole.USER);
    private ProjectMemberService service;

    private static User user(Long id, UserRole role) {
        User u = new User();
        u.setId(id);
        u.setUsername("u" + id);
        u.setRole(role);
        return u;
    }

    private static String key(String projectId, Long userId) {
        return projectId + "/" + userId;
    }

    @BeforeEach
    void setUp() {
        ProjectMemberRepository repo = mock(ProjectMemberRepository.class);
        when(repo.findByProjectIdAndUserId(anyString(), anyLong()))
                .thenAnswer(inv -> Optional.ofNullable(rows.get(key(inv.getArgument(0), inv.getArgument(1)))));
        when(repo.save(any(ProjectMember.class))).thenAnswer(inv -> {
            ProjectMember m = inv.getArgument(0);
            rows.put(key(m.getProjectId(), m.getUserId()), m);
            return m;
        });
        org.mockito.Mockito.doAnswer(inv -> {
            ProjectMember m = inv.getArgument(0);
            rows.remove(key(m.getProjectId(), m.getUserId()));
            return null;
        }).when(repo).delete(any(ProjectMember.class));

        UserRepository users = mock(UserRepository.class);
        for (User u : List.of(admin, pm, member, newcomer)) {
            when(users.findById(u.getId())).thenReturn(Optional.of(u));
        }

        service = new ProjectMemberService(repo, users);
        rows.put(key("shop", pm.getId()), ProjectMember.of("shop", pm.getId(), ProjectRole.PM, admin.getId()));
        rows.put(key("shop", member.getId()), ProjectMember.of("shop", member.getId(), ProjectRole.MEMBER, pm.getId()));
    }

    private static void forbidden(ThrowingCallable call) {
        assertThatThrownBy(call)
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(403));
    }

    @Test
    void pmAddsTeamMember() {
        service.add("shop", newcomer.getId(), ProjectRole.MEMBER, pm);

        assertThat(service.roleOf("shop", newcomer)).contains(ProjectRole.MEMBER);
    }

    @Test
    void pmCannotAppointPm() {
        forbidden(() -> service.add("shop", newcomer.getId(), ProjectRole.PM, pm));
        forbidden(() -> service.changeRole("shop", member.getId(), ProjectRole.PM, pm));
    }

    @Test
    void pmCannotRemoveAnotherPm() {
        User otherPm = user(5L, UserRole.USER);
        rows.put(key("shop", otherPm.getId()), ProjectMember.of("shop", otherPm.getId(), ProjectRole.PM, admin.getId()));

        forbidden(() -> service.remove("shop", otherPm.getId(), pm));
    }

    @Test
    void teamMemberCannotAddAnyone() {
        forbidden(() -> service.add("shop", newcomer.getId(), ProjectRole.MEMBER, member));
    }

    @Test
    void pmOfAnotherProjectCannotAdd() {
        forbidden(() -> service.add("blog", newcomer.getId(), ProjectRole.MEMBER, pm));
    }

    @Test
    void adminAppointsPm() {
        service.add("shop", newcomer.getId(), ProjectRole.PM, admin);
        service.changeRole("shop", member.getId(), ProjectRole.PM, admin);

        assertThat(service.roleOf("shop", newcomer)).contains(ProjectRole.PM);
        assertThat(service.roleOf("shop", member)).contains(ProjectRole.PM);
    }

    @Test
    void pmRemovesTeamMember() {
        service.remove("shop", member.getId(), pm);

        assertThat(service.roleOf("shop", member)).isEmpty();
    }

    @Test
    void addingAnExistingMemberConflicts() {
        assertThatThrownBy(() -> service.add("shop", member.getId(), ProjectRole.MEMBER, pm))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(409));
    }
}
