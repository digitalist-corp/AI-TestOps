package com.playops.api.service;

import com.playops.api.dto.PlanDtos;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OnboardingBriefingServiceTest {

    private static final List<OnboardingBriefingService.Screen> SCREENS = List.of(
            new OnboardingBriefingService.Screen("/", "첫 화면", "/", null),
            new OnboardingBriefingService.Screen("/login", "로그인", "/login", null));

    private final SiteAnalysisService siteAnalysis = mock(SiteAnalysisService.class);
    private final SiteMapPromptService siteMapPrompt = mock(SiteMapPromptService.class);
    private final LlmGatewayService llm = mock(LlmGatewayService.class);
    private final PlanEntryService planEntries = mock(PlanEntryService.class);
    private final OnboardingBriefingService service =
            new OnboardingBriefingService(siteAnalysis, siteMapPrompt, llm, planEntries);

    @Test
    void extractsPlaywrightTestTitlesAsWritten() {
        String spec = """
                import { test, expect } from '@playwright/test';
                test.describe('묶음', () => {
                  test.beforeEach(async ({ page }) => { await page.goto('/'); });
                  test('첫 화면이 열린다', async ({ page }) => {
                    await test.step('메뉴 열기', async () => {});
                    expect(/a/.test('a')).toBe(true);
                  });
                  test("로그인 버튼이 보인다", async () => {});
                  test.only(`검색할 수 있다`, async () => {});
                  test.skip('it\\'s 따옴표', async () => {});
                  test(`${name} 동적 제목`, async () => {});
                  test('태그 @smoke', async () => {});
                  test('첫 화면이 열린다', async () => {});
                });
                """;

        assertThat(OnboardingBriefingService.testTitles(spec))
                .containsExactly("첫 화면이 열린다", "로그인 버튼이 보인다", "검색할 수 있다", "it's 따옴표");
        assertThat(OnboardingBriefingService.testTitles(null)).isEmpty();
    }

    @Test
    void turnsLlmJsonIntoFixedA2uiMessages() {
        String raw = """
                ```json
                {"summary": "화면 2개를 살펴봤어요.",
                 "screens": [{"routeKey": "/", "note": "메뉴가 있어요"}, {"routeKey": "/nope", "note": "없는 화면"}],
                 "tests": [{"title": "첫 화면이 열린다", "plain": "첫 화면이 뜨는지 봤어요"}, {"title": "지어낸 테스트", "plain": "x"}],
                 "resultNote": "모두 통과했어요.",
                 "cautions": ["로그인 화면은 계정이 있어야 볼 수 있어요"],
                 "suggestions": [
                   {"title": "로그인할 수 있다", "screenRouteKey": "/login", "priority": "높음", "why": "가장 먼저 쓰는 기능이에요"},
                   {"title": "검색 @태그\\n할 수 있다", "screenRouteKey": "/모르는", "priority": "보통", "why": "%s"},
                   {"title": "첫 화면이 열린다", "priority": "높음", "why": "이미 있는 테스트와 겹침"},
                   {"title": "c", "priority": "낮음"}, {"title": "d"}, {"title": "e"}, {"title": "f 여섯째"}
                 ]}
                ```
                """.formatted("길".repeat(500));

        OnboardingBriefingService.Content content =
                OnboardingBriefingService.parse(raw, List.of("첫 화면이 열린다"), SCREENS, true);
        assertThat(content).isNotNull();
        assertThat(content.candidates()).extracting(OnboardingBriefingService.Candidate::id)
                .containsExactly("test-0", "suggest-0", "suggest-1", "suggest-2", "suggest-3", "suggest-4");
        OnboardingBriefingService.Candidate search = content.candidates().get(2);
        assertThat(search.title()).isEqualTo("검색 태그 할 수 있다");
        assertThat(search.screenRouteKey()).isNull();
        assertThat(search.detail()).hasSizeLessThanOrEqualTo(200).endsWith("…");
        assertThat(search.priority()).isEqualTo("MEDIUM");
        assertThat(content.candidates().get(1).priority()).isEqualTo("HIGH");
        assertThat(content.candidates().get(1).screenRouteKey()).isEqualTo("/login");
        // 기본 선택 = 모든 테스트 + 우선순위 높음 추천
        assertThat(content.selected()).containsExactly("test-0", "suggest-0");

        List<Map<String, Object>> messages = OnboardingBriefingService.messages("b1", content, null);
        assertThat(messages).hasSize(2);
        assertThat(messages).allSatisfy(m -> assertThat(m).containsEntry("version", "1.0"));

        Map<String, Object> create = map(messages.get(0).get("createSurface"));
        assertThat(create).containsEntry("surfaceId", "onboarding-b1")
                .containsEntry("catalogId", "https://playops.dev/a2ui/catalogs/onboarding/v1");
        Map<String, Object> data = map(create.get("dataModel"));
        assertThat(data).containsEntry("summary", "화면 2개를 살펴봤어요.")
                .containsEntry("resultNote", "모두 통과했어요.")
                .containsEntry("selected", List.of("test-0", "suggest-0"))
                .containsEntry("doneCount", 0);
        assertThat(data.get("screens")).isEqualTo(List.of(
                Map.of("title", "첫 화면", "path", "/", "note", "메뉴가 있어요"),
                Map.of("title", "로그인", "path", "/login")));
        assertThat(map(((List<?>) data.get("candidates")).get(0))).isEqualTo(Map.of(
                "id", "test-0", "title", "첫 화면이 열린다", "detail", "첫 화면이 뜨는지 봤어요", "badge", "이미 만든 테스트"));
        assertThat(map(((List<?>) data.get("candidates")).get(1))).containsEntry("badge", "추천 · 높음");

        Map<String, Object> update = map(messages.get(1).get("updateComponents"));
        assertThat(update).containsEntry("surfaceId", "onboarding-b1");
        Map<String, Map<String, Object>> byId = byId(update);
        assertThat(byId.keySet()).containsExactly("root", "intro", "summaryText", "screenList", "caution_0",
                "result", "resultNotice", "plan", "planHint", "checkList", "addButton");
        assertThat(byId.get("root")).containsEntry("component", "Column")
                .containsEntry("children", List.of("intro", "result", "plan"));
        assertThat(byId.get("intro")).containsEntry("children", List.of("summaryText", "screenList", "caution_0"));
        assertThat(byId.get("caution_0")).containsEntry("component", "Notice").containsEntry("tone", "warning");
        assertThat(byId.get("resultNotice")).containsEntry("tone", "success")
                .containsEntry("text", Map.of("@path", "/resultNote"));
        assertThat(byId.get("checkList")).containsEntry("items", Map.of("@path", "/candidates"))
                .containsEntry("value", Map.of("@path", "/selected"));
        assertThat(byId.get("addButton")).containsEntry("action", Map.of("event", Map.of(
                "name", "add_to_plan", "context", Map.of("selected", Map.of("@path", "/selected")))));
    }

    @Test
    void planSectionBecomesDoneNoticeAfterAdding() {
        OnboardingBriefingService.Content content =
                OnboardingBriefingService.fallback(List.of("홈"), SCREENS, false);

        Map<String, Object> update = map(OnboardingBriefingService.messages("b1", content, 3).get(1).get("updateComponents"));
        Map<String, Map<String, Object>> byId = byId(update);

        assertThat(byId.get("plan")).containsEntry("children", List.of("planDone"));
        assertThat(byId.get("planDone")).containsEntry("tone", "success")
                .containsEntry("text", "3건을 계획에 넣었어요. 계획 탭에서 볼 수 있어요.");
        assertThat(byId).doesNotContainKeys("checkList", "addButton");
        assertThat(byId.get("resultNotice")).containsEntry("tone", "danger");
        assertThat(map(map(OnboardingBriefingService.messages("b1", content, 3).get(0).get("createSurface"))
                .get("dataModel"))).containsEntry("doneCount", 3);
    }

    @Test
    void brokenLlmOutputFallsBackToPlainBriefing() {
        when(llm.chat(any(), anyString(), anyString(), eq("첫 실행 브리핑"), eq("p"))).thenReturn("죄송해요, JSON 이 아닙니다");
        when(siteMapPrompt.context(eq("p"), anyList())).thenReturn("");
        when(siteAnalysis.view("p")).thenReturn(new SiteAnalysisService.SiteMap("p", null, null, List.of(
                node("/", "첫 화면", false), node("/admin", "관리자", true)), List.of(), List.of()));

        OnboardingBriefingService.Content content = service.build("p", null, "확인",
                "test('홈', async () => {});", true, null);

        assertThat(content.summary()).isEqualTo("화면 1개를 살펴봤어요.");
        assertThat(content.resultNote()).isEqualTo("AI가 만든 테스트 1개가 모두 통과했어요.");
        assertThat(content.screens()).extracting(OnboardingBriefingService.Screen::routeKey).containsExactly("/");
        assertThat(content.candidates()).extracting(OnboardingBriefingService.Candidate::title).containsExactly("홈");
        assertThat(content.cautions()).isEmpty();
        assertThat(content.selected()).containsExactly("test-0");
    }

    @Test
    void llmErrorAlsoFallsBack() {
        when(llm.chat(any(), anyString(), anyString(), anyString(), any())).thenThrow(new RuntimeException("timeout"));

        OnboardingBriefingService.Content content = service.build("p", null, "확인",
                "test('홈', async () => {});", false, "boom");

        assertThat(content.candidates()).hasSize(1);
        assertThat(content.resultNote()).contains("아직 통과하지 못했어요");
    }

    @Test
    @SuppressWarnings("unchecked")
    void addsOnlyServerSideCandidatesToThePlan() {
        String raw = "{\"suggestions\":[{\"title\":\"로그인할 수 있다\",\"screenRouteKey\":\"/login\",\"priority\":\"낮음\",\"why\":\"자주 써요\"}]}";
        OnboardingBriefingService.Content content =
                OnboardingBriefingService.parse(raw, List.of("홈"), SCREENS, true);
        List<OnboardingBriefingService.Candidate> chosen =
                OnboardingBriefingService.pick(content, List.of("suggest-0", "test-0", "test-9", 7));
        when(planEntries.createAll(eq("p"), anyList())).thenReturn(2);

        assertThat(service.addToPlan("p", chosen)).isEqualTo(2);

        ArgumentCaptor<List<PlanDtos.EntryRequest>> captor = ArgumentCaptor.forClass(List.class);
        verify(planEntries).createAll(eq("p"), captor.capture());
        assertThat(captor.getValue()).containsExactly(
                new PlanDtos.EntryRequest("홈", null, null, null, null, null),
                new PlanDtos.EntryRequest("로그인할 수 있다", "/login", "자주 써요", null, null, "LOW"));
        assertThat(OnboardingBriefingService.pick(content, "test-0")).isEmpty();
    }

    private static SiteAnalysisService.Node node(String routeKey, String title, boolean excluded) {
        return new SiteAnalysisService.Node(routeKey, title, null, "OBSERVED", false, 3, excluded, null,
                "http://site" + routeKey, false, false, 0, 0, 0, 0);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object value) {
        return (Map<String, Object>) value;
    }

    private static Map<String, Map<String, Object>> byId(Map<String, Object> update) {
        Map<String, Map<String, Object>> out = new java.util.LinkedHashMap<>();
        for (Object c : (List<?>) update.get("components")) {
            Map<String, Object> component = map(c);
            out.put((String) component.get("id"), component);
        }
        return out;
    }
}
