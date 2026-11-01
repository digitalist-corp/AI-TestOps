package com.playops.api.recorder;

import com.playops.api.config.PlayOpsProperties;
import com.playops.api.entity.Project;
import com.playops.api.entity.User;
import com.playops.api.exception.ApiException;
import com.playops.api.recorder.RecorderDtos.CodeResponse;
import com.playops.api.recorder.RecorderDtos.CreateSessionRequest;
import com.playops.api.recorder.RecorderDtos.RecordedStep;
import com.playops.api.recorder.RecorderDtos.RecorderState;
import com.playops.api.recorder.RecorderDtos.SaveRequest;
import com.playops.api.recorder.RecorderDtos.SaveResponse;
import com.playops.api.service.FileStorageService;
import com.playops.api.service.LoginSessionService;
import com.playops.api.service.ProjectService;
import com.playops.api.service.RecordedFlowService;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * 클릭으로 테스트 만들기(녹화) 세션. 계약: docs/design/recorder-contract.md
 *
 * 세션마다 AI Runner 이미지로 record.js 컨테이너를 하나 띄우고(포트 9400~9499), 화면의 클릭 · 입력을
 * 그 컨테이너에 전달한다. 세션은 메모리에만 둔다 — api 가 다시 켜지면 남은 rec-* 컨테이너를 지운다.
 * 상한: 사용자당 1개(새로 시작하면 이전 것을 닫는다), 전체 2개(브라우저 하나가 메모리를 최대 1.5GB 쓴다). 10분 동안 동작이 없으면 컨테이너를 멈춘다.
 */
@Service
public class RecorderService {

    private static final Logger log = LoggerFactory.getLogger(RecorderService.class);

    static final String CONTAINER_PREFIX = "rec-";
    static final int PORT_MIN = 9400;
    static final int PORT_MAX = 9499;
    static final int MAX_TOTAL = 2;
    static final Duration IDLE_LIMIT = Duration.ofMinutes(10);
    static final Duration KEEP_CLOSED = Duration.ofMinutes(30);
    static final Duration READY_TIMEOUT = Duration.ofSeconds(90);
    static final Set<String> ACTION_TYPES = Set.of(
            "click", "fill", "press", "goto", "assertVisible", "assertText", "scroll", "inspect");
    private static final Set<String> VALUE_EDITABLE = Set.of("fill", "press", "assertText", "goto");
    private static final Pattern SPEC_FILE = Pattern.compile(".+\\.(spec|test)\\.(ts|js)$");
    private static final int MAX_FILL_VALUE = 10_000;

    private final ProjectService projectService;
    private final FileStorageService fileStorageService;
    private final LoginSessionService loginSessionService;
    private final RecorderRuntime runtime;
    private final RecordedFlowService recordedFlowService;
    private final PlayOpsProperties properties;
    private final Clock clock;
    private final Executor executor;
    private final Map<String, RecorderSession> sessions = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();

    @Autowired
    public RecorderService(ProjectService projectService, FileStorageService fileStorageService,
                           LoginSessionService loginSessionService, RecorderRuntime runtime,
                           RecordedFlowService recordedFlowService, PlayOpsProperties properties) {
        this(projectService, fileStorageService, loginSessionService, runtime, recordedFlowService, properties,
                Clock.systemDefaultZone(),
                Executors.newCachedThreadPool(r -> {
                    Thread t = new Thread(r, "recorder");
                    t.setDaemon(true);
                    return t;
                }));
    }

    RecorderService(ProjectService projectService, FileStorageService fileStorageService,
                    LoginSessionService loginSessionService, RecorderRuntime runtime,
                    RecordedFlowService recordedFlowService, PlayOpsProperties properties, Clock clock,
                    Executor executor) {
        this.projectService = projectService;
        this.fileStorageService = fileStorageService;
        this.loginSessionService = loginSessionService;
        this.runtime = runtime;
        this.recordedFlowService = recordedFlowService;
        this.properties = properties;
        this.clock = clock;
        this.executor = executor;
    }

    // ------------------------------------------------------------ 세션 열기 · 닫기

