package com.playops.api.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.dto.PlanDtos;
import com.playops.api.entity.AiModelProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 첫 테스트 생성이 끝난 뒤 비전공자에게 보여 줄 브리핑 (docs/design/onboarding-briefing-contract.md).
 *
 * 화면 틀(A2UI 컴포넌트 배치)은 이 클래스가 고정으로 만들고, LLM 은 내용(쉬운 말 설명 · 추천 계획)만 JSON 으로 만든다.
 * 매번 다른 배치를 보여 주면 처음 쓰는 사람이 헷갈리기 때문이다. LLM 이 실패해도 화면 목록 · 테스트 제목만으로
 * 기본 브리핑을 만들어 사용자가 다음 단계(계획에 넣기)로 넘어갈 수 있게 한다.
 */
@Service
public class OnboardingBriefingService {

    private static final Logger log = LoggerFactory.getLogger(OnboardingBriefingService.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

    public static final String VERSION = "1.0";
    public static final String CATALOG_ID = "https://playops.dev/a2ui/catalogs/onboarding/v1";
    public static final String ACTION_ADD_TO_PLAN = "add_to_plan";
    static final String TEST_BADGE = "이미 만든 테스트";

    static final int MAX_SUGGESTIONS = 5;
    static final int MAX_CAUTIONS = 3;
    static final int MAX_SCREENS = 20;
    /** 프롬프트에 넣는 화면 상세 · 실패 기록 길이. 브리핑은 요약이라 길게 줄 필요가 없다. */
    private static final int PROMPT_CONTEXT_CHARS = 6_000;
    private static final int PROMPT_FAILURE_CHARS = 1_500;

    /**
     * Playwright 의 test(...) · test.only(...) 등의 첫 인자(문자열 제목). test.describe · test.step 은 테스트가 아니라 뺀다.
     * 앞에 '.' 이 붙은 것(regex.test(...))도 뺀다.
     */
    private static final Pattern TEST_CALL = Pattern.compile(
            "(?<![\\w$.])test(?:\\.(?:only|skip|fixme|fail|slow))?\\s*\\(\\s*(['\"`])((?:\\\\.|(?!\\1)[^\\\\])*)\\1");

    private final SiteAnalysisService siteAnalysisService;
    private final SiteMapPromptService siteMapPromptService;
    private final LlmGatewayService llmGatewayService;
    private final PlanEntryService planEntryService;

    public OnboardingBriefingService(SiteAnalysisService siteAnalysisService, SiteMapPromptService siteMapPromptService,
                                     LlmGatewayService llmGatewayService, PlanEntryService planEntryService) {
        this.siteAnalysisService = siteAnalysisService;
        this.siteMapPromptService = siteMapPromptService;
        this.llmGatewayService = llmGatewayService;
        this.planEntryService = planEntryService;
    }

    /** 살펴본 화면 하나. path 는 화면에 보여 줄 경로(routeKey). */
    public record Screen(String routeKey, String title, String path, String note) {}

    /**
     * 계획에 넣을 수 있는 후보. 버튼을 누르면 서버는 이 값만 쓴다(클라이언트가 보낸 제목은 믿지 않는다).
     * priority 는 계획 행 값(HIGH · MEDIUM · LOW), 테스트 후보는 null.
     */
    public record Candidate(String id, String title, String detail, String badge, String screenRouteKey,
                            String priority, boolean existingTest) {}

    /** 브리핑 내용. 메모리에만 두고, 상태 조회마다 A2UI 메시지로 바꾼다. */
    public record Content(String summary, String resultNote, boolean passed, List<Screen> screens,
                          List<String> cautions, List<Candidate> candidates, List<String> selected) {}

    // ---------------------------------------------------------------- 내용 만들기

    /** LLM 한 번으로 내용을 만든다. LLM 호출 · 파싱이 실패하면 LLM 없는 기본 브리핑을 돌려준다. */
    public Content build(String projectId, AiModelProvider provider, String instruction, String spec,
                         boolean passed, String failureLog) {
        List<String> titles = testTitles(spec);
        List<Screen> screens = screens(projectId);
        try {
            String raw = llmGatewayService.chat(provider, SYSTEM_PROMPT,
                    userPrompt(projectId, instruction, titles, screens, passed, failureLog),
                    "첫 실행 브리핑", projectId);
            Content content = parse(raw, titles, screens, passed);
            if (content != null) {
                return content;
            }
            log.info("첫 실행 브리핑: LLM 응답을 읽지 못해 기본 브리핑을 씁니다. project={}", projectId);
        } catch (Exception e) {
            log.warn("첫 실행 브리핑: LLM 호출 실패로 기본 브리핑을 씁니다. project={}: {}", projectId, e.getMessage());
        }
        return fallback(titles, screens, passed);
    }

    /** spec 의 테스트 제목(파일에 적힌 그대로, 순서 유지 · 중복 제거). 계획 제목이 될 수 없는 것('@' · 줄바꿈 · 200자 초과)은 뺀다. */
    static List<String> testTitles(String spec) {
        Set<String> titles = new LinkedHashSet<>();
        if (spec == null) {
            return List.of();
        }
        Matcher m = TEST_CALL.matcher(spec);
        while (m.find()) {
            String quote = m.group(1);
            String body = m.group(2);
            if ("`".equals(quote) && body.contains("${")) {
                continue; // 실행해야 정해지는 제목은 계획 행과 맞출 수 없다
            }
            String title = body.replaceAll("\\\\(.)", "$1").trim();
            if (!title.isEmpty() && title.length() <= PlanService.MAX_TITLE
                    && !title.contains("@") && !title.contains("\n") && !title.contains("\r")) {
                titles.add(title);
            }
        }
        return List.copyOf(titles);
    }

    private List<Screen> screens(String projectId) {
        try {
            SiteAnalysisService.SiteMap map = siteAnalysisService.view(projectId);
            if (map == null || map.nodes() == null) {
                return List.of();
            }
            List<Screen> out = new ArrayList<>();
            for (SiteAnalysisService.Node node : map.nodes()) {
                if (node.excluded() || node.routeKey() == null || out.size() >= MAX_SCREENS) {
                    continue;
                }
                String title = node.title() != null && !node.title().isBlank() ? node.title().trim() : node.routeKey();
                out.add(new Screen(node.routeKey(), clip(title, 80), node.routeKey(), null));
            }
            return List.copyOf(out);
        } catch (Exception e) {
            log.warn("첫 실행 브리핑: 화면 목록을 읽지 못했습니다. project={}: {}", projectId, e.getMessage());
            return List.of();
        }
    }

    private static final String SYSTEM_PROMPT = """
            당신은 소프트웨어를 잘 모르는 사람에게 자동 테스트 결과를 쉬운 말로 설명하는 도우미입니다.
            AI가 방금 사이트 화면을 살펴보고 첫 테스트를 만들어 실행했습니다. 주어진 정보만 보고 아래 모양의 JSON 하나만
            돌려주세요. 코드 울타리(```)나 다른 설명은 붙이지 마세요.

            {"summary": "…", "screens": [{"routeKey": "…", "note": "…"}], "tests": [{"title": "…", "plain": "…"}],
             "resultNote": "…", "cautions": ["…"],
             "suggestions": [{"title": "…", "screenRouteKey": "…", "priority": "높음", "why": "…"}]}

            규칙
            - 모든 글은 한국어로, "~했어요" · "~예요" 체로, 항목마다 한 문장으로 짧게 씁니다.
            - spec, 셀렉터, 크롤링, DOM, assertion, locator, 코드 같은 개발 용어를 쓰지 않습니다. 버튼 · 입력 칸 · 메뉴처럼 화면에 보이는 말로 씁니다.
            - summary: 살펴본 화면 수와 어떤 사이트인지.
            - screens: "화면 목록"에 있는 routeKey 만 씁니다. note 는 그 화면에 무엇이 있는지.
            - tests: "테스트 제목"에 있는 제목을 한 글자도 바꾸지 말고 그대로 쓰고, plain 에 무엇을 확인했는지 씁니다.
            - resultNote: 실행 결과를 한 문장으로. 실패했으면 무엇이 안 됐는지 짐작되는 만큼만 쉽게 씁니다.
            - cautions: 알아 두면 좋을 점(로그인이 필요했던 화면, 살펴보지 못한 부분 등). 없으면 빈 배열, 최대 3개.
            - suggestions: 다음에 확인하면 좋을 동작을 최대 5개. title 은 "~할 수 있다" · "~가 보인다"처럼 확인할 동작 한 줄이며
              '@' 와 줄바꿈을 쓰지 않습니다. 이미 만든 테스트와 겹치면 빼세요. screenRouteKey 는 "화면 목록"의 routeKey 중 하나이거나 null.
              priority 는 "높음" · "보통" · "낮음" 중 하나. why 는 왜 확인하면 좋은지 한 문장.
            """;

    private String userPrompt(String projectId, String instruction, List<String> titles, List<Screen> screens,
                              boolean passed, String failureLog) {
        StringBuilder sb = new StringBuilder();
        sb.append("사용자 요청: ").append(instruction == null ? "-" : instruction).append('\n');
        sb.append("실행 결과: ").append(passed ? "모두 통과" : "통과하지 못함").append("\n\n");
        sb.append("테스트 제목\n");
        if (titles.isEmpty()) {
            sb.append("(없음)\n");
        }
        titles.forEach(t -> sb.append("- ").append(t).append('\n'));
        sb.append("\n화면 목록 (routeKey · 제목)\n");
        if (screens.isEmpty()) {
            sb.append("(없음)\n");
        }
        screens.forEach(s -> sb.append("- ").append(s.routeKey()).append(" · ").append(s.title()).append('\n'));
        String context = "";
        try {
            context = siteMapPromptService.context(projectId, List.of());
        } catch (Exception ignored) {
            // 화면 상세가 없어도 브리핑은 만든다
        }
        if (context != null && !context.isBlank()) {
            sb.append("\n화면 자세한 정보 (참고용, 용어를 그대로 옮기지 말 것)\n")
                    .append(context.length() > PROMPT_CONTEXT_CHARS ? context.substring(0, PROMPT_CONTEXT_CHARS) + "…" : context)
                    .append('\n');
        }
        if (!passed && failureLog != null && !failureLog.isBlank()) {
            String tail = failureLog.length() > PROMPT_FAILURE_CHARS
                    ? "…" + failureLog.substring(failureLog.length() - PROMPT_FAILURE_CHARS)
                    : failureLog;
            sb.append("\n실패 기록 (개발용, 그대로 옮기지 말 것)\n").append(tail).append('\n');
        }
        return sb.toString();
    }

    /**
     * LLM 응답을 관대하게 읽고 검증한다. JSON 이 아니면 null (부르는 쪽이 기본 브리핑을 쓴다).
     * 넘긴 목록에 없는 테스트 제목은 버리고, 모르는 화면 키는 null 로 바꾸고, 추천은 5개까지만 받는다.
     */
    static Content parse(String raw, List<String> titles, List<Screen> screens, boolean passed) {
        Map<String, Object> json = readJson(raw);
        if (json == null) {
            return null;
        }
        Map<String, String> notes = new HashMap<>();
        for (Map<String, Object> item : maps(json.get("screens"))) {
            String key = str(item.get("routeKey"));
            String note = clip(str(item.get("note")), 120);
            if (key != null && note != null) {
                notes.putIfAbsent(key, note);
            }
        }
        List<Screen> withNotes = screens.stream()
                .map(s -> new Screen(s.routeKey(), s.title(), s.path(), notes.get(s.routeKey())))
                .toList();

        Map<String, String> plain = new HashMap<>();
        for (Map<String, Object> item : maps(json.get("tests"))) {
            String title = str(item.get("title"));
            if (title != null && titles.contains(title.trim())) {
                plain.putIfAbsent(title.trim(), clip(str(item.get("plain")), 200));
            }
        }

        List<String> cautions = new ArrayList<>();
        if (json.get("cautions") instanceof List<?> list) {
            for (Object item : list) {
                String caution = clip(str(item), 150);
                if (caution != null && cautions.size() < MAX_CAUTIONS) {
                    cautions.add(caution);
                }
            }
        }

        Set<String> routeKeys = new HashSet<>();
        screens.forEach(s -> routeKeys.add(s.routeKey()));
        List<Suggestion> suggestions = new ArrayList<>();
        Set<String> seen = new HashSet<>(titles);
        for (Map<String, Object> item : maps(json.get("suggestions"))) {
            if (suggestions.size() >= MAX_SUGGESTIONS) {
                break;
            }
            String title = planTitle(str(item.get("title")));
            if (title == null || !seen.add(title)) {
                continue;
            }
            String screen = str(item.get("screenRouteKey"));
            suggestions.add(new Suggestion(title,
                    screen != null && routeKeys.contains(screen) ? screen : null,
                    koreanPriority(str(item.get("priority"))),
                    clip(str(item.get("why")), 200)));
        }

        String summary = clip(str(json.get("summary")), 300);
        String resultNote = clip(str(json.get("resultNote")), 200);
        return content(
                summary != null ? summary : defaultSummary(screens),
                resultNote != null ? resultNote : defaultResultNote(passed, titles.size()),
                passed, withNotes, cautions, titles, plain, suggestions);
    }

    /** LLM 없이: 화면 제목 목록, 테스트 제목 그대로, 추천 없음. */
    static Content fallback(List<String> titles, List<Screen> screens, boolean passed) {
        return content(defaultSummary(screens), defaultResultNote(passed, titles.size()), passed, screens,
                List.of(), titles, Map.of(), List.of());
    }

    private record Suggestion(String title, String screenRouteKey, String priority, String why) {}

    /** 후보 id 를 붙이고 기본 선택(모든 테스트 + 우선순위 높음 추천)을 정한다. */
    private static Content content(String summary, String resultNote, boolean passed, List<Screen> screens,
                                   List<String> cautions, List<String> titles, Map<String, String> plain,
                                   List<Suggestion> suggestions) {
        List<Candidate> candidates = new ArrayList<>();
        List<String> selected = new ArrayList<>();
        for (int i = 0; i < titles.size(); i++) {
            String id = "test-" + i;
            candidates.add(new Candidate(id, titles.get(i), plain.get(titles.get(i)), TEST_BADGE, null, null, true));
            selected.add(id);
        }
        for (int i = 0; i < suggestions.size(); i++) {
            Suggestion s = suggestions.get(i);
            String id = "suggest-" + i;
            candidates.add(new Candidate(id, s.title(), s.why(), "추천 · " + s.priority(), s.screenRouteKey(),
                    planPriority(s.priority()), false));
            if ("높음".equals(s.priority())) {
                selected.add(id);
            }
        }
        return new Content(summary, resultNote, passed, List.copyOf(screens), List.copyOf(cautions),
                List.copyOf(candidates), List.copyOf(selected));
    }

    static String defaultSummary(List<Screen> screens) {
        return screens.isEmpty()
                ? "사이트 화면 정보를 많이 모으지 못했어요. 요청하신 내용을 바탕으로 테스트를 만들었어요."
                : "화면 " + screens.size() + "개를 살펴봤어요.";
    }

    static String defaultResultNote(boolean passed, int testCount) {
        if (passed) {
            return testCount > 0
                    ? "AI가 만든 테스트 " + testCount + "개가 모두 통과했어요."
                    : "AI가 만든 테스트가 모두 통과했어요.";
        }
        return "AI가 만든 테스트가 아직 통과하지 못했어요. 실행 이력에서 어디서 멈췄는지 볼 수 있어요.";
    }

    /** 브리핑 우선순위(한국어)를 계획 행 값으로. 모르는 값은 보통으로 본다. */
    static String planPriority(String korean) {
        return switch (korean == null ? "" : korean) {
            case "높음" -> "HIGH";
            case "낮음" -> "LOW";
            default -> "MEDIUM";
        };
    }

    private static String koreanPriority(String raw) {
        if (raw == null) return "보통";
        String p = raw.trim();
        if (p.equals("높음") || p.equalsIgnoreCase("high")) return "높음";
        if (p.equals("낮음") || p.equalsIgnoreCase("low")) return "낮음";
        return "보통";
    }

    /** 계획 제목 규칙(PlanService.checkTitle)에 맞춘다: '@' · 줄바꿈 제거, 100자로 자름. */
    private static String planTitle(String raw) {
        if (raw == null) return null;
        String t = raw.replace("@", "").replaceAll("[\\r\\n]+", " ").trim();
        return t.isEmpty() ? null : clip(t, 100);
    }

    // ---------------------------------------------------------------- A2UI 메시지

    public static String surfaceId(String bootstrapId) {
        return "onboarding-" + bootstrapId;
    }

    /**
     * 내용을 A2UI v1.0 메시지(createSurface → updateComponents)로 바꾼다. 배치와 id 는 계약에 고정돼 있다.
     * doneCount 가 null 이 아니면 이미 계획에 넣은 것이라 plan 섹션을 planDone 한 줄로 바꾼다.
     */
    public static List<Map<String, Object>> messages(String bootstrapId, Content c, Integer doneCount) {
        String surfaceId = surfaceId(bootstrapId);

        List<Map<String, Object>> screens = new ArrayList<>();
        for (Screen s : c.screens()) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("title", s.title());
            item.put("path", s.path());
            if (s.note() != null) item.put("note", s.note());
            screens.add(item);
        }
        List<Map<String, Object>> candidates = new ArrayList<>();
        for (Candidate cand : c.candidates()) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", cand.id());
            item.put("title", cand.title());
            if (cand.detail() != null) item.put("detail", cand.detail());
            item.put("badge", cand.badge());
            candidates.add(item);
        }
        Map<String, Object> dataModel = new LinkedHashMap<>();
        dataModel.put("summary", c.summary());
        dataModel.put("resultNote", c.resultNote());
        dataModel.put("screens", screens);
        dataModel.put("candidates", candidates);
        dataModel.put("selected", new ArrayList<>(c.selected()));
        dataModel.put("doneCount", doneCount == null ? 0 : doneCount);

