package com.playops.api.service;

import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.entity.Notification;
import com.playops.api.entity.Project;
import com.playops.api.entity.User;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.NotificationRepository;
import com.playops.api.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * 우상단 알림 창.
 *
 * 작은 팀이 함께 쓰는 도구라 실행 결과는 모든 사용자에게 알린다. 사용자마다 한 줄씩 만들어
 * 각자 확인하고 지울 수 있게 한다. 알림을 만들다 실패해도 실행 자체에는 영향이 없어야 한다.
 */
@Service
public class NotificationService {

    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);
    static final int LIST_LIMIT = 50;

    private final NotificationRepository repository;
    private final UserRepository userRepository;

    public NotificationService(NotificationRepository repository, UserRepository userRepository) {
        this.repository = repository;
        this.userRepository = userRepository;
    }

    public List<Notification> list(Long userId) {
        return repository.findByUserIdOrderByCreatedAtDesc(userId, PageRequest.of(0, LIST_LIMIT));
    }

    public void delete(Long userId, Long id) {
        Notification notification = repository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new ApiException(404, "알림을 찾을 수 없습니다."));
        repository.delete(notification);
    }

    public void deleteAll(Long userId) {
        repository.deleteByUserId(userId);
    }

    /** 테스트 실행이 끝났을 때. 취소와 AI 사후 검증 실행은 알리지 않는다. */
    public void executionFinished(Execution execution, Project project) {
        ExecutionStatus status = execution.getStatus();
        if (status != ExecutionStatus.PASSED && status != ExecutionStatus.FAILED && status != ExecutionStatus.ERROR) {
            return;
        }
        if ("AI_POST_APPLY".equals(execution.getSource())) {
            return;
        }
        boolean scheduled = "SCHEDULED".equals(execution.getSource());
        String result = switch (status) {
            case PASSED -> "성공";
            case FAILED -> "실패";
            default -> "오류";
        };
        String title = (scheduled ? "예약 실행 완료 · " : "테스트 종료 · ") + result;
        StringBuilder message = new StringBuilder(project.getProjectName()).append(" · 실행 #").append(execution.getId());
        if (execution.getTotalTests() != null && execution.getTotalTests() > 0) {
            message.append(" · ").append(execution.getPassedTests()).append('/').append(execution.getTotalTests()).append(" 통과");
        }
        notifyAll(scheduled ? "SCHEDULE_FINISHED" : "EXECUTION_FINISHED",
                status == ExecutionStatus.PASSED ? "SUCCESS" : "ERROR",
                title, message.toString(),
                "/projects/" + project.getProjectId() + "/runs?execution=" + execution.getId(),
                project.getProjectId());
    }

    /** 예약 시각이 됐는데 실행을 시작하지 못했을 때. */
    public void scheduleFailed(Project project, String reason) {
        notifyAll("SCHEDULE_FAILED", "ERROR", "예약 실행 시작 실패",
                project.getProjectName() + " · " + reason,
                "/projects/" + project.getProjectId() + "/schedules", project.getProjectId());
    }

    private void notifyAll(String kind, String level, String title, String message, String link, String projectId) {
        try {
            List<Notification> rows = new ArrayList<>();
            for (User user : userRepository.findAll()) {
                if (!user.isEnabled()) continue;
                Notification n = new Notification();
                n.setUserId(user.getId());
                n.setKind(kind);
                n.setLevel(level);
                n.setTitle(title);
                n.setMessage(message.length() > 1000 ? message.substring(0, 1000) : message);
                n.setLink(link);
                n.setProjectId(projectId);
                rows.add(n);
            }
            repository.saveAll(rows);
        } catch (RuntimeException e) {
            log.warn("알림을 만들지 못했습니다 ({}): {}", kind, e.getMessage());
        }
    }
}
