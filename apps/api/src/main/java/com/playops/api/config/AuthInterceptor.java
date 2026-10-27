package com.playops.api.config;

import com.playops.api.entity.User;
import com.playops.api.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class AuthInterceptor implements HandlerInterceptor {

    private static final int GENERAL_API_LIMIT_PER_MIN = 120;
    private static final int AI_CHAT_LIMIT_PER_MIN = 10;

    private final AuthService authService;
    private final Map<String, RateWindow> generalRateWindows = new ConcurrentHashMap<>();
    private final Map<String, RateWindow> aiChatRateWindows = new ConcurrentHashMap<>();

    public AuthInterceptor(AuthService authService) {
        this.authService = authService;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true;
        }

        String path = request.getRequestURI();
        if (path.startsWith("/actuator") || path.equals("/api/auth/login") || path.startsWith("/api/health")) {
            return true;
        }
        // /internal/** 은 사용자 로그인 토큰이 아니라 AiJob별 콜백 토큰으로 자체 인증한다
        // (AI Runner 컨테이너는 사용자 계정이 없다). 컨트롤러/서비스에서 매번 토큰을 검증해야 한다.
        if (path.startsWith("/internal/")) {
            return true;
        }

        String token = request.getHeader("Authorization");
        if (token != null && token.startsWith("Bearer ")) {
            token = token.substring(7);
        }
        // SEC-01: 토큰은 Bearer 헤더로만 받는다. 단, 브라우저가 새 탭/다운로드로 직접 여는 실행 아티팩트(HTML 리포트 포함)는
        // 헤더를 붙일 수 없어 GET 요청에 한해 query 토큰을 예외로 허용한다.
        if ((token == null || token.isBlank()) && isArtifactDownload(request, path)) {
            token = request.getParameter("token");
        }

        User user = authService.validateToken(token);
        if (user == null) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            return false;
        }

        if (path.startsWith("/api/admin/") && user.getRole() != com.playops.api.entity.UserRole.ADMIN) {
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            return false;
        }

        String userKey = String.valueOf(user.getId() != null ? user.getId() : user.getUsername());
        if (path.equals("/api/ai/chat")) {
            if (!allowRequest(aiChatRateWindows, userKey, AI_CHAT_LIMIT_PER_MIN)) {
                writeRateLimitResponse(response, "AI 채팅 호출 한도(분당 10회)를 초과했습니다.");
                return false;
            }
        } else if (!"GET".equalsIgnoreCase(request.getMethod())
                // 화면 폴링(실행 로그 0.5초 등)만으로 분당 120회를 넘기므로 조회(GET)는 제한하지 않는다.
                && !allowRequest(generalRateWindows, userKey, GENERAL_API_LIMIT_PER_MIN)) {
            writeRateLimitResponse(response, "API 호출 한도(분당 120회)를 초과했습니다.");
            return false;
        }

        request.setAttribute("currentUser", user);
        return true;
    }

    private boolean isArtifactDownload(HttpServletRequest request, String path) {
        return "GET".equalsIgnoreCase(request.getMethod())
                && path.matches("^/api/executions/\\d+/artifact$");
    }

    private boolean allowRequest(Map<String, RateWindow> store, String key, int maxPerMinute) {
        Instant now = Instant.now();
        RateWindow updated = store.compute(key, (k, existing) -> {
            if (existing == null || existing.windowStart.isBefore(now.minus(1, ChronoUnit.MINUTES))) {
                return new RateWindow(now, 1);
            }
            return new RateWindow(existing.windowStart, existing.count + 1);
        });
        return updated.count <= maxPerMinute;
    }

    private void writeRateLimitResponse(HttpServletResponse response, String message) throws Exception {
        response.setStatus(429);
        response.setHeader("Retry-After", "60");
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write(
                "{\"message\":\"" + message + "\",\"error\":{\"code\":\"RATE_LIMITED\",\"message\":\"" + message + "\",\"details\":[]}}"
        );
    }

    private record RateWindow(Instant windowStart, int count) {}
}
