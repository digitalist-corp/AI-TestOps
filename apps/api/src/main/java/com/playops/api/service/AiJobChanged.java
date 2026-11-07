package com.playops.api.service;

/** AI 작업이 생기거나 상태가 바뀌었다. 화면은 이 신호를 받고 목록을 다시 읽는다. (D-02) */
public record AiJobChanged(Long id, String projectId, String status) {}