    public RecorderState create(String projectId, User user, CreateSessionRequest request) {
        Project project = projectService.getProjectForUser(projectId, user);
        if (!properties.dockerEnabled()) {
            throw new ApiException(503, "RECORDER_UNAVAILABLE", "Docker 를 쓸 수 없는 환경이라 녹화를 시작할 수 없습니다.");
        }
        String baseUrl = blankToNull(project.getBaseUrl());
        String startUrl = resolveStartUrl(request == null ? null : request.url(), baseUrl);
        Path storageState = null;
        if (request != null && Boolean.TRUE.equals(request.useLogin())) {
            Path file = loginSessionService.storageStateFile(projectId);
            if (Files.isRegularFile(file)) {
                storageState = file;
            } else {
                log.info("프로젝트 {} 로그인 세션 파일이 없어 로그인 없이 녹화를 시작합니다.", projectId);
            }
        }

        RecorderSession session;
        List<RecorderSession> replaced = new ArrayList<>();
        Instant now = clock.instant();
        synchronized (this) {
            // 사용자당 1개 — 새로 시작하면 이전 녹화는 닫는다 (새로고침으로 세션 id 를 잃어도 막히지 않게).
            for (RecorderSession s : sessions.values()) {
                if (!s.isClosed() && Objects.equals(s.userId, user.getId())
                        && s.markClosed("CLOSED", "새 녹화를 시작해 이전 녹화를 닫았습니다.", now)) {
                    replaced.add(s);
                }
            }
            if (activeCount() >= MAX_TOTAL) {
                throw new ApiException(409, "RECORDER_LIMIT",
                        "지금 녹화 중인 세션이 많습니다(전체 " + MAX_TOTAL + "개). 잠시 뒤 다시 시도하세요.");
            }
            int port = allocatePort();
            String id = randomHex(6);
            session = new RecorderSession(id, projectId, user.getId(), port, randomHex(16), baseUrl, now);
            sessions.put(id, session);
        }
        for (RecorderSession s : replaced) {
            executor.execute(() -> runtime.remove(s.containerName));
        }
        Path state = storageState;
        executor.execute(() -> boot(session, startUrl, state));
        return session.view();
    }

