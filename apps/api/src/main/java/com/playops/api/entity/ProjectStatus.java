package com.playops.api.entity;

/** 프로젝트 상태(#117): 계획 · 실행 · 종료. 환경(개발 · 테스트 · 운영) 대신 이것으로 프로젝트를 구분한다. */
public enum ProjectStatus {
    PLANNED, RUNNING, CLOSED
}
