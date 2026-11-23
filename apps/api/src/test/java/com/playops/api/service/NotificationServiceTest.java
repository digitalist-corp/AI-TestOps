package com.playops.api.service;

import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.entity.Notification;
import com.playops.api.entity.Project;
import com.playops.api.entity.User;
import com.playops.api.repository.NotificationRepository;
import com.playops.api.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class NotificationServiceTest {

    private final NotificationRepository repository = mock(NotificationRepository.class);
    private final UserRepository userRepository = mock(UserRepository.class);
    private final com.playops.api.repository.ProjectMemberRepository memberRepository =
            mock(com.playops.api.repository.ProjectMemberRepository.class);
    private final NotificationService service = new NotificationService(repository, userRepository, memberRepository);

    private static User user(long id, boolean enabled) {
        User u = new User();
        u.setId(id);
        u.setEnabled(enabled);
        u.setRole(com.playops.api.entity.UserRole.USER);
        return u;
    }

    private void members(long... userIds) {
        when(memberRepository.findByProjectId("demo")).thenReturn(java.util.Arrays.stream(userIds)
                .mapToObj(id -> com.playops.api.entity.ProjectMember.of("demo", id, com.playops.api.entity.ProjectRole.MEMBER, null))
                .toList());
    }

    private static Project project() {
        Project p = new Project();
        p.setProjectId("demo");
        p.setProjectName("Demo");
        return p;
    }

    private static Execution execution(ExecutionStatus status, String source) {
        Execution e = new Execution();
        e.setId(7L);
        e.setStatus(status);
        e.setSource(source);
        e.setTotalTests(5);
        e.setPassedTests(4);
        return e;
    }

    @SuppressWarnings("unchecked")
    private List<Notification> saved() {
        ArgumentCaptor<List<Notification>> rows = ArgumentCaptor.forClass(List.class);
        verify(repository).saveAll(rows.capture());
        return rows.getValue();
    }

    @Test
    void finishedExecutionNotifiesEveryEnabledMemberWithALinkToTheRun() {
        when(userRepository.findAll()).thenReturn(List.of(user(1, true), user(2, true), user(3, false)));
        members(1, 2, 3);

        service.executionFinished(execution(ExecutionStatus.FAILED, "MANUAL"), project());

        List<Notification> rows = saved();
        assertThat(rows).extracting(Notification::getUserId).containsExactly(1L, 2L);
        Notification n = rows.get(0);
        assertThat(n.getTitle()).isEqualTo("테스트 종료 · 실패");
        assertThat(n.getMessage()).isEqualTo("Demo · 실행 #7 · 4/5 통과");
        assertThat(n.getLevel()).isEqualTo("ERROR");
        assertThat(n.getLink()).isEqualTo("/projects/demo/runs?execution=7");
    }

    @Test
    void scheduledRunIsLabelledAsScheduleCompletion() {
        when(userRepository.findAll()).thenReturn(List.of(user(1, true)));
        members(1);

        service.executionFinished(execution(ExecutionStatus.PASSED, "SCHEDULED"), project());

        Notification n = saved().get(0);
        assertThat(n.getKind()).isEqualTo("SCHEDULE_FINISHED");
        assertThat(n.getTitle()).isEqualTo("예약 실행 완료 · 성공");
        assertThat(n.getLevel()).isEqualTo("SUCCESS");
    }

    @Test
    void cancelledRunsAndAiVerificationRunsAreNotNotified() {
        service.executionFinished(execution(ExecutionStatus.CANCELLED, "MANUAL"), project());
        service.executionFinished(execution(ExecutionStatus.FAILED, "AI_POST_APPLY"), project());

        verify(repository, never()).saveAll(any());
    }

    /** 3-1: 프로젝트 알림이 모두에게 가서 게스트 알림이 9+ 로 쌓이고 권한 없는 프로젝트 소식이 새던 것 */
    @Test
    void projectNotificationsGoToMembersAndAdminsOnly() {
        User admin = user(3, true);
        admin.setRole(com.playops.api.entity.UserRole.ADMIN);
        when(userRepository.findAll()).thenReturn(List.of(user(1, true), user(2, true), admin, user(4, false)));
        members(1, 4);

        service.executionFinished(execution(ExecutionStatus.FAILED, "MANUAL"), project());

        assertThat(saved()).extracting(Notification::getUserId).containsExactly(1L, 3L);
    }

    @Test
    void noticesStillGoToEveryone() {
        when(userRepository.findAll()).thenReturn(List.of(user(1, true), user(2, true), user(3, false)));
        members();

        service.noticePosted(9L, "점검 안내");

        assertThat(saved()).extracting(Notification::getUserId).containsExactly(1L, 2L);
    }

    @Test
    void autoFixAccessRequestGoesOnlyToActivePmsOfThatProject() {
        User pm = user(1, true);
        User disabledPm = user(2, false);
        User member = user(3, true);
        User admin = user(4, true);
        admin.setRole(com.playops.api.entity.UserRole.ADMIN);
        when(memberRepository.findByProjectId("demo")).thenReturn(List.of(
                com.playops.api.entity.ProjectMember.of("demo", 1L, com.playops.api.entity.ProjectRole.PM, null),
                com.playops.api.entity.ProjectMember.of("demo", 2L, com.playops.api.entity.ProjectRole.PM, null),
                com.playops.api.entity.ProjectMember.of("demo", 3L, com.playops.api.entity.ProjectRole.MEMBER, null)));
        when(userRepository.findAllById(any())).thenReturn(List.of(pm, disabledPm));
        when(userRepository.findAll()).thenReturn(List.of(pm, disabledPm, member, admin));

        service.autoFixAccessRequested(project(), "윤재", 9L);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Notification>> rows = ArgumentCaptor.forClass(List.class);
        verify(repository).saveAll(rows.capture());
        assertThat(rows.getValue()).extracting(Notification::getUserId).containsExactly(1L);
        Notification n = rows.getValue().get(0);
        assertThat(n.getTitle()).isEqualTo("팀원이 자동 수정 권한을 요청했습니다");
        assertThat(n.getLink()).isEqualTo("/projects/demo/code-auto-fix?request=9");
        assertThat(n.getProjectId()).isEqualTo("demo");
    }
}
