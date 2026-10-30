package com.playops.api.service;

import com.playops.api.dto.ExecutionScheduleRequest;
import com.playops.api.dto.ExecutionScheduleResponse;
import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionSchedule;
import com.playops.api.entity.Project;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ExecutionRepository;
import com.playops.api.repository.ExecutionScheduleRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.List;
import java.util.Set;

/**
 * 프로젝트별 반복 예약 실행. 스케줄러는 "지금이 실행 시각인가"만 매분 판단하고, 실제 실행은 기존
 * TestExecutionService/Execution 파이프라인을 수동 트리거와 완전히 동일하게 그대로 탄다.
 */
@Service
public class ExecutionScheduleService {

    private static final Logger log = LoggerFactory.getLogger(ExecutionScheduleService.class);
    private static final Set<String> VALID_DAYS = Set.of("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN");

    private final ExecutionScheduleRepository repository;
    private final ExecutionRepository executionRepository;
    private final ProjectService projectService;
    private final TestExecutionService testExecutionService;
    private final DockerRunnerService dockerRunnerService;
    private final SlackNotificationService slackNotificationService;
    private final NotificationService notificationService;

    public ExecutionScheduleService(
            ExecutionScheduleRepository repository,
            ExecutionRepository executionRepository,
            ProjectService projectService,
            TestExecutionService testExecutionService,
            DockerRunnerService dockerRunnerService,
            SlackNotificationService slackNotificationService,
            NotificationService notificationService
    ) {
        this.notificationService = notificationService;
        this.repository = repository;
        this.executionRepository = executionRepository;
        this.projectService = projectService;
        this.testExecutionService = testExecutionService;
        this.dockerRunnerService = dockerRunnerService;
        this.slackNotificationService = slackNotificationService;
    }

    public List<ExecutionScheduleResponse> listByProject(String projectId) {
        return repository.findByProjectIdOrderByIdAsc(projectId).stream().map(ExecutionScheduleResponse::from).toList();
    }

    public ExecutionScheduleResponse create(String projectId, ExecutionScheduleRequest request, Long userId) {
        projectService.getProject(projectId); // 존재 검증 (없으면 ApiException 404)
        ExecutionSchedule schedule = new ExecutionSchedule();
        schedule.setProjectId(projectId);
        schedule.setCreatedBy(userId);
        applyRequest(schedule, request);
        return ExecutionScheduleResponse.from(repository.save(schedule));
    }

    public ExecutionScheduleResponse update(Long id, ExecutionScheduleRequest request) {
        ExecutionSchedule schedule = getOrThrow(id);
        applyRequest(schedule, request);
        return ExecutionScheduleResponse.from(repository.save(schedule));
    }

    public void delete(Long id) {
        repository.deleteById(id);
    }

    private ExecutionSchedule getOrThrow(Long id) {
        return repository.findById(id).orElseThrow(() -> new ApiException(404, "예약을 찾을 수 없습니다: " + id));
    }

    private void applyRequest(ExecutionSchedule schedule, ExecutionScheduleRequest request) {
        if (request.hour() == null || request.hour() < 0 || request.hour() > 23) {
            throw new ApiException(400, "시(hour)는 0~23 사이여야 합니다.");
        }
        if (request.minute() == null || request.minute() < 0 || request.minute() > 59) {
            throw new ApiException(400, "분(minute)은 0~59 사이여야 합니다.");
        }
        schedule.setName(request.name());
        schedule.setSpecPath(request.specPath() != null && !request.specPath().isBlank() ? request.specPath().trim() : null);
        schedule.setHour(request.hour());
        schedule.setMinute(request.minute());
        schedule.setDaysOfWeek(validateDaysOfWeek(request.daysOfWeek()));
        schedule.setEnabled(request.enabled() == null || request.enabled());
    }

