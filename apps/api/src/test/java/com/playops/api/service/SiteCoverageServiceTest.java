package com.playops.api.service;

import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.entity.Project;
import com.playops.api.entity.ScenarioOrigin;
import com.playops.api.entity.SiteAnalysisRun;
import com.playops.api.entity.SiteEdge;
import com.playops.api.entity.SiteNode;
import com.playops.api.entity.SiteNodeEdit;
import com.playops.api.repository.ExecutionCaseResultRepository;
import com.playops.api.repository.ScenarioOriginRepository;
import com.playops.api.repository.SiteAnalysisRunRepository;
import com.playops.api.repository.SiteEdgeRepository;
import com.playops.api.repository.SiteNodeEditRepository;
import com.playops.api.repository.SiteNodeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SiteCoverageServiceTest {

    @TempDir
    Path tmp;

    private final ProjectService projectService = mock(ProjectService.class);
    private final SiteNodeRepository nodeRepository = mock(SiteNodeRepository.class);
    private final SiteNodeEditRepository editRepository = mock(SiteNodeEditRepository.class);
    private final SiteEdgeRepository edgeRepository = mock(SiteEdgeRepository.class);
    private final ScenarioOriginRepository originRepository = mock(ScenarioOriginRepository.class);
    private final ExecutionCaseResultRepository caseResultRepository = mock(ExecutionCaseResultRepository.class);
    private final SiteAnalysisRunRepository runRepository = mock(SiteAnalysisRunRepository.class);
    private final Project project = new Project();
    private SiteCoverageService service;

    @BeforeEach
    void setUp() {
        project.setProjectId("p");
        project.setBaseUrl("https://shop.example.com");
        when(projectService.getProject("p")).thenReturn(project);
        when(projectService.getProjectPath(anyString())).thenAnswer(inv -> tmp.resolve((String) inv.getArgument(0)));
        when(editRepository.findByProjectId("p")).thenReturn(List.of());
        when(edgeRepository.findByProjectId("p")).thenReturn(List.of());
        when(originRepository.findByProjectId("p")).thenReturn(List.of());
        when(runRepository.findFirstByProjectIdAndFrameworkOrderByIdDesc("p", "URL")).thenReturn(Optional.empty());
        service = new SiteCoverageService(projectService, new FileStorageService(projectService), nodeRepository,
                editRepository, edgeRepository, originRepository, caseResultRepository, runRepository);
    }

    private static SiteNode node(String route, String origin, String elements) {
        SiteNode node = new SiteNode();
        node.setProjectId("p");
        node.setRouteKey(route);
        node.setOrigin(origin);
        node.setElements(elements);
        return node;
    }

    private static ScenarioOrigin origin(String specPath, String routeKeys, String selectorKeys, String source) {
        ScenarioOrigin origin = new ScenarioOrigin();
        origin.setProjectId("p");
        origin.setSpecPath(specPath);
        origin.setRouteKeys(routeKeys);
        origin.setSelectorKeys(selectorKeys);
        origin.setSource(source);
        return origin;
    }

    private static ExecutionCaseResult result(long executionId, String specPath, String status, String error, Instant at) {
        ExecutionCaseResult result = new ExecutionCaseResult();
        result.setExecutionId(executionId);
        result.setSpecPath(specPath);
        result.setStatus(status);
        result.setErrorMessage(error);
        ReflectionTestUtils.setField(result, "createdAt", at);
        return result;
    }

    private static SiteEdge edge(String from, String to) {
        SiteEdge edge = new SiteEdge();
        edge.setProjectId("p");
        edge.setFromRouteKey(from);
        edge.setToRouteKey(to);
        return edge;
    }

    private static final String CLICK_TIMEOUT = """
            locator.click: Timeout 30000ms exceeded.
            Call log:
              - waiting for getByRole('button', { name: '결제하기' })
            """;

    @Test
    void buildsScreensFlowsEdgesAndSummary() throws Exception {
        SiteNode stale = node("/old", "CODE", "[]");
        stale.setStale(true);
        SiteNode admin = node("/admin", "CODE", "[]");
        admin.setAuthRequired(true);
        when(nodeRepository.findByProjectIdOrderByRouteKey("p")).thenReturn(List.of(
                node("/", "SITE", """
                        [{"role":"link","name":"상품","verification":"PASSED"},
                         {"role":"link","name":"로그인","verification":"OBSERVED"}]"""),
                node("/products", "CODE", """
                        [{"role":"button","name":"담기","verification":"PASSED"},{"testId":"x","verification":"UNVERIFIED"}]"""),
                node("/cart", "CODE", "[{\"role\":\"button\",\"name\":\"결제하기\",\"verification\":\"FAILED\"}]"),
                node("/checkout", "CODE", "[{\"role\":\"heading\",\"name\":\"주문 완료\"}]"),
                node("/login", "SITE", "[{\"type\":\"password\",\"label\":\"비밀번호\",\"verification\":\"OBSERVED\"}]"),
                admin,
                node("/about", "CODE", "[]"),
                node("/faq", "CODE", "[]"),
                node("/hidden", "CODE", "[]"),
                node("/recorded-only", "RECORDED", "[]"),
                stale));
        SiteNodeEdit hidden = new SiteNodeEdit();
        hidden.setRouteKey("/hidden");
        hidden.setExcluded(true);
        when(editRepository.findByProjectId("p")).thenReturn(List.of(hidden));
        when(edgeRepository.findByProjectId("p")).thenReturn(List.of(
                edge("/", "/products"), edge("/products", "/cart"), edge("/old", "/"), edge("/faq", "/about")));
        when(originRepository.findByProjectId("p")).thenReturn(List.of(
                origin("tests/order.spec.ts", "[\"/\",\"/products\",\"/cart\",\"/checkout\"]", "[]", null),
                origin("tests/recorded/browse.spec.ts", "[\"/\",\"/products\"]", "[]", "RECORDED"),
                origin("tests/bootstrap.spec.ts", "[]", "[\"role|link|로그인\",\"role|link|없음\"]", null)));
        Instant t9 = Instant.parse("2026-11-01T01:00:00Z");
        Instant t10 = Instant.parse("2026-11-01T02:00:00Z");
        when(caseResultRepository.findLatestBySpecPaths(eq("p"), anyCollection())).thenReturn(List.of(
                result(9, "order.spec.ts", "PASSED", null, t9),
                result(9, "order.spec.ts", "FAILED", CLICK_TIMEOUT, t9),
                result(10, "recorded/browse.spec.ts", "PASSED", null, t10)));
        SiteAnalysisRun run = new SiteAnalysisRun();
        run.setStatus("COMPLETED");
        run.setFramework("URL");
        run.setFinishedAt(t9);
        run.setWarnings("""
                ["열기 실패: https://shop.example.com/about — net::ERR_ABORTED",
                 "페이지 수 상한(20)에 도달했습니다. 남은 대기 3건",
                 "로그인 화면에서 탐색이 멈췄습니다. 로그인 계정(아이디·비밀번호)을 입력하고 다시 탐색하거나 화면을 직접 추가하세요."]""");
        when(runRepository.findFirstByProjectIdAndFrameworkOrderByIdDesc("p", "URL")).thenReturn(Optional.of(run));
        Files.createDirectories(tmp.resolve("p/tests"));
        Files.writeString(tmp.resolve("p/tests/order.spec.ts"), "import { test } from '@playwright/test';\ntest('상품을 담고 결제한다', async () => {});\n");

        SiteCoverageService.Coverage coverage = service.view("p");

        Map<String, SiteCoverageService.CoverageNode> nodes = coverage.nodes().stream()
                .collect(Collectors.toMap(SiteCoverageService.CoverageNode::routeKey, Function.identity()));
        // 제외한 화면 · 사라진 화면은 지도에 없다.
        assertThat(nodes).doesNotContainKeys("/hidden", "/old");
        assertThat(nodes.get("/").state()).isEqualTo("TESTED");
        assertThat(nodes.get("/products").state()).isEqualTo("TESTED");
        assertThat(nodes.get("/cart").state()).isEqualTo("BLOCKED");
        assertThat(nodes.get("/checkout").state()).isEqualTo("UNSEEN");
        assertThat(nodes.get("/login").state()).isEqualTo("BLOCKED");
        assertThat(nodes.get("/admin").state()).isEqualTo("BLOCKED");
        assertThat(nodes.get("/about").state()).isEqualTo("BLOCKED");
        assertThat(nodes.get("/faq").state()).isEqualTo("UNSEEN");
        assertThat(nodes.get("/recorded-only").state()).isEqualTo("OBSERVED");

        SiteCoverageService.CoverageIssue cartIssue = nodes.get("/cart").issues().get(0);
        assertThat(cartIssue.kind()).isEqualTo("SELECTOR_FAILED");
        assertThat(cartIssue.message()).isEqualTo("'결제하기' 버튼을 찾지 못했습니다");
        assertThat(cartIssue.selector()).isEqualTo("getByRole('button', { name: '결제하기' })");
        assertThat(cartIssue.specPath()).isEqualTo("tests/order.spec.ts");
        assertThat(cartIssue.executionId()).isEqualTo(9L);
        assertThat(cartIssue.action()).isEqualTo("FIX_WITH_AI");
        assertThat(nodes.get("/checkout").issues()).extracting(SiteCoverageService.CoverageIssue::kind).containsExactly("NOT_REACHED");
        assertThat(nodes.get("/login").issues()).extracting(SiteCoverageService.CoverageIssue::kind, SiteCoverageService.CoverageIssue::action)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("LOGIN_REQUIRED", "SET_LOGIN"));
        assertThat(nodes.get("/admin").issues()).extracting(SiteCoverageService.CoverageIssue::kind).containsExactly("LOGIN_REQUIRED");
        assertThat(nodes.get("/about").issues()).extracting(SiteCoverageService.CoverageIssue::kind, SiteCoverageService.CoverageIssue::action)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("OPEN_FAILED", "RERUN"));
        assertThat(nodes.get("/faq").issues()).isEmpty();

        // 요소 집계: 통과 · 실패 · 화면에서 확인됨 · 아직 안 봄
        assertThat(nodes.get("/").counts()).isEqualTo(new SiteCoverageService.Counts(1, 0, 1, 0, 2));
        assertThat(nodes.get("/products").counts()).isEqualTo(new SiteCoverageService.Counts(1, 0, 0, 1, 2));
        assertThat(nodes.get("/checkout").counts()).isEqualTo(new SiteCoverageService.Counts(0, 0, 0, 1, 1));

        assertThat(coverage.flows()).extracting(SiteCoverageService.CoverageFlow::specPath)
                .containsExactly("tests/recorded/browse.spec.ts", "tests/order.spec.ts", "tests/bootstrap.spec.ts");
        SiteCoverageService.CoverageFlow order = coverage.flows().get(1);
        assertThat(order.title()).isEqualTo("상품을 담고 결제한다");
        assertThat(order.source()).isEqualTo("PATH");
        assertThat(order.lastStatus()).isEqualTo("FAILED");
        assertThat(order.executionId()).isEqualTo(9L);
        assertThat(order.steps()).extracting(SiteCoverageService.FlowStep::state)
                .containsExactly("PASSED", "PASSED", "FAILED", "NOT_REACHED");
        assertThat(order.steps().get(2).message()).isEqualTo("'결제하기' 버튼을 찾지 못했습니다");
        SiteCoverageService.CoverageFlow browse = coverage.flows().get(0);
        assertThat(browse.title()).isEqualTo("browse.spec.ts");
        assertThat(browse.source()).isEqualTo("RECORDED");
        assertThat(browse.lastStatus()).isEqualTo("PASSED");
        SiteCoverageService.CoverageFlow bootstrap = coverage.flows().get(2);
        assertThat(bootstrap.source()).isEqualTo("GENERATED");
        assertThat(bootstrap.lastStatus()).isEqualTo("NEVER_RUN");
        assertThat(bootstrap.steps()).extracting(SiteCoverageService.FlowStep::routeKey, SiteCoverageService.FlowStep::state)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("/", "PENDING"));

        assertThat(coverage.edges()).extracting(e -> e.from() + ">" + e.to() + ":" + e.state())
                .containsExactly("/>/products:TESTED", "/products>/cart:FAILED", "/faq>/about:UNKNOWN");

        assertThat(coverage.summary()).isEqualTo(new SiteCoverageService.Summary(9, 2, 1, 2, 4, 3, t10));
    }

    @Test
    void recordedFlowFailureSuggestsRecordingAgainAndLoginIdSilencesAuthIssue() {
        project.setEnvVariables("{\"LOGIN_ID\":\"demo\"}");
        SiteNode admin = node("/admin", "CODE", "[{\"role\":\"button\",\"name\":\"결제하기\"}]");
        admin.setAuthRequired(true);
        when(nodeRepository.findByProjectIdOrderByRouteKey("p")).thenReturn(List.of(node("/", "SITE", "[]"), admin));
        when(originRepository.findByProjectId("p")).thenReturn(List.of(
                origin("tests/recorded/a.spec.ts", "[\"/\",\"/admin\"]", "[]", "RECORDED")));
        when(caseResultRepository.findLatestBySpecPaths(eq("p"), anyCollection())).thenReturn(List.of(
                result(3, "tests/recorded/a.spec.ts", "FAILED", CLICK_TIMEOUT, Instant.parse("2026-11-01T00:00:00Z"))));

        SiteCoverageService.Coverage coverage = service.view("p");

        SiteCoverageService.CoverageNode adminNode = coverage.nodes().get(1);
        assertThat(adminNode.issues()).extracting(SiteCoverageService.CoverageIssue::kind, SiteCoverageService.CoverageIssue::action)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("SELECTOR_FAILED", "RECORD_AGAIN"));
        assertThat(coverage.nodes().get(0).state()).isEqualTo("TESTED");
    }

    @Test
    void flowWithoutRoutesStillPinsTheFailureOnTheScreenThatHasTheSelector() {
        when(nodeRepository.findByProjectIdOrderByRouteKey("p")).thenReturn(List.of(
                node("/", "CODE", "[]"),
                node("/cart", "CODE", "[{\"role\":\"button\",\"name\":\"결제하기\"}]")));
        when(originRepository.findByProjectId("p")).thenReturn(List.of(origin("tests/bootstrap.spec.ts", "[]", "[]", null)));
        when(caseResultRepository.findLatestBySpecPaths(eq("p"), anyCollection())).thenReturn(List.of(
                result(1, "bootstrap.spec.ts", "FAILED", CLICK_TIMEOUT, Instant.now())));

        SiteCoverageService.Coverage coverage = service.view("p");

        assertThat(coverage.flows().get(0).steps()).isEmpty();
        assertThat(coverage.nodes().get(1).state()).isEqualTo("BLOCKED");
        assertThat(coverage.nodes().get(0).state()).isEqualTo("UNSEEN");
    }

    @Test
    void largeMapIsComputedQuicklyWithOneResultQuery() {
        List<SiteNode> nodes = new ArrayList<>();
        for (int i = 0; i < 100; i++) {
            StringBuilder elements = new StringBuilder("[");
            for (int j = 0; j < 30; j++) {
                elements.append(j == 0 ? "" : ",").append("{\"role\":\"button\",\"name\":\"b").append(i).append('-').append(j)
                        .append("\",\"verification\":\"").append(j % 3 == 0 ? "OBSERVED" : "UNVERIFIED").append("\"}");
            }
            nodes.add(node("/s" + i, i % 2 == 0 ? "SITE" : "CODE", elements.append(']').toString()));
        }
        when(nodeRepository.findByProjectIdOrderByRouteKey("p")).thenReturn(nodes);
        List<ScenarioOrigin> origins = new ArrayList<>();
        List<ExecutionCaseResult> results = new ArrayList<>();
        for (int f = 0; f < 50; f++) {
            StringBuilder routes = new StringBuilder("[");
            for (int k = 0; k < 6; k++) {
                routes.append(k == 0 ? "" : ",").append("\"/s").append((f + k * 7) % 100).append('"');
            }
            origins.add(origin("tests/flow" + f + ".spec.ts", routes.append(']').toString(), "[]", null));
            results.add(result(f, "flow" + f + ".spec.ts", f % 4 == 0 ? "FAILED" : "PASSED",
                    "locator.click: Timeout 30000ms exceeded.\n  - waiting for getByRole('button', { name: 'b" + ((f + 14) % 100) + "-1' })",
                    Instant.now()));
        }
        when(originRepository.findByProjectId("p")).thenReturn(origins);
        when(caseResultRepository.findLatestBySpecPaths(eq("p"), anyCollection())).thenReturn(results);

        service.view("p"); // 클래스 로딩 · JIT 를 덜어 낸다
        long started = System.nanoTime();
        SiteCoverageService.Coverage coverage = service.view("p");
        long elapsedMs = (System.nanoTime() - started) / 1_000_000;

        assertThat(coverage.nodes()).hasSize(100);
        assertThat(coverage.flows()).hasSize(50);
        assertThat(coverage.summary().blocked()).isPositive();
        assertThat(elapsedMs).isLessThan(1000);
        verify(caseResultRepository, times(2)).findLatestBySpecPaths(eq("p"), anyCollection());
    }
}
