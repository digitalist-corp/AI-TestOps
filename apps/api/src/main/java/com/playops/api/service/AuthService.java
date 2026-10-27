package com.playops.api.service;

import com.playops.api.dto.LoginRequest;
import com.playops.api.dto.LoginResponse;
import com.playops.api.entity.User;
import com.playops.api.entity.UserSession;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.UserRepository;
import com.playops.api.repository.UserSessionRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class AuthService {

    private static final String DEFAULT_LOGIN_USERNAME = "admin";
    private static final String DEFAULT_LOGIN_PASSWORD = "admin";
    public static final int SESSION_ABSOLUTE_TTL_HOURS = 8;
    public static final int SESSION_IDLE_TTL_MINUTES = 30;
    private static final int MAX_PASSWORD_UTF8_BYTES = 72;
    private static final int MAX_LOGIN_FAILURES_PER_MINUTE = 5;
    private static final long LOGIN_LOCKOUT_SECONDS = 15 * 60;

    private final UserRepository userRepository;
    private final UserSessionRepository userSessionRepository;
    private final PasswordEncoder passwordEncoder;
    private final String loginUsername;
    private final String loginPassword;
    private final SecureRandom secureRandom = new SecureRandom();
    private final Map<String, LoginAttemptWindow> loginAttempts = new ConcurrentHashMap<>();

    public AuthService(
            UserRepository userRepository,
            UserSessionRepository userSessionRepository,
            PasswordEncoder passwordEncoder,
            @Value("${LOGIN_USERNAME:" + DEFAULT_LOGIN_USERNAME + "}") String loginUsername,
            @Value("${LOGIN_PASSWORD:" + DEFAULT_LOGIN_PASSWORD + "}") String loginPassword
    ) {
        this.userRepository = userRepository;
        this.userSessionRepository = userSessionRepository;
        this.passwordEncoder = passwordEncoder;
        this.loginUsername = loginUsername;
        this.loginPassword = loginPassword;
    }

    @Transactional
    public LoginResponse login(LoginRequest request) {
        return login(request, null, null);
    }

    @Transactional
    public LoginResponse login(LoginRequest request, String clientIp, String userAgent) {
        if (request == null || request.username() == null || request.username().isBlank()
                || request.password() == null || request.password().isEmpty()) {
            throw new ApiException(400, "VALIDATION_ERROR", "Username and password are required");
        }
        String username = request.username().trim();
        if (username.length() > 100) {
            throw new ApiException(400, "VALIDATION_ERROR", "Username must be 1-100 characters");
        }
        validatePasswordUtf8Length(request.password());

        String rateLimitKey = username.toLowerCase() + "|" + (clientIp != null ? clientIp : "unknown");
        checkLoginRateLimit(rateLimitKey);

        User user;
        try {
            user = authenticate(username, request.password());
        } catch (ApiException ex) {
            if (ex.getStatus() == 401) {
                recordLoginFailure(rateLimitKey);
            }
            throw ex;
        }
        loginAttempts.remove(rateLimitKey);

        if (!user.isEnabled()) {
            throw new ApiException(403, "ACCOUNT_DISABLED", "비활성화된 계정입니다.");
        }

        Instant now = Instant.now();
        user.setLastLoginAt(now);
        userRepository.save(user);

        String rawToken = generateOpaqueToken32Bytes();
        Instant expiresAt = now.plus(SESSION_ABSOLUTE_TTL_HOURS, ChronoUnit.HOURS);

        UserSession session = new UserSession();
        session.setToken(null); // 원문 토큰은 DB에 저장하지 않는다 (SEC-01)
        session.setTokenHash(sha256Hex(rawToken));
        session.setUserId(user.getId());
        session.setExpiresAt(expiresAt);
        session.setLastAccessedAt(now);
        if (userAgent != null && !userAgent.isBlank()) {
            session.setUserAgent(userAgent.length() > 500 ? userAgent.substring(0, 500) : userAgent);
        }
        userSessionRepository.save(session);

        return new LoginResponse(
                rawToken,
                "Bearer",
                expiresAt,
                user.getUsername(),
                user.getRole(),
                new LoginResponse.UserSummary(
                        user.getId() != null ? String.valueOf(user.getId()) : null,
                        user.getUsername(),
                        user.getRole()
                )
        );
    }

    public static void validatePasswordUtf8Length(String password) {
        if (password == null) {
            throw new ApiException(400, "VALIDATION_ERROR", "Password is required");
        }
        int utf8Bytes = password.getBytes(StandardCharsets.UTF_8).length;
        if (utf8Bytes > MAX_PASSWORD_UTF8_BYTES) {
            throw new ApiException(400, "VALIDATION_ERROR", "비밀번호는 UTF-8 기준 72바이트 이하여야 합니다.");
        }
    }

    private void checkLoginRateLimit(String key) {
        LoginAttemptWindow window = loginAttempts.get(key);
        if (window == null) {
            return;
        }
        Instant now = Instant.now();
        if (window.lockedUntil != null && window.lockedUntil.isAfter(now)) {
            throw new ApiException(429, "RATE_LIMITED", "로그인 실패 횟수 초과로 15분간 로그인이 제한됩니다.");
        }
    }

    private void recordLoginFailure(String key) {
        Instant now = Instant.now();
        loginAttempts.compute(key, (k, existing) -> {
            if (existing == null || existing.windowStart.isBefore(now.minus(1, ChronoUnit.MINUTES))) {
                return new LoginAttemptWindow(now, 1, null);
            }
            int nextCount = existing.count + 1;
            Instant lockedUntil = nextCount >= MAX_LOGIN_FAILURES_PER_MINUTE
                    ? now.plusSeconds(LOGIN_LOCKOUT_SECONDS)
                    : null;
            return new LoginAttemptWindow(existing.windowStart, nextCount, lockedUntil);
        });
    }

    private record LoginAttemptWindow(Instant windowStart, int count, Instant lockedUntil) {}

    private User authenticate(String username, String password) {
        if (loginUsername.equals(username) && loginPassword.equals(password)) {
            return userRepository.findByUsername(loginUsername)
                    .orElseGet(() -> {
                        User admin = new User();
                        admin.setUsername(loginUsername);
                        admin.setPassword(passwordEncoder.encode(loginPassword));
                        admin.setRole(com.playops.api.entity.UserRole.ADMIN);
                        return userRepository.save(admin);
                    });
        }

        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new ApiException(401, "INVALID_CREDENTIALS", "Invalid credentials"));

        // 기존에 평문으로 저장된 비밀번호와의 호환을 위해, 해시가 아닌 값은 평문 비교 후
        // 로그인 성공 시 즉시 해시로 마이그레이션한다 (별도 배치/마이그레이션 스크립트 불필요).
        if (isBcryptHash(user.getPassword())) {
            if (!passwordEncoder.matches(password, user.getPassword())) {
                throw new ApiException(401, "INVALID_CREDENTIALS", "Invalid credentials");
            }
        } else {
            if (!user.getPassword().equals(password)) {
                throw new ApiException(401, "INVALID_CREDENTIALS", "Invalid credentials");
            }
            user.setPassword(passwordEncoder.encode(password));
            userRepository.save(user);
        }

        return user;
    }

    private static boolean isBcryptHash(String value) {
        return value != null
                && (value.startsWith("$2a$") || value.startsWith("$2b$") || value.startsWith("$2y$"));
    }

    /**
     * 매 요청마다 호출된다(AuthInterceptor).
     * SEC-01: SHA-256 token_hash 조회, 절대 만료 8시간 + 유휴 만료 30분(last_accessed_at 기준), revoked_at 확인.
     */
    @Transactional
    public User validateToken(String token) {
        if (token == null || token.isBlank()) {
            return null;
        }
        String hash = sha256Hex(token);
        UserSession session = userSessionRepository.findByTokenHash(hash)
                .or(() -> userSessionRepository.findByToken(token))
                .orElse(null);
        if (session == null) {
            return null;
        }
        Instant now = Instant.now();
        if (session.getRevokedAt() != null || session.getExpiresAt().isBefore(now)) {
            return null;
        }
        Instant lastSeen = session.getLastAccessedAt() != null ? session.getLastAccessedAt() : session.getCreatedAt();
        if (lastSeen != null && lastSeen.plus(SESSION_IDLE_TTL_MINUTES, ChronoUnit.MINUTES).isBefore(now)) {
            session.setRevokedAt(now);
            userSessionRepository.save(session);
            return null;
        }
        User user = userRepository.findById(session.getUserId()).orElse(null);
        if (user == null || !user.isEnabled()) {
            return null;
        }
        // 과거 평문 토큰 세션이 있으면 해시로 즉시 전환하고 원문 제거
        if (session.getTokenHash() == null) {
            session.setTokenHash(hash);
            session.setToken(null);
        }
        session.setLastAccessedAt(now);
        userSessionRepository.save(session);
        return user;
    }

    @Transactional
    public void logout(String token) {
        if (token == null || token.isBlank()) {
            return;
        }
        String hash = sha256Hex(token);
        userSessionRepository.findByTokenHash(hash)
                .or(() -> userSessionRepository.findByToken(token))
                .ifPresent(session -> {
                    session.setRevokedAt(Instant.now());
                    session.setToken(null);
                    userSessionRepository.save(session);
                });
    }

    /** 관리자가 특정 사용자를 모든 기기에서 강제 로그아웃시키거나 비밀번호/역할/활성 상태 변경 시 사용한다. */
    @Transactional
    public void revokeAllSessions(Long userId) {
        Instant now = Instant.now();
        List<UserSession> active = userSessionRepository.findByUserIdAndRevokedAtIsNull(userId);
        for (UserSession session : active) {
            session.setRevokedAt(now);
            session.setToken(null);
        }
        if (!active.isEmpty()) {
            userSessionRepository.saveAll(active);
        }
    }

    private String generateOpaqueToken32Bytes() {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public static String sha256Hex(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(input.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }
}
