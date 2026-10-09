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
            null, null, null, null, null, null, new ScreenFinder(), null, nodeRepository, null);

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
