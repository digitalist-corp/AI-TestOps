package com.playops.api.chat;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * SseEmitter 로 이벤트를 흘려 보내는 ChatEventSink.
 *
 * 형식은 계약 문서대로 정확히 "event: 이름\ndata: JSON 한 줄\n\n" 으로 쓴다. 스프링 기본 빌더는 콜론 뒤 공백 없이
 * "data:" 로 쓰는데, 화면이 "data: " 로 잘라 읽으면 첫 글자가 사라지므로 직접 글자를 만든다.
 * 15초마다 ": ping" 주석 줄을 보내 프록시가 조용한 연결을 끊지 않게 한다.
 *
 * 브라우저가 끊기면 보내기가 실패하는데, 그때부터는 조용히 버린다. 에이전트 루프는 계속 돌아 결과를 저장한다.
 */
public class SseChatEventSink implements ChatEventSink {

    private static final Logger log = LoggerFactory.getLogger(SseChatEventSink.class);
    private static final long PING_SECONDS = 15;
    private static final MediaType TEXT_UTF8 = new MediaType("text", "plain", StandardCharsets.UTF_8);

    private final SseEmitter emitter;
    private final ObjectMapper objectMapper;
    private final ScheduledExecutorService pingScheduler;
    private volatile boolean gone;
    private ScheduledFuture<?> ping;

    public SseChatEventSink(SseEmitter emitter, ObjectMapper objectMapper, ScheduledExecutorService pingScheduler) {
        this.emitter = emitter;
        this.objectMapper = objectMapper;
        this.pingScheduler = pingScheduler;
        emitter.onTimeout(() -> gone = true);
        emitter.onError(e -> gone = true);
        emitter.onCompletion(() -> gone = true);
    }

    @Override
    public synchronized void open() {
        if (ping == null) {
            ping = pingScheduler.scheduleAtFixedRate(() -> write(": ping\n\n"),
                    PING_SECONDS, PING_SECONDS, TimeUnit.SECONDS);
        }
    }

    @Override
    public void send(String event, Map<String, Object> data) {
        String json;
        try {
            json = objectMapper.writeValueAsString(data);
        } catch (Exception e) {
            log.warn("채팅 이벤트 직렬화 실패 [{}]: {}", event, e.getMessage());
            return;
        }
        write("event: " + event + "\ndata: " + json + "\n\n");
    }

    @Override
    public synchronized void close() {
        if (ping != null) {
            ping.cancel(false);
        }
        if (!gone) {
            try {
                emitter.complete();
            } catch (Exception ignored) {
                // 이미 닫힌 연결
            }
        }
        gone = true;
    }

    private void write(String raw) {
        if (gone) {
            return;
        }
        try {
            emitter.send(new RawEvent(raw));
        } catch (Exception e) {
            // 브라우저가 떠났다. 루프는 계속 돌고, 결과는 DB 에서 다시 볼 수 있다.
            gone = true;
        }
    }

    /** 이미 완성된 SSE 글자를 그대로 내보내는 빌더. */
    private record RawEvent(String raw) implements SseEmitter.SseEventBuilder {
        @Override
        public SseEmitter.SseEventBuilder id(String id) { return this; }
        @Override
        public SseEmitter.SseEventBuilder name(String eventName) { return this; }
        @Override
        public SseEmitter.SseEventBuilder reconnectTime(long reconnectTimeMillis) { return this; }
        @Override
        public SseEmitter.SseEventBuilder comment(String comment) { return this; }
        @Override
        public SseEmitter.SseEventBuilder data(Object object) { return this; }
        @Override
        public SseEmitter.SseEventBuilder data(Object object, MediaType mediaType) { return this; }

        @Override
        public Set<ResponseBodyEmitter.DataWithMediaType> build() {
            return Set.of(new ResponseBodyEmitter.DataWithMediaType(raw, TEXT_UTF8));
        }
    }
}