    /** 컨테이너를 띄우고 record.js 가 첫 화면을 열 때까지 기다린다 (백그라운드). */
    void boot(RecorderSession s, String startUrl, Path storageState) {
        try {
            runtime.ensureImage();
            if (s.isClosed()) {
                return;
            }
            runtime.start(new RecorderRuntime.ContainerSpec(s.containerName, s.port, s.token, startUrl, s.baseUrl, storageState));
            long deadline = clock.millis() + READY_TIMEOUT.toMillis();
            for (int i = 1; ; i++) {
                if (s.isClosed()) {
                    runtime.remove(s.containerName);
                    return;
                }
                try {
                    RecorderState st = runtime.state(s.port, s.token);
                    if (!"STARTING".equals(st.status())) {
                        s.update(st);
                        return;
                    }
                } catch (RecorderRuntime.CallException notYet) {
                    // 아직 HTTP 서버가 뜨지 않았다
                }
                // --rm 이라 바로 죽은 컨테이너는 목록에서 사라진다 — 90초를 다 기다리지 않는다.
                if (i % 6 == 0 && runtime.listContainers(s.containerName).isEmpty()) {
                    throw new IllegalStateException("녹화 컨테이너가 바로 끝났습니다. AI Runner 이미지에 record.js 가 없으면 이미지를 다시 빌드하세요.");
                }
                if (clock.millis() > deadline) {
                    throw new IllegalStateException("녹화 서버가 " + READY_TIMEOUT.toSeconds() + "초 안에 준비되지 않았습니다.");
                }
                Thread.sleep(500);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            fail(s, "녹화 준비가 중단됐습니다.");
        } catch (Exception e) {
            log.warn("녹화 세션 {} 시작 실패: {}", s.id, e.getMessage());
            fail(s, e.getMessage());
        }
    }

    private void fail(RecorderSession s, String reason) {
        s.markClosed("ERROR", reason, clock.instant());
        runtime.remove(s.containerName);
    }

    public void close(String projectId, String sessionId, User user) {
        RecorderSession s = owned(projectId, sessionId, user);
        s.markClosed("CLOSED", null, clock.instant());
        sessions.remove(s.id);
        executor.execute(() -> runtime.remove(s.containerName));
    }

    /** 10분 동안 동작이 없는 세션의 컨테이너를 멈추고, 닫힌 지 오래된 세션은 메모리에서 지운다. */
    @Scheduled(fixedDelay = 30_000, initialDelay = 30_000)
    public void sweep() {
        Instant now = clock.instant();
        for (RecorderSession s : sessions.values()) {
            if (!s.isClosed() && s.lastActivity().plus(IDLE_LIMIT).isBefore(now)) {
                if (s.markClosed("CLOSED", "10분 동안 동작이 없어 녹화를 멈췄습니다. 기록한 단계는 아직 저장할 수 있습니다.", now)) {
                    log.info("녹화 세션 {} 유휴 종료", s.id);
                    executor.execute(() -> runtime.remove(s.containerName));
                }
            } else if (s.isClosed() && s.closedAt() != null && s.closedAt().plus(KEEP_CLOSED).isBefore(now)) {
                sessions.remove(s.id);
            }
        }
    }

    /** api 가 다시 켜졌을 때 이전 실행이 남긴 rec-* 컨테이너를 지운다 (세션은 메모리에만 있으므로 모두 고아다). */
    public void removeLeftoverContainers() {
        if (!properties.dockerEnabled()) {
            return;
        }
        for (String name : runtime.listContainers(CONTAINER_PREFIX)) {
            log.info("남은 녹화 컨테이너 정리: {}", name);
            runtime.remove(name);
        }
    }

    @PreDestroy
    public void removeAllOnShutdown() {
        for (RecorderSession s : sessions.values()) {
            if (s.markClosed("CLOSED", "서버가 종료됐습니다.", clock.instant())) {
                runtime.remove(s.containerName);
            }
        }
    }

    // ------------------------------------------------------------ 조회 · 동작

    public RecorderState get(String projectId, String sessionId, User user) {
        RecorderSession s = owned(projectId, sessionId, user);
        if (s.isReady()) {
            try {
                s.update(runtime.state(s.port, s.token));
            } catch (RecorderRuntime.CallException e) {
                if (e.status() == 0) {
                    s.markClosed("CLOSED", "녹화 컨테이너가 끝났습니다. 기록한 단계는 아직 저장할 수 있습니다.", clock.instant());
                }
                // 그 밖의 오류는 마지막으로 받은 상태를 그대로 보여 준다
            }
        }
        return s.view();
    }

    public byte[] screenshot(String projectId, String sessionId, User user) {
        RecorderSession s = requireReady(owned(projectId, sessionId, user));
        try {
            return runtime.screenshot(s.port, s.token);
        } catch (RecorderRuntime.CallException e) {
            throw translate(s, e);
        }
    }

    public RecorderState action(String projectId, String sessionId, User user, Map<String, Object> action) {
        RecorderSession s = owned(projectId, sessionId, user);
        validateAction(action);
        requireReady(s);
        s.touch(clock.instant());
        try {
            s.update(runtime.action(s.port, s.token, action));
        } catch (RecorderRuntime.CallException e) {
            throw translate(s, e);
        }
        return s.view();
    }

    static void validateAction(Map<String, Object> action) {
        Object type = action == null ? null : action.get("type");
        if (!(type instanceof String t) || !ACTION_TYPES.contains(t)) {
            throw new ApiException(400, "알 수 없는 동작입니다: " + type);
        }
        Object value = action.get("value");
        if (value instanceof String v && v.length() > MAX_FILL_VALUE) {
            throw new ApiException(400, "입력 값이 너무 깁니다(최대 " + MAX_FILL_VALUE + "자).");
        }
    }

    public RecorderState putSteps(String projectId, String sessionId, User user, List<RecordedStep> incoming) {
        RecorderSession s = owned(projectId, sessionId, user);
        s.touch(clock.instant());
        List<RecordedStep> merged = mergeSteps(s.steps(), incoming);
        if (s.isReady()) {
            try {
                s.update(runtime.putSteps(s.port, s.token, merged));
                return s.view();
            } catch (RecorderRuntime.CallException e) {
                if (e.status() != 0) {
                    throw translate(s, e);
                }
                s.markClosed("CLOSED", "녹화 컨테이너가 끝났습니다. 기록한 단계는 아직 저장할 수 있습니다.", clock.instant());
            }
        }
        s.replaceSteps(merged);
        return s.view();
    }

    /**
     * 화면이 보낸 단계 목록(삭제 · 순서 · label 수정)을 서버가 가진 목록과 맞춘다.
     * 셀렉터 · 동작 종류는 서버 것만 쓴다 — 생성 코드에 그대로 들어가므로 화면에서 바꾸지 못하게 한다.
     * 값(value)은 비밀번호 단계가 아닐 때만 고칠 수 있다 (코드에는 따옴표로 감싸 들어간다).
     */
    static List<RecordedStep> mergeSteps(List<RecordedStep> current, List<RecordedStep> incoming) {
        if (incoming == null) {
            throw new ApiException(400, "steps 가 필요합니다.");
        }
        Map<String, RecordedStep> byId = new HashMap<>();
        for (RecordedStep step : current) {
            byId.put(step.id(), step);
        }
        Set<String> seen = new HashSet<>();
        List<RecordedStep> out = new ArrayList<>();
        for (RecordedStep in : incoming) {
            RecordedStep base = in == null ? null : byId.get(in.id());
            if (base == null) {
                throw new ApiException(400, "모르는 단계입니다: " + (in == null ? null : in.id()));
            }
            if (!seen.add(base.id())) {
                throw new ApiException(400, "같은 단계가 두 번 들어 있습니다: " + base.id());
            }
            String label = in.label() == null || in.label().isBlank() ? base.label() : truncate(in.label().strip(), 200);
            String value = base.value();
            if (base.secretEnv() == null && VALUE_EDITABLE.contains(base.action()) && in.value() != null) {
                value = truncate(in.value(), MAX_FILL_VALUE);
            }
            out.add(base.withLabelAndValue(label, value));
        }
        return out;
    }

    // ------------------------------------------------------------ 코드 · 저장

    public CodeResponse code(String projectId, String sessionId, User user, String title) {
        RecorderSession s = owned(projectId, sessionId, user);
        s.touch(clock.instant());
        return new CodeResponse(
                RecorderCodeGenerator.suggestSpecPath(title, LocalDateTime.now(clock)),
                RecorderCodeGenerator.generate(title, s.steps(), s.baseUrl));
    }

    public SaveResponse save(String projectId, String sessionId, User user, SaveRequest request) {
        RecorderSession s = owned(projectId, sessionId, user);
        s.touch(clock.instant());
        List<RecordedStep> steps = s.steps();
        if (steps.isEmpty()) {
            throw new ApiException(400, "기록한 단계가 없습니다.");
        }
        String specPath = validateSpecPath(request == null ? null : request.specPath());
        String code = RecorderCodeGenerator.generate(request.title(), steps, s.baseUrl);
        // 경로 제한(프로젝트 밖 · 심볼릭 링크 탈출)은 FileStorageService 가 검사한다.
        Path file = fileStorageService.resolveFile(projectId, specPath);
        synchronized (this) {
            if (Files.exists(file)) {
                throw new ApiException(409, "FILE_EXISTS", "같은 경로에 파일이 이미 있습니다: " + specPath);
            }
            fileStorageService.writeFile(projectId, specPath, code);
        }
        log.info("녹화 테스트 저장. project={}, path={}", projectId, specPath);
        recordToSiteMap(projectId, specPath, s.baseUrl, steps);
        return new SaveResponse(specPath);
    }

    /**
     * 녹화가 지나간 화면과 다룬 요소를 구조 지도에 적는다. 부가 작업이라 실패해도 저장은 그대로 성공한다.
     * 코드에 들어가지 못한(검사를 통과하지 못한) 셀렉터는 지도에도 넣지 않는다.
     */
    private void recordToSiteMap(String projectId, String specPath, String baseUrl, List<RecordedStep> steps) {
        if (recordedFlowService == null) {
            return;
        }
        try {
            List<RecordedFlowService.RecordedAction> actions = steps.stream()
                    .map(step -> new RecordedFlowService.RecordedAction(step.url(),
                            !"goto".equals(step.action()) && RecorderCodeGenerator.isSafeSelector(step.selector())
                                    ? step.selector() : null,
                            step.fragile()))
                    .toList();
            recordedFlowService.record(projectId, specPath, baseUrl, actions);
        } catch (RuntimeException e) {
            log.warn("녹화 테스트를 구조 지도에 반영하지 못했습니다. project={}, path={}: {}", projectId, specPath, e.getMessage());
        }
    }

    static String validateSpecPath(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new ApiException(400, "PATH_NOT_ALLOWED", "저장할 경로가 필요합니다.");
        }
        String path = raw.replace('\\', '/').trim();
        if (path.startsWith("/") || path.contains("..") || path.contains("//") || path.length() > 300) {
            throw new ApiException(400, "PATH_NOT_ALLOWED", "저장할 수 없는 경로입니다: " + raw);
        }
        if (!SPEC_FILE.matcher(path).matches()) {
            throw new ApiException(400, "PATH_NOT_ALLOWED", "테스트 파일 이름은 .spec.ts 처럼 끝나야 합니다: " + raw);
        }
        return path;
    }

