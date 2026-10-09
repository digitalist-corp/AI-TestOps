package com.playops.api.service;

import com.playops.api.entity.SiteNode;
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
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SiteAnalysisServiceTest {

    private static final String SHA_A = "a".repeat(40);
    private static final String SHA_B = "b".repeat(40);

    private final SiteNodeRepository nodeRepository = mock(SiteNodeRepository.class);
    private final SiteAnalysisService service = new SiteAnalysisService(
            null, null, null, null, null, null, new ScreenFinder(), null, null, nodeRepository, null, null, null);

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
}