        Map<String, Object> createSurface = new LinkedHashMap<>();
        createSurface.put("surfaceId", surfaceId);
        createSurface.put("catalogId", CATALOG_ID);
        createSurface.put("dataModel", dataModel);

        List<Map<String, Object>> components = new ArrayList<>();
        components.add(component("root", "Column", "children", List.of("intro", "result", "plan")));

        List<String> introChildren = new ArrayList<>(List.of("summaryText", "screenList"));
        for (int i = 0; i < c.cautions().size(); i++) introChildren.add("caution_" + i);
        components.add(section("intro", "AI가 이 사이트를 살펴봤어요", introChildren));
        components.add(component("summaryText", "Text", "text", path("/summary")));
        components.add(component("screenList", "ScreenList", "items", path("/screens")));
        for (int i = 0; i < c.cautions().size(); i++) {
            components.add(notice("caution_" + i, c.cautions().get(i), "warning"));
        }

        components.add(section("result", "첫 테스트 결과", List.of("resultNotice")));
        components.add(notice("resultNotice", path("/resultNote"), c.passed() ? "success" : "danger"));

        if (doneCount == null) {
            components.add(section("plan", "계획에 넣을 항목을 골라 주세요", List.of("planHint", "checkList", "addButton")));
            Map<String, Object> hint = component("planHint", "Text", "text",
                    "고른 항목은 계획 탭에 한 줄씩 들어가요. 이미 만든 테스트는 그 줄에 바로 이어져요.");
            hint.put("variant", "muted");
            components.add(hint);
            Map<String, Object> checkList = component("checkList", "CheckList", "items", path("/candidates"));
            checkList.put("value", path("/selected"));
            components.add(checkList);
            Map<String, Object> button = component("addButton", "Button", "label", "계획에 넣기");
            button.put("variant", "primary");
            button.put("action", Map.of("event", Map.of(
                    "name", ACTION_ADD_TO_PLAN,
                    "context", Map.of("selected", path("/selected")))));
            components.add(button);
        } else {
            components.add(section("plan", "계획에 넣을 항목을 골라 주세요", List.of("planDone")));
            components.add(notice("planDone", doneCount + "건을 계획에 넣었어요. 계획 탭에서 볼 수 있어요.", "success"));
        }

