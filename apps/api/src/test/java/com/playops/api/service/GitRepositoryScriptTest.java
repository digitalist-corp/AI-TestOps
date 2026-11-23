package com.playops.api.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * 제품 코드 수정안이 쓰는 git 스크립트를 로컬 모의 저장소(file://)로 실제 실행해 본다.
 * 컨테이너 · 프록시 · github.com 주소 검증은 빼고, 스크립트가 정확히 그 커밋을 꺼내는지만 확인한다.
 */
class GitRepositoryScriptTest {

    @TempDir
    Path tmp;

    private String sh(Path dir, String... lines) throws Exception {
        Process p = new ProcessBuilder("sh", "-c", String.join("\n", lines)).directory(dir.toFile()).redirectErrorStream(true).start();
        String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        assertThat(p.waitFor()).as(out).isZero();
        return out;
    }

    @Test
    void lsRemoteReadsTheHeadAndFetchChecksOutExactlyTheBaseCommit() throws Exception {
        assumeTrue(new ProcessBuilder("git", "--version").start().waitFor() == 0, "git 이 없으면 건너뜀");
        Path origin = Files.createDirectories(tmp.resolve("origin"));
        sh(origin, "git init -q -b main .", "git config user.email t@t", "git config user.name t",
                // GitHub 처럼 브랜치에서 닿는 커밋은 SHA 로 받을 수 있게 한다
                "git config uploadpack.allowReachableSHA1InWant true",
                "mkdir -p apps/shop && echo 'v1' > apps/shop/a.ts && git add -A && git commit -q -m one",
                "echo 'v2' > apps/shop/a.ts && git commit -q -am two");
        String base = sh(origin, "git rev-parse HEAD~1").trim();
        String head = sh(origin, "git rev-parse HEAD").trim();
        String url = "file://" + origin.toAbsolutePath();

        String listed = sh(tmp, GitRepositoryService.lsRemoteScript(url, "refs/heads/main").toArray(String[]::new));
        assertThat(listed.split("\\s+")[0]).isEqualTo(head);

        Path work = Files.createDirectories(tmp.resolve("work"));
        Files.writeString(work.resolve("stale.txt"), "이전 분석의 남은 파일");
        List<String> script = new ArrayList<>(GitRepositoryService.fetchScript(url, base));
        sh(work, script.toArray(String[]::new));

        assertThat(SiteAnalysisService.readCommitSha(work)).isEqualTo(base);
        assertThat(Files.readString(work.resolve("apps/shop/a.ts")).trim()).isEqualTo("v1");
        assertThat(work.resolve("stale.txt")).doesNotExist();
    }
}
