package com.playops.api.service;

import com.playops.api.dto.CodeAutoFixDtos.Mine;
import com.playops.api.dto.CodeAutoFixDtos.RequestView;
import com.playops.api.entity.CodeAutoFixGrant;
import com.playops.api.entity.Project;
import com.playops.api.entity.ProjectMember;
import com.playops.api.entity.ProjectRole;
import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.CodeAutoFixGrantRepository;
import com.playops.api.repository.ProjectMemberRepository;
import com.playops.api.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 코드 자동 수정 사용권: 팀원 요청 → 같은 프로젝트 PM(·관리자) 부여 · 거절 · 회수. 멤버십에 묶인다. */
class CodeAutoFixAccessServiceTest {

    private final CodeAutoFixGrantRepository grants = mock(CodeAutoFixGrantRepository.class);
    private final ProjectMemberRepository members = mock(ProjectMemberRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final NotificationService notifications = mock(NotificationService.class);
    private final ProjectService projects = mock(ProjectService.class);
    private final CodeAutoFixAccessService service = new CodeAutoFixAccessService(grants, members, users, notifications, projects);

    private final User admin = user(1, UserRole.ADMIN);
    private final User pm = user(2, UserRole.USER);
    private final User member = user(3, UserRole.USER);
    private final User otherPm = user(4, UserRole.USER);
    private final Project shop = new Project();
    /** 프로젝트 · 사용자 → 멤버 행 (테스트 중 빼고 다시 넣는다) */
    private final Map<String, ProjectMember> rows = new HashMap<>();
    private final Map<Long, CodeAutoFixGrant> saved = new HashMap<>();

    private static User user(long id, UserRole role) {
        User u = new User();
        u.setId(id);
        u.setRole(role);
        u.setEnabled(true);
        u.setUsername("u" + id);
        return u;
    }

    private void join(String projectId, User u, ProjectRole role, Instant since) {
        ProjectMember m = ProjectMember.of(projectId, u.getId(), role, null);
        ReflectionTestUtils.setField(m, "createdAt", since);
        rows.put(projectId + "/" + u.getId(), m);
    }

    @BeforeEach
    void setUp() {
        shop.setProjectId("shop");
        shop.setProjectName("쇼핑몰");
        when(projects.getProject("shop")).thenReturn(shop);
        join("shop", pm, ProjectRole.PM, Instant.parse("2026-11-01T00:00:00Z"));
        join("shop", member, ProjectRole.MEMBER, Instant.parse("2026-11-02T00:00:00Z"));
        join("other", otherPm, ProjectRole.PM, Instant.parse("2026-11-01T00:00:00Z"));
        when(members.findByProjectIdAndUserId(anyString(), anyLong()))
                .thenAnswer(inv -> Optional.ofNullable(rows.get(inv.getArgument(0) + "/" + inv.getArgument(1))));
        when(users.findById(3L)).thenReturn(Optional.of(member));
        when(users.findAllById(any())).thenReturn(List.of(member));
        when(grants.saveAndFlush(any())).thenAnswer(inv -> store(inv.getArgument(0)));
        when(grants.save(any())).thenAnswer(inv -> store(inv.getArgument(0)));
        when(grants.findById(anyLong())).thenAnswer(inv -> Optional.ofNullable(saved.get(inv.<Long>getArgument(0))));
        when(grants.findByProjectIdAndUserId(anyString(), anyLong())).thenAnswer(inv -> saved.values().stream()
                .filter(g -> g.getProjectId().equals(inv.getArgument(0)) && g.getUserId().equals(inv.getArgument(1))).findFirst());
        when(grants.findByProjectIdOrderByRequestedAtDesc("shop")).thenAnswer(inv -> List.copyOf(saved.values()));
        // 조건부 갱신을 메모리에서 흉내 낸다 (실제 쿼리는 CodeAutoFixGrantRepositoryTest)
        when(grants.reopen(anyLong(), any(), any(), any())).thenAnswer(inv -> {
            CodeAutoFixGrant g = saved.get(inv.<Long>getArgument(0));
            Instant since = inv.getArgument(1);
            if (g == null || (since.equals(g.getMemberSince()) && !List.of("REJECTED", "REVOKED").contains(g.getStatus()))) return 0;
            g.setStatus("PENDING");
            g.setScopes(null);
            g.setMemberSince(since);
            g.setNote(inv.getArgument(2));
            g.setDecidedBy(null);
            g.setDecidedAt(null);
            return 1;
        });
        when(grants.transition(anyLong(), any(), anyString(), any(), anyLong(), any())).thenAnswer(inv -> {
            CodeAutoFixGrant g = saved.get(inv.<Long>getArgument(0));
            if (g == null || !inv.<java.util.Collection<String>>getArgument(1).contains(g.getStatus())) return 0;
            g.setStatus(inv.getArgument(2));
            g.setScopes(inv.getArgument(3));
            g.setDecidedBy(inv.getArgument(4));
            g.setDecidedAt(inv.getArgument(5));
            return 1;
        });
    }

    private CodeAutoFixGrant store(CodeAutoFixGrant g) {
        if (g.getId() == null) ReflectionTestUtils.setField(g, "id", 10L + saved.size());
        saved.put(g.getId(), g);
        return g;
    }

    private RequestView requested() {
        return service.request("shop", member, "결제 결함을 자동으로 고쳐 보고 싶어요");
    }

    @Test
    void nobodyHasScopesByDefaultExceptManagers() {
        assertThat(service.me("shop", member).scopes()).isEmpty();
        assertThat(service.me("shop", member).request()).isNull();
        assertThat(service.me("shop", pm).scopes()).containsExactly("AUTO_FIX", "PR_PUBLISH");
        assertThat(service.me("shop", admin).canManage()).isTrue();
        assertThat(service.me("shop", member).integrationReady()).isFalse();
        assertThatThrownBy(() -> service.me("shop", otherPm)).hasFieldOrPropertyWithValue("status", 403);
    }

    @Test
    void memberRequestIsPendingAndOnlyThatProjectsPmsAreNotified() {
        RequestView view = requested();

        assertThat(view.status()).isEqualTo("PENDING");
        assertThat(view.scopes()).isEmpty();
        verify(notifications).autoFixAccessRequested(shop, "u3", view.id());
    }

    @Test
    void aSecondPendingRequestIsReusedWithoutAnotherNotification() {
        Long first = requested().id();
        assertThat(requested().id()).isEqualTo(first);
        verify(notifications, times(1)).autoFixAccessRequested(any(), anyString(), anyLong());
    }

    @Test
    void concurrentFirstRequestsKeepOneRow() {
        CodeAutoFixGrant winner = new CodeAutoFixGrant();
        winner.setProjectId("shop");
        winner.setUserId(3L);
        winner.setStatus("PENDING");
        winner.setMemberSince(Instant.parse("2026-11-02T00:00:00Z"));
        when(grants.findByProjectIdAndUserId("shop", 3L)).thenReturn(Optional.empty(), Optional.of(store(winner)));
        doThrow(new DataIntegrityViolationException("uk")).when(grants).saveAndFlush(any());

        assertThat(requested().id()).isEqualTo(winner.getId());
        verify(notifications, never()).autoFixAccessRequested(any(), anyString(), anyLong());
    }

    @Test
    void whenTwoReRequestsRaceOnlyTheOneThatReopensNotifies() {
        Long id = requested().id();
        service.reject("shop", id, pm);
        // 다른 요청이 먼저 다시 열었다
        when(grants.reopen(eq(id), any(), any(), any())).thenReturn(0);

        assertThat(requested().id()).isEqualTo(id);
        verify(notifications, times(1)).autoFixAccessRequested(any(), anyString(), anyLong());
    }

    @Test
    void aLateDecisionOnAnAlreadyDecidedRequestIsRefused() {
        Long id = requested().id();
        service.grant("shop", id, List.of("AUTO_FIX"), pm);
        // 다른 PM 이 그 사이 회수했다
        saved.get(id).setStatus("REVOKED");
        when(grants.findById(id)).thenAnswer(inv -> {
            CodeAutoFixGrant stale = new CodeAutoFixGrant();
            ReflectionTestUtils.setField(stale, "id", id);
            stale.setProjectId("shop");
            stale.setUserId(3L);
            stale.setStatus("GRANTED");
            stale.setMemberSince(saved.get(id).getMemberSince());
            return Optional.of(stale);
        });

        assertThatThrownBy(() -> service.grant("shop", id, List.of("PR_PUBLISH"), otherPmOfShop()))
                .hasFieldOrPropertyWithValue("status", 409);
        assertThat(saved.get(id).getStatus()).isEqualTo("REVOKED");
    }

    private User otherPmOfShop() {
        User second = user(5, UserRole.USER);
        join("shop", second, ProjectRole.PM, Instant.parse("2026-11-01T00:00:00Z"));
        return second;
    }

    @Test
    void onlyMembersRequestAndOutsidersAreRefused() {
        assertThatThrownBy(() -> service.request("shop", pm, null)).hasFieldOrPropertyWithValue("status", 400);
        assertThatThrownBy(() -> service.request("shop", admin, null)).hasFieldOrPropertyWithValue("status", 400);
        assertThatThrownBy(() -> service.request("shop", otherPm, null)).hasFieldOrPropertyWithValue("status", 403);
    }

    @Test
    void pmOfTheSameProjectGrantsChosenScopesAndTheMemberSeesThem() {
        Long id = requested().id();

        RequestView granted = service.grant("shop", id, List.of("AUTO_FIX"), pm);

        assertThat(granted.status()).isEqualTo("GRANTED");
        assertThat(granted.decidedBy()).isEqualTo(2L);
        assertThat(service.me("shop", member).scopes()).containsExactly("AUTO_FIX");
        assertThat(service.list("shop", pm)).extracting(RequestView::id).containsExactly(id);
    }

    @Test
    void membersAndPmsOfOtherProjectsCannotManage() {
        Long id = requested().id();
        assertThatThrownBy(() -> service.grant("shop", id, List.of("AUTO_FIX"), member)).hasFieldOrPropertyWithValue("status", 403);
        assertThatThrownBy(() -> service.grant("shop", id, List.of("AUTO_FIX"), otherPm)).hasFieldOrPropertyWithValue("status", 403);
        assertThatThrownBy(() -> service.list("shop", member)).hasFieldOrPropertyWithValue("status", 403);
        // 다른 프로젝트 경로로 이 요청을 다룰 수 없다
        assertThatThrownBy(() -> service.grant("other", id, List.of("AUTO_FIX"), otherPm)).hasFieldOrPropertyWithValue("status", 404);
        assertThat(service.grant("shop", id, List.of("AUTO_FIX", "PR_PUBLISH"), admin).status()).isEqualTo("GRANTED");
    }

    @Test
    void scopesMustBeChosenFromTheKnownOnes() {
        Long id = requested().id();
        assertThatThrownBy(() -> service.grant("shop", id, List.of(), pm)).hasFieldOrPropertyWithValue("status", 400);
        assertThatThrownBy(() -> service.grant("shop", id, List.of("MERGE"), pm)).hasFieldOrPropertyWithValue("status", 400);
    }

    @Test
    void rejectAndRevokeEndTheScopesAndAllowAnotherRequest() {
        Long id = requested().id();
        assertThat(service.reject("shop", id, pm).status()).isEqualTo("REJECTED");
        assertThatThrownBy(() -> service.revoke("shop", id, pm)).hasFieldOrPropertyWithValue("status", 409);

        assertThat(requested().status()).isEqualTo("PENDING");
        service.grant("shop", id, List.of("AUTO_FIX", "PR_PUBLISH"), pm);
        RequestView revoked = service.revoke("shop", id, pm);

        assertThat(revoked.status()).isEqualTo("REVOKED");
        assertThat(service.me("shop", member).scopes()).isEmpty();
        verify(notifications, times(2)).autoFixAccessRequested(eq(shop), anyString(), eq(id));
    }

    @Test
    void leavingTheProjectEndsTheGrantAndRejoiningDoesNotRestoreIt() {
        Long id = requested().id();
        service.grant("shop", id, List.of("AUTO_FIX"), pm);

        rows.remove("shop/3");
        assertThatThrownBy(() -> service.me("shop", member)).hasFieldOrPropertyWithValue("status", 403);
        assertThatThrownBy(() -> service.revoke("shop", id, pm)).hasFieldOrPropertyWithValue("status", 409);
        assertThat(service.list("shop", pm)).isEmpty();

        join("shop", member, ProjectRole.MEMBER, Instant.parse("2026-11-20T00:00:00Z"));
        Mine again = service.me("shop", member);
        assertThat(again.scopes()).isEmpty();
        assertThat(again.request()).isNull();
        // 다시 요청하면 새 요청이다 (이전 범위 없이 대기)
        RequestView fresh = requested();
        assertThat(fresh.status()).isEqualTo("PENDING");
        assertThat(fresh.scopes()).isEmpty();
    }
}
