package com.playops.api.service;

import com.playops.api.exception.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.Map;

/**
 * Slack Incoming Webhook으로 알림을 보낸다. webhook이 설정되지 않았거나 전송이 실패해도
 * 절대 호출자의 주 흐름(테스트 실행/AI job 처리)을 막지 않는다 — 알림은 부가 기능이지 필수 경로가 아니다.
 */
@Service
public class SlackNotificationService {

    private static final Logger log = LoggerFactory.getLogger(SlackNotificationService.class);

    private final SlackSettingsService slackSettingsService;
    private final RestClient restClient = RestClient.create();

    public SlackNotificationService(SlackSettingsService slackSettingsService) {
        this.slackSettingsService = slackSettingsService;
    }

    public void send(String text) {
        String webhookUrl = slackSettingsService.getDecryptedWebhookUrlOrNull();
        if (webhookUrl == null) {
            log.debug("Slack webhook이 설정되지 않아 알림을 건너뜁니다.");
            return;
        }
        try {
            restClient.post()
                    .uri(webhookUrl)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("text", text))
                    .retrieve()
                    .toBodilessEntity();
        } catch (Exception e) {
            log.warn("Slack 알림 전송 실패: {}", e.getMessage());
        }
    }

    /** 관리자 설정 화면의 "테스트 전송" 버튼 전용 — send()와 달리 실패를 삼키지 않고 그대로 알려준다. */
    public void sendTest() {
        String webhookUrl = slackSettingsService.getDecryptedWebhookUrlOrNull();
        if (webhookUrl == null) {
            throw new ApiException(400, "Slack webhook URL이 설정되어 있지 않습니다.");
        }
        try {
            restClient.post()
                    .uri(webhookUrl)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("text", ":white_check_mark: AI-TestOps Slack 알림 연동 테스트입니다. 이 메시지가 보이면 정상 연동된 것입니다."))
                    .retrieve()
                    .toBodilessEntity();
        } catch (Exception e) {
            throw new ApiException(502, "Slack 테스트 알림 전송 실패: " + e.getMessage());
        }
    }
}
