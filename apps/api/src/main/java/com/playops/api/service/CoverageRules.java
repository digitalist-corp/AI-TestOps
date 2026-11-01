package com.playops.api.service;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 구조 탭 확인 지도의 판정 규칙. DB 없이 값만 받아 판정하므로 단위 테스트로 규칙을 바로 확인할 수 있다.
 * 계약: docs/design/structure-coverage-contract.md 의 "판정 규칙".
 */
final class CoverageRules {

    private CoverageRules() {
    }

    // ---------------------------------------------------------------- 값

    static final String STEP_PASSED = "PASSED";
    static final String STEP_FAILED = "FAILED";
    static final String STEP_NOT_REACHED = "NOT_REACHED";
    static final String STEP_PENDING = "PENDING";

    static final String RUN_PASSED = "PASSED";
    static final String RUN_FAILED = "FAILED";
    static final String RUN_NEVER = "NEVER_RUN";

    static final String SCREEN_TESTED = "TESTED";
    static final String SCREEN_OBSERVED = "OBSERVED";
    static final String SCREEN_UNSEEN = "UNSEEN";
    static final String SCREEN_BLOCKED = "BLOCKED";

    static final String ISSUE_SELECTOR_FAILED = "SELECTOR_FAILED";
    static final String ISSUE_LOGIN_REQUIRED = "LOGIN_REQUIRED";
    static final String ISSUE_OPEN_FAILED = "OPEN_FAILED";
    static final String ISSUE_NOT_REACHED = "NOT_REACHED";
    static final String ISSUE_EXPLORE_STOPPED = "EXPLORE_STOPPED";

    static final String EDGE_TESTED = "TESTED";
    static final String EDGE_OBSERVED = "OBSERVED";
    static final String EDGE_FAILED = "FAILED";
    static final String EDGE_UNKNOWN = "UNKNOWN";

    /** 화면을 BLOCKED 로 만드는 문제. NOT_REACHED 는 안내만 하고 화면을 막힌 것으로 보지 않는다. */
    private static final Set<String> BLOCKING = Set.of(
            ISSUE_SELECTOR_FAILED, ISSUE_LOGIN_REQUIRED, ISSUE_OPEN_FAILED, ISSUE_EXPLORE_STOPPED);

    record Step(String routeKey, String state, String message) {}

    // ---------------------------------------------------------------- 흐름 단계

    /**
     * 흐름의 단계 상태. 마지막 실행이 통과면 모두 PASSED, 한 번도 안 돌렸으면 모두 PENDING.
     * 실패면 failedIndex 단계가 FAILED, 그 앞은 PASSED, 뒤는 NOT_REACHED. failedIndex 가 없으면(-1)
     * 실패한 화면을 셀렉터로 찾지 못한 것이라 마지막 단계를 FAILED 로 둔다.
     */
    static List<Step> flowSteps(List<String> routes, String lastStatus, int failedIndex, String failMessage) {
        List<Step> steps = new ArrayList<>();
        int failAt = failedIndex >= 0 && failedIndex < routes.size() ? failedIndex : routes.size() - 1;
        for (int i = 0; i < routes.size(); i++) {
            String state;
            String message = null;
            if (RUN_PASSED.equals(lastStatus)) {
                state = STEP_PASSED;
            } else if (RUN_FAILED.equals(lastStatus)) {
                if (i < failAt) {
                    state = STEP_PASSED;
                } else if (i == failAt) {
                    state = STEP_FAILED;
                    message = failMessage;
                } else {
                    state = STEP_NOT_REACHED;
                }
            } else {
                state = STEP_PENDING;
            }
            steps.add(new Step(routes.get(i), state, message));
        }
        return steps;
    }

    /**
     * 실패한 셀렉터가 속한 단계. 같은 셀렉터가 여러 화면에 있으면(공용 메뉴 등) 처음 나오는 단계를 고른다 —
     * 뒤 단계를 고르면 실제로는 앞에서 멈췄는데 앞 화면들을 통과로 잘못 보여 줄 수 있어서다.
     *
     * @return 못 찾으면 -1
     */
    static int failedStepIndex(List<String> routes, String failedKey, Map<String, ? extends Collection<String>> keysByRoute) {
        if (failedKey == null) {
            return -1;
        }
        for (int i = 0; i < routes.size(); i++) {
            Collection<String> keys = keysByRoute.get(routes.get(i));
            if (keys != null && keys.contains(failedKey)) {
                return i;
            }
        }
        return -1;
    }

