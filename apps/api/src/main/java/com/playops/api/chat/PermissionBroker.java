package com.playops.api.chat;

import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * RUN 도구 허락을 기다리는 곳.
 *
 * 루프 스레드는 permission_request 를 보낸 뒤 await 로 멈춰 있고, 사용자가
 * POST .../permissions/{requestId} 로 답하면 resolve 가 그 대기를 풀어 준다.
 * 답이 오래 없으면(기본 5분) 거부로 본다 — 사용자가 자리를 비운 사이 테스트가 돌면 안 되기 때문이다.
 * 서버 메모리에만 있으므로 서버가 다시 뜨면 대기 중이던 요청은 사라진다(그 답변도 함께 끊긴다).
 */
@Component
public class PermissionBroker {

    public enum Decision { ALLOW, ALLOW_SESSION, DENY }

    private record Pending(Long sessionId, CompletableFuture<Decision> future) {}

    private final Map<String, Pending> pending = new ConcurrentHashMap<>();

    /** 새 허락 요청을 만든다. 이벤트를 보내기 전에 불러야 사용자의 빠른 답을 놓치지 않는다. */
    public String open(Long sessionId) {
        String requestId = UUID.randomUUID().toString();
        pending.put(requestId, new Pending(sessionId, new CompletableFuture<>()));
        return requestId;
    }

    /**
     * 사용자 답을 기다린다.
     *
     * @return 사용자의 결정. 시간이 지나면 DENY. 답변이 중단되어 더 기다릴 필요가 없으면 null.
     */
    public Decision await(String requestId, Duration timeout) {
        Pending entry = pending.get(requestId);
        if (entry == null) {
            return null;
        }
        try {
            return entry.future().get(timeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            return Decision.DENY;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        } catch (ExecutionException e) {
            return null;
        } finally {
            pending.remove(requestId);
        }
    }

    /** 사용자의 답. 그 세션의 대기 중인 요청이 아니면 false (이미 끝났거나 남의 요청). */
    public boolean resolve(Long sessionId, String requestId, Decision decision) {
        Pending entry = pending.get(requestId);
        if (entry == null || !entry.sessionId().equals(sessionId)) {
            return false;
        }
        return entry.future().complete(decision);
    }

    /** 답변 중단. 그 세션에서 기다리던 허락을 모두 "중단"으로 풀어 준다. */
    public void cancelSession(Long sessionId) {
        pending.values().stream()
                .filter(entry -> entry.sessionId().equals(sessionId))
                .forEach(entry -> entry.future().complete(null));
    }
}
