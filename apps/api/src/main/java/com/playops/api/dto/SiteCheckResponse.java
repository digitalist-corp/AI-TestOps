package com.playops.api.dto;

/**
 * 사이트 접속 확인 결과.
 *
 * @param reachable 응답을 받았고 상태 코드가 400 미만인가
 * @param statusCode HTTP 상태 코드 (응답을 못 받았으면 null)
 * @param title 페이지 &lt;title&gt; (없으면 null)
 * @param finalUrl 리다이렉트를 따라간 최종 주소
 * @param message 실패했을 때 사용자에게 보여줄 설명
 */
public record SiteCheckResponse(
        boolean reachable,
        Integer statusCode,
        String title,
        String finalUrl,
        String message
) {
    public static SiteCheckResponse failed(String message) {
        return new SiteCheckResponse(false, null, null, null, message);
    }
}
