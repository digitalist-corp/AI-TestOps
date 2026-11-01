package com.playops.api.recorder;

import com.playops.api.config.PlayOpsProperties;
import com.playops.api.entity.Project;
import com.playops.api.entity.User;
import com.playops.api.exception.ApiException;
import com.playops.api.recorder.RecorderDtos.CreateSessionRequest;
import com.playops.api.recorder.RecorderDtos.RecordedStep;
import com.playops.api.recorder.RecorderDtos.RecorderState;
import com.playops.api.recorder.RecorderDtos.SaveRequest;
import com.playops.api.service.FileStorageService;
import com.playops.api.service.LoginSessionService;
import com.playops.api.service.ProjectService;
import com.playops.api.service.RecordedFlowService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class RecorderServiceTest {

    @TempDir
    Path tmp;

    private ProjectService projectService;
    private FakeRuntime runtime;
    private MutableClock clock;
    private RecorderService service;
    private RecordedFlowService recordedFlowService;

    @BeforeEach
    void setUp() {
        projectService = mock(ProjectService.class);
        Project project = new Project();
        project.setProjectId("p1");
        project.setBaseUrl("https://shop.example.com");
        when(projectService.getProjectForUser(anyString(), any())).thenReturn(project);
        when(projectService.getProjectPath(anyString())).thenAnswer(inv -> tmp.resolve("projects").resolve((String) inv.getArgument(0)));
        PlayOpsProperties props = new PlayOpsProperties(tmp.resolve("projects").toString(), tmp.resolve("storage").toString(), true, null);
        runtime = new FakeRuntime();
        clock = new MutableClock(Instant.parse("2026-11-01T00:00:00Z"));
        recordedFlowService = mock(RecordedFlowService.class);
        service = new RecorderService(projectService, new FileStorageService(projectService),
                new LoginSessionService(props), runtime, recordedFlowService, props, clock, Runnable::run);
    }

    private static User user(long id) {
        User u = new User();
        u.setId(id);
        return u;
    }

    private RecorderState start(long userId) {
        return service.create("p1", user(userId), new CreateSessionRequest(null, false));
    }

    // ------------------------------------------------------------ 상한

    @Test
    void startsContainerAndBecomesReady() {
        RecorderState state = start(1);

        assertThat(state.status()).isEqualTo("READY");
        assertThat(state.sessionId()).isNotBlank();
        assertThat(state.steps()).hasSize(1);
        RecorderRuntime.ContainerSpec spec = runtime.started.get(0);
        assertThat(spec.containerName()).isEqualTo("rec-" + state.sessionId());
        assertThat(spec.startUrl()).isEqualTo("https://shop.example.com");
        assertThat(spec.baseUrl()).isEqualTo("https://shop.example.com");
        assertThat(spec.token()).hasSize(32);
        assertThat(spec.storageStateFile()).isNull();
    }

    @Test
    void sameUserNewSessionClosesPrevious() {
        RecorderState first = start(1);
        RecorderState second = start(1);

        assertThat(service.get("p1", first.sessionId(), user(1)).status()).isEqualTo("CLOSED");
        assertThat(service.get("p1", second.sessionId(), user(1)).status()).isEqualTo("READY");
        assertThat(runtime.removed).contains("rec-" + first.sessionId());
    }

    @Test
    void totalLimitIsTwo() {
        assertThat(RecorderService.MAX_TOTAL).isEqualTo(2);
        start(1);
        start(2);

        assertThatThrownBy(() -> start(3))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(409));
    }

    @Test
    void closedSessionFreesSlot() {
        List<RecorderState> states = new ArrayList<>();
        for (long u = 1; u <= RecorderService.MAX_TOTAL; u++) {
            states.add(start(u));
        }
        service.close("p1", states.get(0).sessionId(), user(1));

        assertThat(start(99).status()).isEqualTo("READY");
    }

    // ------------------------------------------------------------ 포트

    @Test
    void allocatesFreePortsSkippingBusyOnes() {
        runtime.busyPorts.add(9400);
        RecorderState a = start(1);
        RecorderState b = start(2);

        assertThat(runtime.portOf(a.sessionId())).isEqualTo(9401);
        assertThat(runtime.portOf(b.sessionId())).isEqualTo(9402);

        // 닫힌 세션의 포트는 다시 쓸 수 있다 (컨테이너가 아직 지워지는 중이면 isPortFree 가 걸러 낸다).
        service.close("p1", a.sessionId(), user(1));
        RecorderState c = start(3);
        assertThat(runtime.portOf(c.sessionId())).isEqualTo(9401);
    }

    @Test
    void noFreePortIsConflict() {
        for (int p = RecorderService.PORT_MIN; p <= RecorderService.PORT_MAX; p++) {
            runtime.busyPorts.add(p);
        }
        assertThatThrownBy(() -> start(1)).isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(409));
    }

    // ------------------------------------------------------------ 소유권

    @Test
    void otherUsersSessionIsNotFound() {
        RecorderState mine = start(1);

        assertStatus(() -> service.get("p1", mine.sessionId(), user(2)), 404);
        assertStatus(() -> service.action("p1", mine.sessionId(), user(2), Map.of("type", "scroll", "deltaY", 100)), 404);
        assertStatus(() -> service.close("p1", mine.sessionId(), user(2)), 404);
        assertStatus(() -> service.get("other-project", mine.sessionId(), user(1)), 404);
        assertStatus(() -> service.get("p1", "nope", user(1)), 404);
    }

    @Test
    void projectWithoutAccessIsForbidden() {
        RecorderState mine = start(1);
        when(projectService.getProjectForUser(eq("p1"), any()))
                .thenThrow(new ApiException(403, "FORBIDDEN", "해당 프로젝트에 접근할 권한이 없습니다."));

        assertStatus(() -> service.get("p1", mine.sessionId(), user(1)), 403);
        assertStatus(() -> start(1), 403);
    }

    // ------------------------------------------------------------ 동작 · 단계

    @Test
    void actionIsForwardedAndUnknownTypeRejected() {
        RecorderState s = start(1);

        RecorderState after = service.action("p1", s.sessionId(), user(1), Map.of("type", "click", "x", 10, "y", 20));
        assertThat(after.steps()).hasSize(2);
        assertThat(runtime.actions).hasSize(1);

        assertStatus(() -> service.action("p1", s.sessionId(), user(1), Map.of("type", "evaluate")), 400);
        assertThat(runtime.actions).hasSize(1);
    }

    @Test
    void mergeKeepsServerSelectorsAndAppliesLabelOrderDelete() {
        List<RecordedStep> current = List.of(
                new RecordedStep("a", "goto", null, false, "열기", "/", null, "u"),
                new RecordedStep("b", "fill", "getByLabel('이메일')", false, "이메일", "x@y", null, "u"),
                new RecordedStep("c", "fill", "getByLabel('비밀번호')", false, "비밀번호", null, "LOGIN_PASSWORD", "u"),
                new RecordedStep("d", "click", "getByRole('button')", false, "클릭", null, null, "u"));
        List<RecordedStep> incoming = List.of(
                new RecordedStep("d", "click", "evaluate(() => 1)", true, "  로그인 누르기 ", null, null, null),
                new RecordedStep("c", "fill", null, false, "", "hunter2", null, null),
                new RecordedStep("b", "fill", null, false, null, "new@y", null, null));

        List<RecordedStep> merged = RecorderService.mergeSteps(current, incoming);

        assertThat(merged).extracting(RecordedStep::id).containsExactly("d", "c", "b");
        assertThat(merged.get(0).selector()).isEqualTo("getByRole('button')");
        assertThat(merged.get(0).fragile()).isFalse();
        assertThat(merged.get(0).label()).isEqualTo("로그인 누르기");
        assertThat(merged.get(1).label()).isEqualTo("비밀번호");
        assertThat(merged.get(1).value()).isNull();          // 비밀번호 값은 받지 않는다
        assertThat(merged.get(2).value()).isEqualTo("new@y");

        assertStatus(() -> RecorderService.mergeSteps(current, List.of(
                new RecordedStep("zzz", "click", null, false, null, null, null, null))), 400);
        assertStatus(() -> RecorderService.mergeSteps(current, List.of(
                new RecordedStep("a", "goto", null, false, null, null, null, null),
                new RecordedStep("a", "goto", null, false, null, null, null, null))), 400);
    }

    // ------------------------------------------------------------ 유휴 종료

    @Test
    void idleSessionIsStoppedButCodeStillAvailable() {
        RecorderState s = start(1);
        clock.advance(Duration.ofMinutes(9));
        service.sweep();
        assertThat(runtime.removed).isEmpty();

        clock.advance(Duration.ofMinutes(2));
        service.sweep();

        assertThat(runtime.removed).containsExactly("rec-" + s.sessionId());
        assertThat(service.get("p1", s.sessionId(), user(1)).status()).isEqualTo("CLOSED");
        assertThat(service.code("p1", s.sessionId(), user(1), "t").code()).contains("await page.goto('/');");
        assertStatus(() -> service.action("p1", s.sessionId(), user(1), Map.of("type", "scroll", "deltaY", 1)), 409);

        clock.advance(RecorderService.KEEP_CLOSED.plusMinutes(1));
        service.sweep();
        assertStatus(() -> service.get("p1", s.sessionId(), user(1)), 404);
    }

    @Test
    void bootFailureEndsInError() {
        runtime.failStart = true;
        RecorderState s = start(1);

        RecorderState view = service.get("p1", s.sessionId(), user(1));
        assertThat(view.status()).isEqualTo("ERROR");
        assertThat(view.error()).contains("docker 실패");
        assertThat(runtime.removed).contains("rec-" + s.sessionId());
        // 실패한 세션은 상한에 세지 않는다
        for (long u = 2; u <= RecorderService.MAX_TOTAL + 1; u++) {
            runtime.failStart = false;
            start(u);
        }
    }

    // ------------------------------------------------------------ 저장

    @Test
    void savesCodeToProjectFile() throws Exception {
        RecorderState s = start(1);

        String saved = service.save("p1", s.sessionId(), user(1), new SaveRequest("tests/recorded/login.spec.ts", "로그인")).specPath();

        Path file = tmp.resolve("projects/p1/tests/recorded/login.spec.ts");
        assertThat(saved).isEqualTo("tests/recorded/login.spec.ts");
        assertThat(Files.readString(file)).contains("test('로그인'").contains("await page.goto('/');");
    }

    @Test
    @SuppressWarnings("unchecked")
    void saveRecordsVisitedScreensToSiteMapWithOnlySafeSelectors() {
        RecorderState s = start(1);
        service.action("p1", s.sessionId(), user(1), Map.of("type", "click", "x", 1, "y", 1));

        service.save("p1", s.sessionId(), user(1), new SaveRequest("tests/recorded/x.spec.ts", null));

        org.mockito.ArgumentCaptor<List<RecordedFlowService.RecordedAction>> actions =
                org.mockito.ArgumentCaptor.forClass(List.class);
        org.mockito.Mockito.verify(recordedFlowService).record(eq("p1"), eq("tests/recorded/x.spec.ts"),
                eq("https://shop.example.com"), actions.capture());
        assertThat(actions.getValue()).extracting(RecordedFlowService.RecordedAction::selector)
                .containsExactly(null, "getByText('x')");
    }

    @Test
    void saveSucceedsEvenIfSiteMapUpdateFails() {
        RecorderState s = start(1);
        org.mockito.Mockito.doThrow(new IllegalStateException("db"))
                .when(recordedFlowService).record(anyString(), anyString(), any(), any());

        assertThat(service.save("p1", s.sessionId(), user(1), new SaveRequest("tests/recorded/y.spec.ts", null)).specPath())
                .isEqualTo("tests/recorded/y.spec.ts");
    }

    @Test
    void saveRejectsExistingAndBadPaths() throws Exception {
        RecorderState s = start(1);
        Path existing = tmp.resolve("projects/p1/tests/a.spec.ts");
        Files.createDirectories(existing.getParent());
        Files.writeString(existing, "keep");

        assertStatus(() -> service.save("p1", s.sessionId(), user(1), new SaveRequest("tests/a.spec.ts", null)), 409);
        assertThat(Files.readString(existing)).isEqualTo("keep");
        assertStatus(() -> service.save("p1", s.sessionId(), user(1), new SaveRequest("../escape.spec.ts", null)), 400);
        assertStatus(() -> service.save("p1", s.sessionId(), user(1), new SaveRequest("/etc/x.spec.ts", null)), 400);
        assertStatus(() -> service.save("p1", s.sessionId(), user(1), new SaveRequest("tests/notes.txt", null)), 400);
        assertStatus(() -> service.save("p1", s.sessionId(), user(1), new SaveRequest(".env.spec.ts/../x", null)), 400);
        assertStatus(() -> service.save("p1", s.sessionId(), user(1), new SaveRequest(" ", null)), 400);
    }

    // ------------------------------------------------------------ 기타

    @Test
    void resolvesStartUrl() {
        assertThat(RecorderService.resolveStartUrl(null, "https://a.com")).isEqualTo("https://a.com");
        assertThat(RecorderService.resolveStartUrl("/login", "https://a.com/app/")).isEqualTo("https://a.com/login");
        assertThat(RecorderService.resolveStartUrl("https://b.com/x", null)).isEqualTo("https://b.com/x");
        assertStatus(() -> RecorderService.resolveStartUrl(null, null), 400);
        assertStatus(() -> RecorderService.resolveStartUrl("file:///etc/passwd", "https://a.com"), 400);
        assertStatus(() -> RecorderService.resolveStartUrl("/login", null), 400);
    }

    @Test
    void containerArgsHaveNoVolumesAndRunRecordJs() {
        var spec = new RecorderRuntime.ContainerSpec("rec-abc", 9401, "tok", "https://a.com", "https://a.com", Path.of("/storage/auth/p1/storage-state.json"));

        List<String> args = DockerRecorderRuntime.containerArgs("create", spec, "img:1", "container:playops-api");

        assertThat(args).startsWith("docker", "create", "--rm", "--name", "rec-abc", "--network", "container:playops-api");
        assertThat(args).contains("RECORDER_PORT=9401", "RECORDER_TOKEN=tok", "RECORDER_START_URL=https://a.com",
                "RECORDER_STORAGE_STATE=" + DockerRecorderRuntime.STORAGE_STATE_IN_CONTAINER);
        assertThat(args).doesNotContain("-v", "--volumes-from", "-d");
        assertThat(args).endsWith("img:1", "node", "/ai-runner/record.js");
        assertThat(DockerRecorderRuntime.containerArgs("run", spec, "img:1", "n")).containsSequence("docker", "run", "-d");
    }

    private static void assertStatus(Runnable call, int status) {
        assertThatThrownBy(call::run).isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(status));
    }

    // ------------------------------------------------------------ 가짜

    static class FakeRuntime implements RecorderRuntime {
        final List<ContainerSpec> started = new ArrayList<>();
        final List<String> removed = new ArrayList<>();
        final List<Map<String, Object>> actions = new ArrayList<>();
        final Set<Integer> busyPorts = new HashSet<>();
        boolean failStart;
        private final Map<Integer, List<RecordedStep>> stepsByPort = new java.util.HashMap<>();

        int portOf(String sessionId) {
            return started.stream().filter(s -> s.containerName().equals("rec-" + sessionId)).findFirst().orElseThrow().port();
        }

        @Override
        public void ensureImage() {
        }

        @Override
        public void start(ContainerSpec spec) {
            if (failStart) {
                throw new ApiException(500, "docker 실패");
            }
            started.add(spec);
            stepsByPort.put(spec.port(), new ArrayList<>(List.of(
                    new RecordedStep("g", "goto", null, false, "/ 열기", "/", null, spec.startUrl()))));
        }

        @Override
        public void remove(String containerName) {
            removed.add(containerName);
        }

        @Override
        public List<String> listContainers(String prefix) {
            return started.stream().map(ContainerSpec::containerName).filter(n -> n.startsWith(prefix)).toList();
        }

        @Override
        public boolean isPortFree(int port) {
            return !busyPorts.contains(port);
        }

        private RecorderState state(int port) {
            return new RecorderState(null, "READY", "https://shop.example.com/", "t", null,
                    List.copyOf(stepsByPort.get(port)), 1, null, null);
        }

        @Override
        public RecorderState state(int port, String token) {
            return state(port);
        }

        @Override
        public byte[] screenshot(int port, String token) {
            return new byte[]{1};
        }

        @Override
        public RecorderState action(int port, String token, Map<String, Object> action) {
            actions.add(action);
            stepsByPort.get(port).add(new RecordedStep("s" + actions.size(), "click", "getByText('x')", false, "x", null, null, "u"));
            return state(port);
        }

        @Override
        public RecorderState putSteps(int port, String token, List<RecordedStep> steps) {
            stepsByPort.put(port, new ArrayList<>(steps));
            return state(port);
        }
    }

    static class MutableClock extends Clock {
        private Instant now;

        MutableClock(Instant now) {
            this.now = now;
        }

        void advance(Duration d) {
            now = now.plus(d);
        }

        @Override
        public ZoneId getZone() {
            return ZoneId.of("UTC");
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }
}
