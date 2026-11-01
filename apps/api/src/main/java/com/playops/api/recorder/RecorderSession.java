package com.playops.api.recorder;

import com.playops.api.recorder.RecorderDtos.RecordedStep;
import com.playops.api.recorder.RecorderDtos.RecorderState;

import java.time.Instant;
import java.util.List;

/**
 * 메모리에만 두는 녹화 세션 하나. 마지막으로 받은 상태(단계 목록 포함)를 들고 있어서
 * 컨테이너가 유휴 종료된 뒤에도 코드 보기 · 저장은 할 수 있다.
 */
final class RecorderSession {

    final String id;
    final String projectId;
    final Long userId;
    final int port;
    final String token;
    final String containerName;
    final String baseUrl;

    private RecorderState lastState;
    private Instant lastActivity;
    private boolean closed;
    private String closeStatus;
    private String closeReason;
    private Instant closedAt;

    RecorderSession(String id, String projectId, Long userId, int port, String token, String baseUrl, Instant now) {
        this.id = id;
        this.projectId = projectId;
        this.userId = userId;
        this.port = port;
        this.token = token;
        this.containerName = RecorderService.CONTAINER_PREFIX + id;
        this.baseUrl = baseUrl;
        this.lastActivity = now;
    }

    synchronized void update(RecorderState state) {
        if (state != null) {
            lastState = state.steps() == null ? state.withSteps(List.of()) : state;
        }
    }

    synchronized void replaceSteps(List<RecordedStep> steps) {
        lastState = (lastState == null ? RecorderState.starting(id) : lastState).withSteps(steps);
    }

    synchronized List<RecordedStep> steps() {
        return lastState == null || lastState.steps() == null ? List.of() : lastState.steps();
    }

    synchronized boolean isReady() {
        return !closed && lastState != null;
    }

    synchronized boolean isClosed() {
        return closed;
    }

    synchronized Instant lastActivity() {
        return lastActivity;
    }

    synchronized Instant closedAt() {
        return closedAt;
    }

    synchronized void touch(Instant now) {
        lastActivity = now;
    }

    /** 처음 닫을 때만 true. status 는 CLOSED 또는 ERROR. */
    synchronized boolean markClosed(String status, String reason, Instant now) {
        if (closed) {
            return false;
        }
        closed = true;
        closeStatus = status;
        closeReason = reason;
        closedAt = now;
        return true;
    }

    /** 화면에 돌려줄 상태 — 닫혔으면 닫힌 이유로, 아직 준비 전이면 STARTING 으로. */
    synchronized RecorderState view() {
        if (closed) {
            RecorderState base = lastState != null ? lastState : RecorderState.starting(id);
            return base.with(id, closeStatus, closeReason);
        }
        if (lastState == null) {
            return RecorderState.starting(id);
        }
        return lastState.with(id, lastState.status(), lastState.error());
    }
}