    // ------------------------------------------------------------ 내부

    private RecorderSession owned(String projectId, String sessionId, User user) {
        projectService.getProjectForUser(projectId, user);
        RecorderSession s = sessionId == null ? null : sessions.get(sessionId);
        if (s == null || !s.projectId.equals(projectId) || !Objects.equals(s.userId, user.getId())) {
            throw new ApiException(404, "RECORDER_SESSION_NOT_FOUND", "녹화 세션을 찾을 수 없습니다.");
        }
        return s;
    }

    private RecorderSession requireReady(RecorderSession s) {
        if (s.isClosed()) {
            throw new ApiException(409, "RECORDER_CLOSED", "녹화 세션이 끝났습니다. 새로 시작하세요.");
        }
        if (!s.isReady()) {
            throw new ApiException(409, "RECORDER_STARTING", "녹화를 준비하는 중입니다.");
        }
        return s;
    }

    private ApiException translate(RecorderSession s, RecorderRuntime.CallException e) {
        if (e.status() == 0) {
            s.markClosed("CLOSED", "녹화 컨테이너가 끝났습니다. 기록한 단계는 아직 저장할 수 있습니다.", clock.instant());
            return new ApiException(409, "RECORDER_CLOSED", "녹화 세션이 끝났습니다. 새로 시작하세요.");
        }
        if (e.status() == 400 || e.status() == 409) {
            return new ApiException(e.status(), e.getMessage());
        }
        return new ApiException(502, e.getMessage());
    }