    /**
     * 화면을 고르지 않고 만든 테스트(첫 테스트 등)의 지나간 화면을 셀렉터로 짐작한다.
     * spec 에 셀렉터가 나온 순서대로, 그 셀렉터가 딱 한 화면에만 있을 때만 그 화면을 단계로 넣는다.
     * 여러 화면에 있는 셀렉터(공용 메뉴 등)로는 어느 화면인지 알 수 없어 건너뛴다.
     */
    static List<String> inferRoutes(List<String> selectorKeys, Map<String, ? extends Collection<String>> keysByRoute) {
        Map<String, List<String>> routesByKey = new HashMap<>();
        keysByRoute.forEach((route, keys) -> {
            for (String key : new LinkedHashSet<>(keys)) {
                routesByKey.computeIfAbsent(key, k -> new ArrayList<>()).add(route);
            }
        });
        List<String> routes = new ArrayList<>();
        for (String key : selectorKeys) {
            List<String> owners = routesByKey.get(key);
            if (owners != null && owners.size() == 1) {
                String route = owners.get(0);
                if (routes.isEmpty() || !routes.get(routes.size() - 1).equals(route)) {
                    routes.add(route);
                }
            }
        }
        return routes;
    }

    // ---------------------------------------------------------------- 화면 상태

    /**
     * 막힌 문제가 있으면 BLOCKED → 테스트가 지나가 통과했으면 TESTED → 실제 화면에서 봤으면 OBSERVED → UNSEEN.
     *
     * @param tested     통과한 단계가 이 화면을 지났거나, 테스트를 통과한 요소가 있다
     * @param observed   OBSERVED 요소가 있거나 사이트 탐색 · 녹화로 연 화면이다
     */
    static String screenState(Collection<String> issueKinds, boolean tested, boolean observed) {
        if (issueKinds.stream().anyMatch(BLOCKING::contains)) {
            return SCREEN_BLOCKED;
        }
        if (tested) {
            return SCREEN_TESTED;
        }
        return observed ? SCREEN_OBSERVED : SCREEN_UNSEEN;
    }

    /** 실제 브라우저로 연 적이 있는 화면의 origin. 계약의 "URL" 은 사이트 탐색 화면(origin=SITE)이다. */
    static boolean seenOrigin(String origin) {
        return "SITE".equals(origin) || "URL".equals(origin) || "RECORDED".equals(origin);
    }

    /** 같은 전환에 여러 흐름이 지나가면 막힌 것을 먼저 보여 준다: FAILED > TESTED > OBSERVED > UNKNOWN. */
    static String strongerEdge(String a, String b) {
        return edgeRank(a) >= edgeRank(b) ? a : b;
    }

    private static int edgeRank(String state) {
        if (state == null) {
            return -1;
        }
        return switch (state) {
            case EDGE_FAILED -> 3;
            case EDGE_TESTED -> 2;
            case EDGE_OBSERVED -> 1;
            default -> 0;
        };
    }

    // ---------------------------------------------------------------- 오류 메시지 → 쉬운 말

    /** 오류를 읽은 결과. selector 는 문제가 된 셀렉터(사람이 읽을 모양), key 는 화면 요소와 맞춰 볼 키. */
    record Explained(String kind, String message, String selector, String key) {}

    static final String MSG_STOPPED = "테스트가 이 화면에서 멈췄습니다";
    static final String MSG_OPEN_FAILED = "화면을 열지 못했습니다";

    private static final Pattern ANSI = Pattern.compile("\\u001B\\[[0-9;]*[A-Za-z]");
    private static final Pattern OPEN_ERROR = Pattern.compile(
            "page\\.goto:|net::ERR_|NS_ERROR_|ERR_CONNECTION|ECONNREFUSED|ENOTFOUND", Pattern.CASE_INSENSITIVE);

