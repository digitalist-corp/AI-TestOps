package com.playops.api.service;

import jakarta.annotation.PreDestroy;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * AI Task 실시간 통로. (D-02)
 *
 * 작업이 바뀌면(AiJobChanged) 붙어 있는 화면 모두에 job 이벤트를 보낸다. 내용은 id · 프로젝트 · 상태뿐이고,
 * 화면은 이것을 받아 목록을 다시 읽는다. 연결이 끊긴 사이에 놓친 이벤트도 다시 붙을 때 오는 ready 에서
 * 전체를 다시 읽어 메운다.
 *
 * 30분마다 서버가 연결을 닫고 클라이언트가 다시 붙는다. 20초마다 ping 을 보내 죽은 연결을 걸러 낸다.
 * ponytail: 모든 로그인 사용자에게 같은 이벤트를 보낸다. 작업 목록 API 도 프로젝트 소유자 검사를 하지 않으므로
 * 노출 범위는 같다. 소유자 검사가 생기면 여기서도 projectId 로 거른다.
 */
@Service
public class AiTaskStreamService {

    static final long TIMEOUT_MS = Duration.ofMinutes(30).toMillis();
    private static final long PING_SECONDS = 20;

    private final Set<SseEmitter> emitters = ConcurrentHashMap.newKeySet();
    private final ScheduledExecutorService pinger = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "ai-task-stream-ping");
        t.setDaemon(true);
        return t;
    });

    public AiTaskStreamService() {
        pinger.scheduleAtFixedRate(this::ping, PING_SECONDS, PING_SECONDS, TimeUnit.SECONDS);
    }

    public SseEmitter subscribe() {
        SseEmitter emitter = new SseEmitter(TIMEOUT_MS);
        emitters.add(emitter);
        emitter.onCompletion(() -> emitters.remove(emitter));
        emitter.onTimeout(() -> emitters.remove(emitter));
        emitter.onError(e -> emitters.remove(emitter));
        send(emitter, SseEmitter.event().name("ready").data(Map.of(), MediaType.APPLICATION_JSON));
        return emitter;
    }

    /** 저장이 커밋된 뒤에 보낸다. 화면이 바로 다시 읽어도 바뀐 값을 보게 하기 위해서다. */
    @TransactionalEventListener(fallbackExecution = true)
    public void onJobChanged(AiJobChanged change) {
        Map<String, Object> data = Map.of("id", change.id(), "projectId", change.projectId(), "status", change.status());
        for (SseEmitter emitter : emitters) {
            send(emitter, SseEmitter.event().name("job").data(data, MediaType.APPLICATION_JSON));
        }
    }

    int subscriberCount() {
        return emitters.size();
    }

    private void ping() {
        for (SseEmitter emitter : emitters) {
            send(emitter, SseEmitter.event().comment("ping"));
        }
    }

    private void send(SseEmitter emitter, SseEmitter.SseEventBuilder event) {
        try {
            emitter.send(event);
        } catch (Exception e) {
            emitters.remove(emitter);
            emitter.completeWithError(e);
        }
    }

    @PreDestroy
    void shutdown() {
        pinger.shutdownNow();
        emitters.forEach(SseEmitter::complete);
    }
}
