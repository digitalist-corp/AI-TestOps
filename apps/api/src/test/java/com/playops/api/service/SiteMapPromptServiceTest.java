package com.playops.api.service;

import com.playops.api.entity.SiteNode;
import com.playops.api.entity.SiteNodeEdit;
import com.playops.api.repository.ScenarioOriginRepository;
import com.playops.api.repository.SiteNodeEditRepository;
import com.playops.api.repository.SiteNodeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SiteMapPromptServiceTest {

    private final SiteNodeRepository nodes = mock(SiteNodeRepository.class);
    private final SiteNodeEditRepository edits = mock(SiteNodeEditRepository.class);
    private final ScenarioOriginRepository origins = mock(ScenarioOriginRepository.class);
    private final SiteMapPromptService service = new SiteMapPromptService(nodes, edits, origins);

    private static SiteNode node(String route, String title, String elements, String links) {
        SiteNode node = new SiteNode();
        node.setProjectId("p");
        node.setRouteKey(route);
        node.setTitle(title);
        node.setElements(elements);
        node.setLinks(links);
        return node;
    }

    @BeforeEach
    void setUp() {
        SiteNode login = node("/login", "로그인", """
                [{"kind":"input","testId":"login-email","label":"이메일","selector":"getByTestId('login-email')"},
                 {"kind":"button","role":"button","name":"Sign in","selector":"getByRole('button', { name: 'Sign in', exact: true })"},
                 {"kind":"button","role":"button","name":"삭제","selector":"getByRole('button', { name: '삭제', exact: true })","duplicate":true},
                 {"kind":"input","text":"안내","selector":null}]
                """, "[{\"to\":\"/signup\",\"label\":\"가입\"}]");
        SiteNode signup = node("/signup", null, "[{\"kind\":\"button\",\"role\":\"button\",\"name\":\"가입\","
                + "\"selector\":\"getByRole('button', { name: '가입', exact: true })\"}]", "[]");
        SiteNode admin = node("/admin", "관리", "[{\"kind\":\"button\",\"testId\":\"wipe\",\"selector\":\"getByTestId('wipe')\"}]", "[]");
        SiteNode gone = node("/legacy", null, "[]", "[]");
        gone.setStale(true);
        when(nodes.findByProjectIdOrderByRouteKey("p")).thenReturn(List.of(admin, gone, login, signup));

        SiteNodeEdit excludeAdmin = new SiteNodeEdit();
        excludeAdmin.setRouteKey("/admin");
        excludeAdmin.setExcluded(true);
        when(edits.findByProjectId("p")).thenReturn(List.of(excludeAdmin));
    }

    @Test
    void describesPickedScreensInFullAndOthersByPathOnly() {
        String context = service.context("p", List.of("/login"));

        assertThat(context)
                .contains("화면 /login (로그인)")
                .contains("- input: getByTestId('login-email')")
                .contains("getByRole('button', { name: '삭제', exact: true })  (같은 셀렉터가 화면에 여러 개 있다)")
                .contains("이동: /signup")
                .contains("그 밖의 화면(경로만): /signup")
                .doesNotContain("안내")                 // 셀렉터를 만들지 못한 요소는 넣지 않는다
                .doesNotContain("/admin")               // 사용자가 제외한 화면
                .doesNotContain("/legacy");             // 코드에서 사라진 화면
    }

    @Test
    void includesEveryUsableScreenWhenNothingIsPicked() {
        assertThat(service.context("p", List.of())).contains("화면 /login").contains("화면 /signup").doesNotContain("경로만");
    }

    @Test
    void returnsBlankWhenProjectHasNoAnalysis() {
        assertThat(service.context("other", List.of())).isEmpty();
        assertThat(service.overview("other")).isEmpty();
    }

    @Test
    void flagsOnlySelectorsThatAreNotBackedByTheScreenInfo() {
        SiteMapPromptService.SelectorCheck check = service.check("p", """
                await page.getByRole("button", { name: "Sign in" }).click();
                await page.getByLabel('이메일').fill('a@b.c');
                await page.getByTestId('login-email').fill('a@b.c');
                await page.getByTestId('made-up').click();
                await page.locator('.btn-primary').click();
                await expect(page.getByRole('heading')).toBeVisible();
                await page.getByRole('button', { name: 'Sign in', exact: true }).click();
                """);

        // 따옴표나 exact 옵션이 달라도 같은 요소로 본다. 저장된 셀렉터가 testid 여도 label 로 찾은 것은 같은 요소다.
        assertThat(check.used()).containsExactly(
                "role|button|Sign in", "label|이메일", "testid|login-email", "testid|made-up", "css|.btn-primary", "role|heading|");
        assertThat(check.unknown()).hasSize(3);
        assertThat(check.unknown().get(0)).contains("made-up");
        assertThat(check.unknown().get(1)).contains(".btn-primary");
        assertThat(check.unknown().get(2)).contains("heading");
    }

    private com.playops.api.entity.ScenarioOrigin origin(String specPath, String routeKeys, String selectorKeys) {
        com.playops.api.entity.ScenarioOrigin origin = new com.playops.api.entity.ScenarioOrigin();
        origin.setProjectId("p");
        origin.setSpecPath(specPath);
        origin.setRouteKeys(routeKeys);
        origin.setSelectorKeys(selectorKeys);
        return origin;
    }

    private SiteNode savedNode(String route) {
        return nodes.findByProjectIdOrderByRouteKey("p").stream().filter(n -> n.getRouteKey().equals(route)).findFirst().orElseThrow();
    }

    @Test
    void marksEverySelectorOfAPassingSpecAsPassed() {
        when(origins.findByProjectId("p")).thenReturn(List.of(
                origin("tests/login.spec.ts", "[\"/login\"]", "[\"testid|login-email\",\"role|button|Sign in\"]")));

        // Playwright 리포트는 testDir 기준 경로를 적는다 ("login.spec.ts").
        service.applyResults("p", List.of(new SiteMapPromptService.CaseOutcome("login.spec.ts", "PASSED", null)));

        long passed = savedNode("/login").getElements().split("\"verification\":\"PASSED\"", -1).length - 1;
        assertThat(passed).isEqualTo(2);                          // 쓴 셀렉터 둘만. "삭제" 버튼과 셀렉터 없는 요소는 그대로
    }

    @Test
    void marksOnlyTheSelectorNamedInTheErrorAsFailed() {
        when(origins.findByProjectId("p")).thenReturn(List.of(
                origin("tests/login.spec.ts", "[]", "[\"testid|login-email\",\"role|button|Sign in\"]")));

        service.applyResults("p", List.of(new SiteMapPromptService.CaseOutcome("tests/login.spec.ts", "FAILED",
                "TimeoutError: locator.click: Timeout 30000ms exceeded.\nCall log:\n"
                        + "  - waiting for getByRole('button', { name: 'Sign in', exact: true })")));

        String elements = savedNode("/login").getElements();
        assertThat(elements.split("\"verification\":\"FAILED\"", -1).length - 1).isEqualTo(1);
        assertThat(elements).doesNotContain("\"verification\":\"PASSED\"");   // 통과했는지 알 수 없는 것은 건드리지 않는다
    }

    @Test
    void ignoresSpecsThatWereNotGeneratedFromScreenInfo() {
        when(origins.findByProjectId("p")).thenReturn(List.of(
                origin("tests/login.spec.ts", "[]", "[\"testid|login-email\"]")));

        service.applyResults("p", List.of(new SiteMapPromptService.CaseOutcome("tests/handwritten.spec.ts", "PASSED", null)));

        assertThat(savedNode("/login").getElements()).doesNotContain("verification");
    }
}
