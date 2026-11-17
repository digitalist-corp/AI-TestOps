package com.playops.api.entity;

/** PROPOSED: 실패에서 자동으로 만든 수정 제안. 사람이 진행을 눌러야 PENDING 으로 간다. */
public enum AiJobStatus {
    PROPOSED, PENDING, RUNNING, DIFF_READY, NEEDS_REVIEW, APPLIED, REJECTED, FAILED, ERROR, CANCELED, TIMEOUT
}
