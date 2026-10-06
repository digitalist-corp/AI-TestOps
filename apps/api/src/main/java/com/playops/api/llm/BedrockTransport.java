package com.playops.api.llm;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.http.apache.ApacheHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.bedrockruntime.BedrockRuntimeClient;

import java.time.Duration;

/**
 * Claude 요청을 Amazon Bedrock 으로 보내는 전송 계층.
 *
 * Bedrock 의 Claude 는 Messages API 와 같은 본문을 받으므로, 여기서는 서명(SigV4)과 전송만 맡고
 * 본문을 만들고 응답을 읽는 일은 {@link ClaudeLlmClient} 가 그대로 한다.
 * 자격증명은 AWS 기본 체인에서 읽는다 — api 컨테이너의 환경변수에만 두고 DB 나 러너 컨테이너에는 두지 않는다.
 */
@Component
public class BedrockTransport {

    /** 모델 ID 또는 추론 프로파일 ID (예: global.anthropic.claude-haiku-4-5-20251001-v1:0). 비어 있으면 Bedrock 을 쓰지 않는다. */
    @Value("${bedrock.model:}")
    private String model = "";

    @Value("${bedrock.region:ap-northeast-2}")
    private String region = "ap-northeast-2";

    @Value("${llm.connect-timeout-ms:10000}")
    private int connectTimeoutMs = 10_000;

    @Value("${llm.read-timeout-ms:90000}")
    private int readTimeoutMs = 90_000;

    private volatile BedrockRuntimeClient client;

    public boolean enabled() {
        return model != null && !model.isBlank();
    }

    public String model() {
        return model;
    }

    /** Messages API 형식의 요청 본문을 보내고 응답 본문을 그대로 돌려준다. */
    public String invoke(String bodyJson) {
        return client().invokeModel(request -> request
                .modelId(model)
                .contentType("application/json")
                .accept("application/json")
                .body(SdkBytes.fromUtf8String(bodyJson))
        ).body().asUtf8String();
    }

    private BedrockRuntimeClient client() {
        BedrockRuntimeClient local = client;
        if (local == null) {
            synchronized (this) {
                local = client;
                if (local == null) {
                    // SDK 기본 소켓 타임아웃(30초)은 긴 생성 요청에 모자라므로 다른 LLM 클라이언트와 같은 값으로 맞춘다.
                    local = BedrockRuntimeClient.builder()
                            .region(Region.of(region))
                            .httpClientBuilder(ApacheHttpClient.builder()
                                    .connectionTimeout(Duration.ofMillis(connectTimeoutMs))
                                    .socketTimeout(Duration.ofMillis(readTimeoutMs)))
                            .build();
                    client = local;
                }
            }
        }
        return local;
    }
}
