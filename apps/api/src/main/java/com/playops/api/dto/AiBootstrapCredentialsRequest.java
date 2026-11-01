package com.playops.api.dto;

/** 첫 테스트 생성 중 로그인이 필요할 때 사용자가 입력한 로그인 정보 또는 건너뛰기 요청. */
public record AiBootstrapCredentialsRequest(
        String loginId,
        String password,
        String loginPath,
        Boolean skip
) {
    public boolean isSkip() {
        return Boolean.TRUE.equals(skip);
    }
}
