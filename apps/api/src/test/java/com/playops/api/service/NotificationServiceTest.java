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
    private final NotificationService service = new NotificationService(repository, userRepository);

    private static User user(long id, boolean enabled) {
        User u = new User();
        u.setId(id);
        u.setEnabled(enabled);
        return u;
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
    void finishedExecutionNotifiesEveryEnabledUserWithALinkToTheRun() {
        when(userRepository.findAll()).thenReturn(List.of(user(1, true), user(2, true), user(3, false)));

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
}