    /**
     * Playwright 오류를 비개발자가 읽을 한 줄로 바꾼다. 오류 원문은 그대로 보여 주지 않는다.
     * - 셀렉터를 기다리다 시간 초과 → "'결제하기' 버튼을 찾지 못했습니다"
     * - expect 실패 → "'주문 완료' 제목이 기대와 다릅니다" (요소가 아예 없으면 "찾지 못했습니다")
     * - 화면 열기 실패 → "화면을 열지 못했습니다"
     * - 그 밖 → "테스트가 이 화면에서 멈췄습니다"
     */
    static Explained explain(String error) {
        if (error == null || error.isBlank()) {
            return new Explained(ISSUE_SELECTOR_FAILED, MSG_STOPPED, null, null);
        }
        String text = ANSI.matcher(error).replaceAll("");
        SiteMapPromptService.SelectorCall target = targetSelector(text);
        String selector = target == null ? null : target.text();
        String key = target == null ? null : target.key();
        if (text.contains("strict mode violation") && target != null) {
            return new Explained(ISSUE_SELECTOR_FAILED, subject(target) + josa(subject(target), "이", "가")
                    + " 여러 개라 어느 것인지 알 수 없습니다", selector, key);
        }
        boolean expect = text.contains("expect(") || text.contains("Expected");
        if (expect && text.contains("toHaveURL")) {
            return new Explained(ISSUE_SELECTOR_FAILED, "도착한 화면 주소가 기대와 다릅니다", null, null);
        }
        if (expect && target != null) {
            if (text.contains("element(s) not found") || text.contains("element not found")) {
                return new Explained(ISSUE_SELECTOR_FAILED, notFound(target), selector, key);
            }
            String subject = subject(target);
            return new Explained(ISSUE_SELECTOR_FAILED, subject + josa(subject, "이", "가") + " 기대와 다릅니다", selector, key);
        }
        if (target != null && (text.contains("Timeout") || text.contains("waiting for"))) {
            return new Explained(ISSUE_SELECTOR_FAILED, notFound(target), selector, key);
        }
        if (OPEN_ERROR.matcher(text).find()) {
            return new Explained(ISSUE_OPEN_FAILED, MSG_OPEN_FAILED, null, null);
        }
        return new Explained(ISSUE_SELECTOR_FAILED, MSG_STOPPED, selector, key);
    }

    /**
     * 문제가 된 셀렉터. "waiting for …" · "Locator: …" 줄에 적힌 식을 먼저 보고, 없으면 글 전체를 본다.
     * 이어진 식(범위.대상)은 마지막 호출이 실제로 찾던 요소다.
     */
    static SiteMapPromptService.SelectorCall targetSelector(String text) {
        for (String line : text.split("\\r?\\n")) {
            if (line.contains("waiting for") || line.contains("Locator:") || line.contains("locator resolved")
                    || line.contains("strict mode violation")) {
                List<SiteMapPromptService.SelectorCall> calls = SiteMapPromptService.selectorCallsIn(line);
                if (!calls.isEmpty()) {
                    return calls.get(calls.size() - 1);
                }
            }
        }
        // 한 줄 메시지: 첫 식 묶음의 마지막 호출을 쓴다.
        List<SiteMapPromptService.SelectorCall> calls = SiteMapPromptService.selectorCallsIn(text.split("\\r?\\n")[0]);
        if (calls.isEmpty()) {
            calls = SiteMapPromptService.selectorCallsIn(text);
        }
        return calls.isEmpty() ? null : calls.get(calls.size() - 1);
    }

    private static String notFound(SiteMapPromptService.SelectorCall call) {
        String subject = subject(call);
        return subject + josa(subject, "을", "를") + " 찾지 못했습니다";
    }

    /** "'결제하기' 버튼", 이름이 없으면 "버튼". */
    static String subject(SiteMapPromptService.SelectorCall call) {
        String word = roleWord(call);
        String name = switch (call.method()) {
            case "getByRole" -> call.name();
            case "locator" -> null;
            default -> call.value();
        };
        if (name == null || name.isBlank()) {
            return "locator".equals(call.method()) ? "'" + shorten(call.value()) + "' 요소" : word;
        }
        return "'" + shorten(name) + "' " + word;
    }

    private static String shorten(String s) {
        String one = s.replaceAll("\\s+", " ").trim();
        return one.length() > 40 ? one.substring(0, 40) + "…" : one;
    }

    private static final Map<String, String> ROLE_WORDS = Map.ofEntries(
            Map.entry("button", "버튼"), Map.entry("link", "링크"), Map.entry("textbox", "입력칸"),
            Map.entry("searchbox", "검색칸"), Map.entry("checkbox", "체크박스"), Map.entry("radio", "선택 버튼"),
            Map.entry("combobox", "선택 상자"), Map.entry("listbox", "목록 상자"), Map.entry("option", "선택지"),
            Map.entry("heading", "제목"), Map.entry("tab", "탭"), Map.entry("menuitem", "메뉴"),
            Map.entry("menu", "메뉴"), Map.entry("img", "이미지"), Map.entry("dialog", "창"),
            Map.entry("navigation", "메뉴 영역"), Map.entry("row", "행"), Map.entry("cell", "칸"),
            Map.entry("listitem", "목록 항목"), Map.entry("switch", "스위치"), Map.entry("slider", "슬라이더"),
            Map.entry("spinbutton", "숫자 입력칸"), Map.entry("table", "표"), Map.entry("form", "입력 양식"));

