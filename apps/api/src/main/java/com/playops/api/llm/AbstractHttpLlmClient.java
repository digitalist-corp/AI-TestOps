package com.playops.api.llm;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.exception.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * HTTP 기반 LLM 클라이언트 공통부. 타임아웃이 설정된 RestClient 를 한 번만 만들어 재사용한다.
 * 기본값 없이 호출하면 응답이 오지 않는 동안 요청 스레드가 무한정 점유되므로 반드시 타임아웃을 건다.
 *
 * 스트리밍 호출은 RestClient 대신 java.net.http.HttpClient 로 응답 본문을 한 줄씩 읽는다.
 * 읽는 스레드가 인터럽트되면 읽기가 끊기므로, 채팅의 "중단"이 진행 중인 스트림도 멈출 수 있다.
 */
abstract class AbstractHttpLlmClient implements LlmClient {

    protected final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${llm.connect-timeout-ms:10000}")
    private int connectTimeoutMs = 10_000;

    @Value("${llm.read-timeout-ms:90000}")
    private int readTimeoutMs = 90_000;

    private volatile RestClient restClient;
    private volatile HttpClient httpClient;

    protected RestClient restClient() {
        RestClient local = restClient;
        if (local == null) {
            synchronized (this) {
                local = restClient;
                if (local == null) {
                    SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
                    factory.setConnectTimeout(connectTimeoutMs);
                    factory.setReadTimeout(readTimeoutMs);
                    local = RestClient.builder().requestFactory(factory).build();
                    restClient = local;
                }
            }
        }
        return local;
    }

    private HttpClient httpClient() {
        HttpClient local = httpClient;
        if (local == null) {
            synchronized (this) {
                local = httpClient;
                if (local == null) {
                    local = HttpClient.newBuilder()
                            .connectTimeout(Duration.ofMillis(connectTimeoutMs))
                            .build();
                    httpClient = local;
                }
            }
        }
        return local;
    }

    /** 스트리밍 응답의 SSE 한 줄을 받는 쪽. 파서가 예외를 던지면 읽기를 멈춘다. */
    @FunctionalInterface
    protected interface LineHandler {
        void accept(String line) throws Exception;
    }

    /**
     * JSON 본문을 POST 하고 SSE 응답을 한 줄씩 넘긴다.
     * 응답 머리가 올 때까지만 read-timeout 을 걸고, 본문은 모델이 다 쓸 때까지 계속 읽는다.
     *
     * @param label 오류 메시지에 붙일 공급자 이름 (예: "Claude")
     */
    protected void postStreaming(String url, Map<String, String> headers, Object body,
                                 String label, LineHandler onLine) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofMillis(readTimeoutMs))
                .header("Content-Type", "application/json")
                .header("Accept", "text/event-stream")
                .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)));
        headers.forEach(request::header);

        HttpResponse<Stream<String>> response =
                httpClient().send(request.build(), HttpResponse.BodyHandlers.ofLines());
        try (Stream<String> lines = response.body()) {
            if (response.statusCode() / 100 != 2) {
                String error = lines.limit(50).collect(Collectors.joining("\n"));
                throw new ApiException(502, label + " API 호출 실패: HTTP " + response.statusCode() + " "
                        + (error.length() > 1000 ? error.substring(0, 1000) : error));
            }
            var iterator = lines.iterator();
            while (iterator.hasNext()) {
                onLine.accept(iterator.next());
            }
        }
    }
}
