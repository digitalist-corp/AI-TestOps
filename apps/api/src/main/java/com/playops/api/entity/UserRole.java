package com.playops.api.entity;

/** 계정 역할. 권한은 ADMIN 이냐 아니냐로만 갈린다. PM · USER 는 화면 구분과 프로젝트 PM 후보 고르기에 쓴다 (프로젝트 안 권한은 ProjectRole). */
public enum UserRole {
    ADMIN, PM, USER
}
