package com.playops.api.service;

import com.playops.api.entity.SiteNode;
import com.playops.api.entity.SiteEdge;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.entity.ScenarioOrigin;
import com.playops.api.repository.ExecutionCaseResultRepository;
import com.playops.api.repository.ScenarioOriginRepository;
import com.playops.api.repository.SiteEdgeRepository;
import com.playops.api.repository.SiteNodeEditRepository;
import com.playops.api.repository.SiteNodeRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SiteAnalysisServiceTest {

    private static final String SHA_A = "a".repeat(40);
    private static final String SHA_B = "b".repeat(40);

    private final SiteNodeRepository nodeRepository = mock(SiteNodeRepository.class);
    private final SiteEdgeRepository edgeRepository = mock(SiteEdgeRepository.class);
    private final ScenarioOriginRepository originRepository = mock(ScenarioOriginRepository.class);
    private final ExecutionCaseResultRepository caseResultRepository = mock(ExecutionCaseResultRepository.class);
    private final SiteNodeEditRepository editRepository = mock(SiteNodeEditRepository.class);
    private final SiteAnalysisService service = new SiteAnalysisService(
            null, null, null, null, null, null, new ScreenFinder(), null, null, nodeRepository, editRepository, edgeRepository,
            originRepository, null, null, null, caseResultRepository);

    private static SiteNode node(String routeKey, String firstSeen) {
        SiteNode node = new SiteNode();
        node.setProjectId("p");
        node.setRouteKey(routeKey);
        node.setFirstSeenCommit(firstSeen);
        node.setLastSeenCommit(firstSeen);
        return node;
    }

    @Test
    @SuppressWarnings("unchecked")
    void reanalysisKeepsSameScreenAndMarksMissingOnesStaleInsteadOfDeleting() {
        SiteNode login = node("/login", SHA_A);
        SiteNode removed = node("/legacy", SHA_A);
        when(nodeRepository.findByProjectIdOrderByRouteKey("p")).thenReturn(List.of(login, removed));

        service.mergeNodes("p", List.of(
                new ScreenFinder.Screen("/login", "src/pages/Login.tsx"),
                new ScreenFinder.Screen("/signup", "src/pages/Signup.tsx")), SHA_B);

        ArgumentCaptor<List<SiteNode>> saved = ArgumentCaptor.forClass(List.class);
        verify(nodeRepository).saveAll(saved.capture());
        Map<String, SiteNode> byRoute = saved.getValue().stream()
                .collect(Collectors.toMap(SiteNode::getRouteKey, n -> n));

        assertThat(byRoute.get("/login")).isSameAs(login);
        assertThat(login.getFirstSeenCommit()).isEqualTo(SHA_A);
        assertThat(login.getLastSeenCommit()).isEqualTo(SHA_B);
        assertThat(login.isStale()).isFalse();

        assertThat(byRoute.get("/signup").getFirstSeenCommit()).isEqualTo(SHA_B);
        assertThat(byRoute.get("/legacy").isStale()).isTrue();
        assertThat(byRoute.get("/legacy").getLastSeenCommit()).isEqualTo(SHA_A);
    }

    @Test
    void nodeDetailCountsVerificationAndListsTestsMadeFromTheScreen() {
        SiteNode login = node("/login", SHA_A);
        login.setAuthRequired(true);
        login.setElements("""
                [{"selector":"a","verification":"PASSED"},{"selector":"b","verification":"FAILED"},
                 {"selector":"c","verification":"OBSERVED"},{"selector":"d","verification":"UNVERIFIED"}]
                """);
        when(nodeRepository.findByProjectIdOrderByRouteKey("p")).thenReturn(List.of(login));
        ScenarioOrigin flow = new ScenarioOrigin();
        flow.setSpecPath("tests/login-flow.spec.ts");
        flow.setRouteKeys("[\"/login\",\"/projects\",\"/login\"]");
        ScenarioOrigin other = new ScenarioOrigin();
        other.setSpecPath("tests/other.spec.ts");
        other.setRouteKeys("[\"/projects\"]");
        ScenarioOrigin never = new ScenarioOrigin();
        never.setSpecPath("tests/never.spec.ts");
        never.setRouteKeys("[\"/login\"]");
        when(originRepository.findByProjectId("p")).thenReturn(List.of(flow, other, never));
        when(caseResultRepository.findTop100BySpecPathInOrderByIdDesc(anyCollection())).thenAnswer(inv -> {
            java.util.Collection<String> paths = inv.getArgument(0);
            if (!paths.contains("login-flow.spec.ts")) {
                return List.of();
            }
            return List.of(caseResult(9L, "FAILED"), caseResult(9L, "PASSED"), caseResult(3L, "PASSED"));
        });

        SiteAnalysisService.NodeDetail detail = service.viewNode("p", "/login");

        assertThat(detail.node().authRequired()).isTrue();
        assertThat(detail.node().passedCount()).isEqualTo(1);
        assertThat(detail.node().failedCount()).isEqualTo(1);
        assertThat(detail.node().unverifiedCount()).isEqualTo(2);
        assertThat(detail.tests()).extracting(SiteAnalysisService.ScreenTestSummary::specPath)
                .containsExactly("tests/login-flow.spec.ts", "tests/never.spec.ts");
        SiteAnalysisService.ScreenTestSummary latest = detail.tests().get(0);
        assertThat(latest.executionId()).isEqualTo(9L);
        assertThat(latest.lastStatus()).isEqualTo("FAILED");
        assertThat(latest.passedCases()).isEqualTo(1);
        assertThat(latest.failedCases()).isEqualTo(1);
        assertThat(detail.tests().get(1).lastStatus()).isNull();
    }

    private static ExecutionCaseResult caseResult(Long executionId, String status) {
        ExecutionCaseResult result = new ExecutionCaseResult();
        result.setExecutionId(executionId);
        result.setSpecPath("login-flow.spec.ts");
        result.setStatus(status);
        return result;
    }

    @Test
    void buildsSelectorsAndCarriesOverVerificationOfUnchangedSelectors() throws IOException {
        SiteNode login = node("/login", SHA_A);
        login.setElements("[{\"selector\":\"getByTestId('login-email')\",\"verification\":\"PASSED\"}]");

        service.applyExtraction(login, new ScreenExtractor.Extraction("로그인", false,
                new java.util.ArrayList<>(List.of(
                        new java.util.HashMap<>(Map.of("testId", "login-email")),
                        new java.util.HashMap<>(Map.of("role", "button", "name", "로그인")))),
                List.of(Map.of("to", "/signup"))), "hash-1");

        assertThat(login.getTitle()).isEqualTo("로그인");
        assertThat(login.getContentHash()).isEqualTo("hash-1");
        assertThat(login.getElements())
                .contains("\"selector\":\"getByTestId('login-email')\"").contains("\"verification\":\"PASSED\"")
                .contains("getByRole('button', { name: '로그인', exact: true })").contains("\"verification\":\"UNVERIFIED\"");
        assertThat(login.getLinks()).contains("/signup");
    }

    @Test
    void estimatesRemainingTimeOnlyAfterAtLeastOneScreenIsRead() {
        java.time.Instant now = java.time.Instant.parse("2026-10-09T10:00:30Z");
        com.playops.api.entity.SiteAnalysisRun run = new com.playops.api.entity.SiteAnalysisRun();
        org.springframework.test.util.ReflectionTestUtils.setField(run, "startedAt", now.minusSeconds(30));
        run.setScreenCount(9);

        assertThat(SiteAnalysisService.etaSeconds(run, now)).isNull();      // 아직 하나도 못 읽음

        run.setProcessedCount(3);                                           // 30초에 3개 → 남은 6개는 60초
        org.springframework.test.util.ReflectionTestUtils.setField(run, "progressAt", now);
        assertThat(SiteAnalysisService.etaSeconds(run, now)).isEqualTo(60L);
        // 다음 화면을 기다리는 동안에는 줄어든다. 예상보다 오래 걸려도 0 아래로 가지 않는다.
        assertThat(SiteAnalysisService.etaSeconds(run, now.plusSeconds(8))).isEqualTo(52L);
        assertThat(SiteAnalysisService.etaSeconds(run, now.plusSeconds(500))).isEqualTo(1L);

        run.setProcessedCount(9);
        assertThat(SiteAnalysisService.etaSeconds(run, now)).isNull();      // 다 읽음

        run.setProcessedCount(3);
        org.springframework.test.util.ReflectionTestUtils.setField(run, "progressAt", now);
        run.setStatus(com.playops.api.entity.SiteAnalysisRun.COMPLETED);
        assertThat(SiteAnalysisService.etaSeconds(run, now)).isNull();      // 진행 중이 아님
    }

    @Test
    void readsCommitFromLooseRefPackedRefAndDetachedHead(@TempDir Path repo) throws IOException {
        Path git = Files.createDirectories(repo.resolve(".git/refs/heads"));
        Files.writeString(repo.resolve(".git/HEAD"), "ref: refs/heads/main\n");
        Files.writeString(git.resolve("main"), SHA_A + "\n");
        assertThat(SiteAnalysisService.readCommitSha(repo)).isEqualTo(SHA_A);

        Files.delete(git.resolve("main"));
        Files.writeString(repo.resolve(".git/packed-refs"), "# pack-refs\n" + SHA_B + " refs/heads/main\n");
        assertThat(SiteAnalysisService.readCommitSha(repo)).isEqualTo(SHA_B);

        Files.writeString(repo.resolve(".git/HEAD"), SHA_A + "\n");
        assertThat(SiteAnalysisService.readCommitSha(repo)).isEqualTo(SHA_A);

        Files.writeString(repo.resolve(".git/HEAD"), "ref: ../../etc/passwd\n");
        assertThat(SiteAnalysisService.readCommitSha(repo)).isNull();
    }

    @Test
    void returnsNullWhenDirectoryIsNotARepository(@TempDir Path dir) {
        assertThat(SiteAnalysisService.readCommitSha(dir)).isNull();
    }

    // ---------------------------------------------------------------- 사이트 탐색 결과 저장

    private static Map<String, Object> siteResult() {
        return Map.of(
                "status", "COMPLETED",
                "mode", "DOM",
                "warnings", List.of("페이지 수 상한(5)에 도달했습니다."),
                "nodes", List.of(
                        Map.of("id", "n1", "url", "http://site/", "path", "/", "title", "홈",
                                "screenshot", "screens/n1.jpg", "ariaSnapshot", "- heading \"홈\"",
                                "forms", List.of(Map.of("idx", 0, "fieldIdx", List.of(0), "submitIdx", List.of(1))),
                                "elements", List.of(
                                        Map.of("idx", 0, "tag", "input", "role", "textbox", "name", "이메일",
                                                "selector", "getByLabel('이메일', { exact: true })", "unique", true),
                                        Map.of("idx", 1, "tag", "button", "role", "button", "name", "삭제",
                                                "selector", "getByRole('button', { name: '삭제', exact: true }).nth(1)",
                                                "unique", true, "fragile", true),
                                        Map.of("idx", 2, "tag", "a", "role", "link", "name", "소개",
                                                "selector", "getByRole('link', { name: '소개', exact: true })", "unique", true))),
                        Map.of("id", "n2", "url", "http://site/about", "path", "/about", "title", "소개",
                                "elements", List.of())),
                "edges", List.of(
                        Map.of("from", "n1", "to", "n2", "label", "소개",
                                "selector", "getByRole('link', { name: '소개', exact: true })"),
                        Map.of("from", "n1", "toUrl", "http://site/far", "label", "멀리")));
    }

    @Test
    @SuppressWarnings("unchecked")
    void urlResultBecomesSiteNodesWithObservedSelectorsAndEdges() throws IOException {
        SiteNode codeScreen = node("/settings", SHA_A);
        codeScreen.setOrigin("CODE");
        SiteNode oldSite = node("/gone", null);
        oldSite.setOrigin("SITE");
        when(nodeRepository.findByProjectIdOrderByRouteKey("p")).thenReturn(List.of(codeScreen, oldSite));
        when(edgeRepository.findByProjectId("p")).thenReturn(List.of());

        SiteAnalysisService.UrlOutcome outcome = service.applyUrlResult("p", siteResult(), "run-7/result/");

        assertThat(outcome.mode()).isEqualTo("DOM");
        assertThat(outcome.pages()).isEqualTo(2);
        assertThat(outcome.verifiedSelectors()).isEqualTo(2); // .nth() 에 기대는 셀렉터는 확인으로 세지 않는다
        assertThat(outcome.warnings()).hasSize(1);

        ArgumentCaptor<List<SiteNode>> saved = ArgumentCaptor.forClass(List.class);
        verify(nodeRepository).saveAll(saved.capture());
        Map<String, SiteNode> byRoute = saved.getValue().stream()
                .collect(Collectors.toMap(SiteNode::getRouteKey, n -> n));
        assertThat(byRoute).containsOnlyKeys("/", "/about", "/gone"); // 코드 분석 화면은 건드리지 않는다
        SiteNode home = byRoute.get("/");
        assertThat(home.getOrigin()).isEqualTo("SITE");
        assertThat(home.getScreenshot()).isEqualTo("run-7/result/screens/n1.jpg");
        assertThat(home.getElements()).contains("\"verification\":\"OBSERVED\"").contains("\"duplicate\":true");
        assertThat(home.getForms()).contains("fieldIdx");
        assertThat(home.getLinks()).contains("/about").doesNotContain("/far");
        assertThat(byRoute.get("/gone").isStale()).isTrue();
        assertThat(codeScreen.isStale()).isFalse();

        ArgumentCaptor<List<SiteEdge>> edges = ArgumentCaptor.forClass(List.class);
        verify(edgeRepository).saveAll(edges.capture());
        assertThat(edges.getValue()).singleElement().satisfies(edge -> {
            assertThat(edge.getFromRouteKey()).isEqualTo("/");
            assertThat(edge.getToRouteKey()).isEqualTo("/about");
            assertThat(edge.getSelector()).isEqualTo("getByRole('link', { name: '소개', exact: true })");
        });
    }

    @Test
    void siteElementWithoutUniqueSelectorStaysUnverified() {
        Map<String, Object> element = SiteAnalysisService.siteElement(
                Map.of("idx", 3, "tag", "div", "role", "button", "unique", false));
        assertThat(element.get("kind")).isEqualTo("button");
        assertThat(element.get("verification")).isEqualTo("UNVERIFIED");
    }
}