    private String validateDaysOfWeek(String raw) {
        if (raw == null || raw.isBlank() || "*".equals(raw.trim())) {
            return "*";
        }
        List<String> tokens = Arrays.stream(raw.split(","))
                .map(String::trim)
                .map(String::toUpperCase)
                .filter(s -> !s.isEmpty())
                .toList();
        for (String token : tokens) {
            if (!VALID_DAYS.contains(token)) {
                throw new ApiException(400, "요일 코드가 올바르지 않습니다: " + token + " (MON~SUN 또는 * 만 허용)");
            }
        }
        return tokens.isEmpty() ? "*" : String.join(",", tokens);
    }

    /** 매분 정각에 실행. "지금이 실행 시각인가"만 판단하고, 트리거는 기존 파이프라인에 그대로 위임한다. */
    @Scheduled(cron = "0 * * * * *")
    public void pollAndTrigger() {
        LocalDateTime now = LocalDateTime.now();
        String today = now.getDayOfWeek().name().substring(0, 3);

        for (ExecutionSchedule schedule : repository.findByEnabledTrue()) {
            try {
                if (!matchesDay(schedule.getDaysOfWeek(), today)) continue;
                if (!schedule.getHour().equals(now.getHour()) || !schedule.getMinute().equals(now.getMinute())) continue;
                if (alreadyTriggeredThisMinute(schedule, now)) continue;

                trigger(schedule);
            } catch (Exception e) {
                log.error("예약 {} 처리 중 오류", schedule.getId(), e);
            }
        }
    }

    private boolean matchesDay(String daysOfWeek, String today) {
        if (daysOfWeek == null || "*".equals(daysOfWeek)) {
            return true;
        }
        return Arrays.asList(daysOfWeek.split(",")).contains(today);
    }

    private boolean alreadyTriggeredThisMinute(ExecutionSchedule schedule, LocalDateTime now) {
        if (schedule.getLastTriggeredAt() == null) {
            return false;
        }
        LocalDateTime last = LocalDateTime.ofInstant(schedule.getLastTriggeredAt(), ZoneId.systemDefault());
        return last.getDayOfYear() == now.getDayOfYear()
                && last.getYear() == now.getYear()
                && last.getHour() == now.getHour()
                && last.getMinute() == now.getMinute();
    }

    private void trigger(ExecutionSchedule schedule) {
        schedule.setLastTriggeredAt(Instant.now());
        repository.save(schedule);

        Project project;
        try {
            project = projectService.getProject(schedule.getProjectId());
        } catch (ApiException e) {
            log.warn("예약 {} 대상 프로젝트를 찾을 수 없습니다: {}", schedule.getId(), schedule.getProjectId());
            return;
        }

        try {
            Execution execution = testExecutionService.createExecution(
                    schedule.getProjectId(), null, schedule.getSpecPath(), null, null);
            execution.setSource("SCHEDULED");
            executionRepository.save(execution);

            try {
                testExecutionService.runExecutionAsync(execution.getId());
                dockerRunnerService.logOperation(schedule.getProjectId(),
                        "[playops] 예약 실행 트리거: schedule#" + schedule.getId()
                                + (schedule.getName() != null && !schedule.getName().isBlank() ? " (" + schedule.getName() + ")" : "")
                                + " -> execution#" + execution.getId());
            } catch (TaskRejectedException e) {
                executionRepository.deleteById(execution.getId());
                dockerRunnerService.logOperation(schedule.getProjectId(),
                        "[playops] 예약 실행 건너뜀 (실행 대기열 가득 참): schedule#" + schedule.getId());
            }
        } catch (ApiException e) {
            log.warn("예약 {} 실행 시작 실패: {}", schedule.getId(), e.getMessage());
            dockerRunnerService.logOperation(schedule.getProjectId(), "[playops] 예약 실행 시작 실패: " + e.getMessage());
            slackNotificationService.send(
                    ":warning: [" + project.getProjectName() + "] 예약 실행 시작 실패 — " + e.getMessage()
                            + "\nschedule #" + schedule.getId()
            );
            notificationService.scheduleFailed(project, e.getMessage());
        }
    }
}