    /** 이미 쓰는 포트와 지금 열 수 없는 포트(지우는 중인 컨테이너 등)를 건너뛴다. synchronized 안에서 부른다. */
    int allocatePort() {
        Set<Integer> used = new HashSet<>();
        for (RecorderSession s : sessions.values()) {
            if (!s.isClosed()) {
                used.add(s.port);
            }
        }
        for (int p = PORT_MIN; p <= PORT_MAX; p++) {
            if (!used.contains(p) && runtime.isPortFree(p)) {
                return p;
            }
        }
        throw new ApiException(409, "RECORDER_LIMIT", "녹화에 쓸 빈 포트가 없습니다.");
    }

    private long activeCount() {
        return sessions.values().stream().filter(s -> !s.isClosed()).count();
    }

    static String resolveStartUrl(String url, String baseUrl) {
        String raw = url == null || url.isBlank() ? baseUrl : url.trim();
        if (raw == null) {
            throw new ApiException(400, "시작 주소가 없습니다. 프로젝트 기본 주소(baseUrl)를 설정하거나 url 을 넣으세요.");
        }
        URI uri;
        try {
            uri = URI.create(raw);
            if (!uri.isAbsolute()) {
                if (baseUrl == null) {
                    throw new ApiException(400, "상대 경로를 쓰려면 프로젝트 기본 주소(baseUrl)가 필요합니다: " + raw);
                }
                uri = URI.create(baseUrl.trim()).resolve(raw);
            }
        } catch (IllegalArgumentException e) {
            throw new ApiException(400, "주소 모양이 올바르지 않습니다: " + raw);
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        if (!(scheme.equals("http") || scheme.equals("https")) || uri.getHost() == null) {
            throw new ApiException(400, "http(s) 주소만 열 수 있습니다: " + raw);
        }
        return uri.toString();
    }

    private String randomHex(int bytes) {
        byte[] b = new byte[bytes];
        random.nextBytes(b);
        return HexFormat.of().formatHex(b);
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static String truncate(String s, int max) {
        return s.length() > max ? s.substring(0, max) : s;
    }
}
