package com.playops.api.chat.tools;

import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolTier;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.service.FileStorageService;
import com.playops.api.service.ProjectService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 진짜 FileStorageService 를 쓰고 ProjectService 만 가짜로 둔다.
 * 그래야 "숨김 폴더 · .env 제한을 지킨다" 가 흉내가 아니라 실제 규칙으로 확인된다.
 */
class GrepFilesToolTest {

    @TempDir
    Path project;

    private FileStorageService storage;
    private GrepFilesTool tool;

    @BeforeEach
    void setUp() throws IOException {
        ProjectService projectService = mock(ProjectService.class);
        when(projectService.getProjectPath("p1")).thenReturn(project);
        storage = new FileStorageService(projectService);
        tool = new GrepFilesTool(storage);

        write("tests/login.spec.ts", """
                import { test } from '@playwright/test';
                test('로그인', async ({ page }) => {
                  await page.getByRole('button', { name: '로그인' }).click();
                });
                """);
        write("tests/checkout/pay.spec.ts", """
                test('결제', async ({ page }) => {
                  await page.getByRole('button', { name: '결제' }).click();
                });
                """);
        write("src/app.ts", "export const title = 'getByRole is not used here';\n");
        write(".env", "SECRET_TOKEN=abc123\n");
        write("node_modules/lib/index.js", "getByRole in a dependency\n");
        write("playwright-report/index.html", "getByRole in a report\n");
    }

    private void write(String relative, String content) throws IOException {
        Path file = project.resolve(relative);
        Files.createDirectories(file.getParent());
        Files.writeString(file, content, StandardCharsets.UTF_8);
    }

    private static LlmToolCall call(Map<String, Object> args) {
        return new LlmToolCall("c1", "grep_files", args);
    }

    private static ChatToolContext context() {
        return new ChatToolContext("p1", 7L, false, 1L);
    }