        Map<String, Object> updateComponents = new LinkedHashMap<>();
        updateComponents.put("surfaceId", surfaceId);
        updateComponents.put("components", components);

        return List.of(message("createSurface", createSurface), message("updateComponents", updateComponents));
    }

    private static Map<String, Object> message(String kind, Map<String, Object> body) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("version", VERSION);
        m.put(kind, body);
        return m;
    }

    private static Map<String, Object> component(String id, String type, String key, Object value) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("component", type);
        m.put(key, value);
        return m;
    }

    private static Map<String, Object> section(String id, String title, List<String> children) {
        Map<String, Object> m = component(id, "Section", "title", title);
        m.put("children", children);
        return m;
    }

    private static Map<String, Object> notice(String id, Object text, String tone) {
        Map<String, Object> m = component(id, "Notice", "text", text);
        m.put("tone", tone);
        return m;
    }

    private static Map<String, Object> path(String p) {
        return Map.of("@path", p);
    }

    // ---------------------------------------------------------------- 계획에 넣기

    /** 고른 id 를 서버가 저장한 후보에서만 찾는다. 모르는 id 는 무시한다. */
    static List<Candidate> pick(Content c, Object selected) {
        if (!(selected instanceof List<?> ids)) {
            return List.of();
        }
        Set<String> wanted = new HashSet<>();
        ids.forEach(id -> { if (id instanceof String s) wanted.add(s); });
        return c.candidates().stream().filter(cand -> wanted.contains(cand.id())).toList();
    }

    /**
     * 후보를 계획 행으로 만든다. 테스트 후보는 제목만 넣는다 — 제목이 같으면 PlanService.autoLink 가 그 테스트에 잇는다.
     * 추천은 미작성 계획 행(화면 · 우선순위 · 기대 결과 = 추천 이유)으로 넣는다.
     */
    public int addToPlan(String projectId, List<Candidate> chosen) {
        List<PlanDtos.EntryRequest> entries = chosen.stream()
                .map(c -> c.existingTest()
                        ? new PlanDtos.EntryRequest(c.title(), null, null, null, null, null)
                        : new PlanDtos.EntryRequest(c.title(), c.screenRouteKey(), c.detail(), null, null, c.priority()))
                .toList();
        return planEntryService.createAll(projectId, entries);
    }

    // ---------------------------------------------------------------- 보조

    /** ``` 울타리와 앞뒤 군말을 걷어내고 첫 '{' 부터 마지막 '}' 까지를 JSON 객체로 읽는다. */
    private static Map<String, Object> readJson(String raw) {
        if (raw == null) return null;
        String text = raw.trim().replaceFirst("^```[a-zA-Z]*\\s*", "").replaceFirst("\\s*```$", "");
        int start = text.indexOf('{');
        int end = text.lastIndexOf('}');
        if (start < 0 || end <= start) return null;
        try {
            return MAPPER.readValue(text.substring(start, end + 1), MAP_TYPE);
        } catch (Exception e) {
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> maps(Object value) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (value instanceof List<?> list) {
            for (Object item : list) {
                if (item instanceof Map<?, ?> m) out.add((Map<String, Object>) m);
            }
        }
        return out;
    }

    private static String str(Object value) {
        if (!(value instanceof String s)) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    /** 줄바꿈을 한 칸으로 합치고 너무 길면 자른다. */
    static String clip(String s, int max) {
        if (s == null) return null;
        String t = s.replaceAll("\\s*[\\r\\n]+\\s*", " ").trim();
        if (t.isEmpty()) return null;
        return t.length() > max ? t.substring(0, max - 1) + "…" : t;
    }
}