    static String roleWord(SiteMapPromptService.SelectorCall call) {
        return switch (call.method()) {
            case "getByRole" -> ROLE_WORDS.getOrDefault(call.value(), "요소");
            case "getByText" -> "글자";
            case "getByLabel", "getByPlaceholder" -> "입력칸";
            default -> "요소";
        };
    }

    /** 앞 글자의 받침에 맞는 조사. 한글이 아니면(따옴표로 끝나는 영문 등) "을(를)" 처럼 둘 다 적는다. */
    static String josa(String word, String withBatchim, String withoutBatchim) {
        if (word == null || word.isEmpty()) {
            return withBatchim + "(" + withoutBatchim + ")";
        }
        char last = word.charAt(word.length() - 1);
        if (last == '\'' && word.length() > 1) {
            last = word.charAt(word.length() - 2);
        }
        if (last < 0xAC00 || last > 0xD7A3) {
            return withBatchim + "(" + withoutBatchim + ")";
        }
        return (last - 0xAC00) % 28 != 0 ? withBatchim : withoutBatchim;
    }

    // ---------------------------------------------------------------- 흐름 이름

    private static final Pattern FIRST_TEST = Pattern.compile(
            "(?<![\\w.$])test(?:\\.(?:only|skip|fixme|fail|slow))?\\(\\s*(['\"`])((?:\\\\.|(?!\\1).)*)\\1");

    /** spec 본문의 첫 test('...') 제목. test.describe · test.step 은 건너뛴다. 없으면 null. */
    static String firstTestTitle(String content) {
        if (content == null) {
            return null;
        }
        Matcher m = FIRST_TEST.matcher(content);
        if (!m.find()) {
            return null;
        }
        String title = m.group(2).replaceAll("\\\\(.)", "$1").trim();
        return title.isEmpty() ? null : title;
    }

    /** spec 경로의 파일 이름 (tests/recorded/order.spec.ts → order.spec.ts). */
    static String fileName(String specPath) {
        int slash = specPath.lastIndexOf('/');
        return slash >= 0 ? specPath.substring(slash + 1) : specPath;
    }

    // ---------------------------------------------------------------- 사이트 탐색 경고

    /** 사이트 탐색 경고 하나를 화면 문제로 읽은 결과. url 은 OPEN_FAILED 일 때 연 주소. */
    record WarningIssue(String kind, String message, String url, String action) {}

    private static final Pattern OPEN_FAILED_WARNING = Pattern.compile("^열기 실패: (\\S+)");

    /**
     * analyze.js 의 경고 문구를 화면 문제로 바꾼다. 화면을 짚을 수 없는 경고(페이지 수 · 시간 상한)는 null.
     * 문구는 ai-runner/analyze.js 의 warn(...) 과 맞춰야 한다.
     */
    static WarningIssue readWarning(String warning) {
        if (warning == null) {
            return null;
        }
        if (warning.startsWith("로그인 화면에서 탐색이 멈췄습니다")) {
            return new WarningIssue(ISSUE_LOGIN_REQUIRED, "로그인이 필요해 이 화면에서 탐색이 멈췄습니다", null, "SET_LOGIN");
        }
        if (warning.startsWith("로그인에 실패했습니다") || warning.startsWith("로그인 처리 중 오류")
                || warning.startsWith("로그인 화면에서 비밀번호 입력란을 찾지 못")
                || warning.startsWith("로그인 화면에서 아이디 입력란을 찾지 못")) {
            return new WarningIssue(ISSUE_LOGIN_REQUIRED, "로그인에 실패했습니다. 아이디와 비밀번호를 확인하세요", null, "SET_LOGIN");
        }
        Matcher open = OPEN_FAILED_WARNING.matcher(warning);
        if (open.find()) {
            return new WarningIssue(ISSUE_OPEN_FAILED, MSG_OPEN_FAILED, open.group(1), "RERUN");
        }
        if (warning.startsWith("첫 화면에 상호작용 가능한 DOM 요소가 없습니다")) {
            return new WarningIssue(ISSUE_EXPLORE_STOPPED, "화면 요소를 읽을 수 없어 탐색을 멈췄습니다", null, "NONE");
        }
        return null;
    }
}