    private ChatToolOutput grep(Map<String, Object> args) {
        return tool.execute(call(args), context());
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, String>> items(ChatToolOutput output) {
        return (List<Map<String, String>>) output.display().data().get("items");
    }

    // ---- 정의 ----

    @Test
    void isAReadToolWithPatternRequired() {
        assertThat(tool.tier()).isEqualTo(ToolTier.READ);
        assertThat(tool.spec().name()).isEqualTo("grep_files");
        assertThat(tool.spec().inputSchema().get("required")).isEqualTo(List.of("pattern"));
        @SuppressWarnings("unchecked")
        Map<String, Object> properties = (Map<String, Object>) tool.spec().inputSchema().get("properties");
        assertThat(properties).containsKeys("pattern", "glob", "projectId");
    }

    // ---- 검색 ----

    @Test
    void findsMatchingLinesAsPathLineText() {
        ChatToolOutput output = grep(Map.of("pattern", "getByRole", "glob", "tests/**/*.ts"));

        assertThat(output.error()).isFalse();
        assertThat(output.content()).isEqualTo(
                "tests/checkout/pay.spec.ts:2: await page.getByRole('button', { name: '결제' }).click();\n"
                        + "tests/login.spec.ts:3: await page.getByRole('button', { name: '로그인' }).click();");
        assertThat(output.summary()).isEqualTo("2건");
    }

    @Test
    void displaysTheHitsAsAListOfLabelAndDetail() {
        ChatToolOutput output = grep(Map.of("pattern", "test\\('로그인'"));

        assertThat(output.display().kind()).isEqualTo("list");
        assertThat(items(output)).containsExactly(
                Map.of("label", "tests/login.spec.ts:2", "detail", "test('로그인', async ({ page }) => {"));
    }

    @Test
    void patternIsARegularExpression() {
        ChatToolOutput output = grep(Map.of("pattern", "name: '(로그인|결제)'"));

        assertThat(output.summary()).isEqualTo("2건");
    }

    @Test
    void anInvalidRegularExpressionIsSearchedAsPlainText() throws IOException {
        write("src/broken.ts", "const re = /foo(/;\n");

        ChatToolOutput output = grep(Map.of("pattern", "foo("));

        assertThat(output.error()).isFalse();
        assertThat(output.content()).isEqualTo("src/broken.ts:1: const re = /foo(/;");
    }

    @Test
    void globNarrowsTheFilesLookedAt() {
        // 폴더가 없어도 되는 ** , 파일 이름만 쓰는 글롭, 폴더가 있는 글롭
        assertThat(grep(Map.of("pattern", "getByRole", "glob", "tests/**/*.ts")).summary()).isEqualTo("2건");
        assertThat(grep(Map.of("pattern", "getByRole", "glob", "**/login.spec.ts")).summary()).isEqualTo("1건");
        assertThat(grep(Map.of("pattern", "getByRole", "glob", "*.ts")).summary()).isEqualTo("3건");
        assertThat(grep(Map.of("pattern", "getByRole", "glob", "src/*.ts")).summary()).isEqualTo("1건");
        assertThat(grep(Map.of("pattern", "getByRole", "glob", "tests/*.ts")).summary()).isEqualTo("1건");
        assertThat(grep(Map.of("pattern", "getByRole", "glob", "./tests/login.spec.ts")).summary()).isEqualTo("1건");
    }

    @Test
    void anInvalidGlobIsReportedAsAFailure() {
        ChatToolOutput output = grep(Map.of("pattern", "x", "glob", "tests/{a,b"));

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("glob");
    }

    @Test
    void noMatchIsNotAnError() {
        ChatToolOutput output = grep(Map.of("pattern", "존재하지않는글"));

        assertThat(output.error()).isFalse();
        assertThat(output.content()).isEqualTo("맞는 줄이 없습니다.");
        assertThat(output.summary()).isEqualTo("0건");
        assertThat(output.display()).isNull();
    }

    // ---- 파일 접근 제한 ----

    @Test
    void doesNotSearchEnvFilesHiddenFoldersOrBuildOutput() {
        // .env 는 읽기 제한, node_modules · playwright-report 는 탐색기 숨김 폴더
        assertThat(grep(Map.of("pattern", "SECRET_TOKEN")).content()).isEqualTo("맞는 줄이 없습니다.");
        assertThat(grep(Map.of("pattern", "in a dependency")).content()).isEqualTo("맞는 줄이 없습니다.");
        assertThat(grep(Map.of("pattern", "in a report")).content()).isEqualTo("맞는 줄이 없습니다.");
        // 같은 pattern 이 허용된 파일에서는 찾아진다
        assertThat(grep(Map.of("pattern", "getByRole")).content())
                .contains("src/app.ts").doesNotContain("node_modules").doesNotContain("playwright-report");
    }

    @Test
    void doesNotSearchEnvVariantsEither() throws IOException {
        write(".env.local", "API_KEY=zzz\n");
        write("config/.env.production", "DB_PASSWORD=zzz\n");

        assertThat(grep(Map.of("pattern", "zzz")).content()).isEqualTo("맞는 줄이 없습니다.");
    }

    @Test
    void skipsFilesThatAreTooBigOrBinary() throws IOException {
        write("data/huge.txt", "needle ".repeat(200_000)); // 약 1.4MB
        Files.write(project.resolve("data/binary.bin"), new byte[]{'n', 'e', 'e', 'd', 'l', 'e', 0, 1, 2});

        assertThat(grep(Map.of("pattern", "needle")).content()).isEqualTo("맞는 줄이 없습니다.");
    }

    // ---- 상한 ----

    @Test
    void stopsAtOneHundredLines() throws IOException {
        write("data/many.txt", "hit line\n".repeat(150));

        ChatToolOutput output = grep(Map.of("pattern", "hit line"));

        assertThat(output.summary()).isEqualTo("100건");
        assertThat(items(output)).hasSize(100);
        assertThat(output.content()).contains("100줄에서 멈췄습니다");
        assertThat(output.content()).contains("data/many.txt:100: hit line").doesNotContain("data/many.txt:101:");
    }

    @Test
    void contentIsCappedAtTheCommonResultLimit() throws IOException {
        write("data/wide.txt", ("w".repeat(250) + "\n").repeat(100));

        ChatToolOutput output = grep(Map.of("pattern", "w{10}"));

        assertThat(output.content().length()).isLessThan(6100);
        assertThat(output.content()).endsWith("... (이후 생략)");
        assertThat(items(output)).hasSize(100); // 화면 목록에는 100줄이 다 있다
    }

    @Test
    void longLinesAreShortenedInTheOutput() throws IOException {
        write("data/long.txt", "start " + "x".repeat(1000) + "\n");

        ChatToolOutput output = grep(Map.of("pattern", "start"));

        assertThat(output.content()).startsWith("data/long.txt:1: start xxx").endsWith("…");
        assertThat(output.content().length()).isLessThan(400);
    }

    @Test
    void aRunawayRegularExpressionIsCutOffInsteadOfHangingTheServer() throws IOException {
        // (.*a){12}b 는 b 가 없는 긴 a 줄에서 사실상 끝나지 않는다. (JDK 21 에서 직접 돌려 1.5초가 넘는 것을 확인했다.
        // (a+)+b 같은 고전적인 꼴은 JDK 가 최적화해서 시험용으로 쓸 수 없다.)
        write("data/evil.txt", "a".repeat(1500) + "c\n");
        GrepFilesTool impatient = new GrepFilesTool(storage, 200);

        long start = System.nanoTime();
        ChatToolOutput output = impatient.execute(call(Map.of("pattern", "(.*a){12}b", "glob", "data/*.txt")), context());
        long elapsedMillis = (System.nanoTime() - start) / 1_000_000;

        assertThat(output.error()).isFalse();
        assertThat(output.content()).contains("너무 오래 걸려");
        assertThat(elapsedMillis).isLessThan(5000);
    }

    // ---- 인자 · 범위 ----

    @Test
    void missingPatternFails() {
        ChatToolOutput output = grep(Map.of());

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("pattern");
    }

    @Test
    void withoutAnyProjectItFails() {
        ChatToolOutput output = tool.execute(call(Map.of("pattern", "x")), new ChatToolContext(null, 7L, false, 1L));

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("projectId");
    }

    @Test
    void aNonAdminCannotSearchAnotherProject() {
        ChatToolOutput output = grep(Map.of("pattern", "getByRole", "projectId", "someone-elses"));

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("다른 프로젝트");
    }

    @Test
    void anEmptyProjectFolderIsJustNoMatch() {
        ProjectService projectService = mock(ProjectService.class);
        when(projectService.getProjectPath("empty")).thenReturn(project.resolve("does-not-exist"));
        GrepFilesTool emptyTool = new GrepFilesTool(new FileStorageService(projectService));

        ChatToolOutput output = emptyTool.execute(
                call(Map.of("pattern", "x")), new ChatToolContext("empty", 7L, false, 1L));

        assertThat(output.error()).isFalse();
        assertThat(output.summary()).isEqualTo("0건");
    }
}
