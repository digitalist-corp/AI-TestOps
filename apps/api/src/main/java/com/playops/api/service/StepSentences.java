package com.playops.api.service;

import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Playwright 단계 기록을 AI 없이 한국어 문장으로 바꾸는 규칙 (#84).
 * 제목 모양은 Playwright 1.53 리포터 기준: {@code Click getByRole('button', { name: '로그인' })}, {@code Fill "값" getByLabel('아이디')},
 * {@code Navigate to "/login"}. expect 제목은 매처 이름뿐이라 리포터가 남긴 소스 한 줄에서 대상을 찾는다. 모르는 단계는 제목 그대로.
 */
final class StepSentences {

    private StepSentences() {}

    private static final String MASK = "****";
    private static final Pattern SECRET_TARGET = Pattern.compile("pass|pwd|비밀번호|암호", Pattern.CASE_INSENSITIVE);
    private static final Pattern NAVIGATE = Pattern.compile("^(Navigate to|Fetch) \"(.*)\"$");
    private static final Pattern EXPECT_CALL = Pattern.compile("expect(?:\\.soft|\\.poll)?\\(");
    /** expect(값, '메시지') 의 메시지 */
    private static final Pattern EXPECT_MESSAGE = Pattern.compile(",\\s*(?:'((?:[^'\\\\]|\\\\.)*)'|\"((?:[^\"\\\\]|\\\\.)*)\")\\s*$");
    private static final Pattern WITH_VALUE = Pattern.compile("^(Fill|Type|Press) \"(.*)\" ([A-Za-z_$][\\w.$]*\\(.*)$");
    private static final Pattern ACTION = Pattern.compile(
            "^(Click|Double click|Tap|Check|Uncheck|Hover|Select option|Clear|Focus|Evaluate) (.+)$");
    private static final Pattern CALL = Pattern.compile(
            "(getByRole|getByText|getByLabel|getByPlaceholder|getByTestId|getByTitle|getByAltText|locator)\\(");
    private static final Pattern QUOTED = Pattern.compile("'((?:[^'\\\\]|\\\\.)*)'|\"((?:[^\"\\\\]|\\\\.)*)\"");
    private static final Pattern ROLE_NAME = Pattern.compile("name:\\s*(?:'((?:[^'\\\\]|\\\\.)*)'|\"((?:[^\"\\\\]|\\\\.)*)\")");

    private static final Map<String, String> ROLES = Map.ofEntries(
            Map.entry("button", "버튼"), Map.entry("link", "링크"), Map.entry("heading", "제목"),
            Map.entry("textbox", "입력란"), Map.entry("checkbox", "체크박스"), Map.entry("radio", "라디오 버튼"),
            Map.entry("combobox", "선택 상자"), Map.entry("tab", "탭"), Map.entry("menuitem", "메뉴"),
            Map.entry("option", "항목"), Map.entry("img", "이미지"), Map.entry("cell", "칸"), Map.entry("row", "행"),
            Map.entry("dialog", "대화상자"), Map.entry("listitem", "목록 항목"), Map.entry("navigation", "메뉴 영역"));

    /** category: pw:api | expect | test.step. code: expect 단계의 소스 한 줄 (없으면 null). */
    static String sentence(String category, String title, String code) {
        if (title == null) return "";
        if ("test.step".equals(category)) return title;
        if ("expect".equals(category)) return expectSentence(title, code);

        Matcher m = NAVIGATE.matcher(title);
        if (m.matches()) return "'" + m.group(2) + (m.group(1).equals("Fetch") ? "' 주소 요청" : "' 페이지로 이동");
        m = WITH_VALUE.matcher(title);
        if (m.matches()) {
            Target t = target(m.group(3));
            return switch (m.group(1)) {
                case "Press" -> t.phrase() + "에서 " + m.group(2) + " 키 누름";
                default -> {
                    String value = SECRET_TARGET.matcher(m.group(3)).find() ? MASK : m.group(2);
                    yield (t.name() == null ? "" : t.name() + " ") + "입력란에 '" + value + "' 입력";
                }
            };
        }
        m = ACTION.matcher(title);
        if (m.matches()) {
            String p = target(m.group(2)).phrase();
            return switch (m.group(1)) {
                case "Double click" -> p + " 두 번 클릭";
                case "Check" -> p + " 체크";
                case "Uncheck" -> p + " 체크 해제";
                case "Hover" -> p + "에 마우스 올림";
                case "Select option" -> p + "에서 항목 선택";
                case "Clear" -> p + " 비우기";
                case "Focus" -> p + "에 커서 두기";
                case "Evaluate" -> p + " 값 읽기";
                default -> p + " 클릭";
            };
        }
        return title;
    }

    private static String expectSentence(String matcher, String code) {
        String arg = code == null ? null : expectArg(code);
        boolean negated = code != null && code.contains(".not.");
        Matcher message = arg == null ? null : EXPECT_MESSAGE.matcher(arg);
        String base;
        if (message != null && message.find()) {
            base = "'" + (message.group(1) != null ? message.group(1) : message.group(2)) + "' 확인";
        } else if (arg != null && arg.trim().equals("page")) {
            base = switch (matcher) {
                case "toHaveURL" -> "페이지 주소 확인";
                case "toHaveTitle" -> "페이지 제목 확인";
                default -> "페이지 확인";
            };
        } else if (arg != null && !CALL.matcher(arg).find()) {
            base = "값 확인";
        } else {
            String p = arg == null ? "" : target(arg).phrase();
            String lead = p.isEmpty() ? "" : p + subjectParticle(p) + " ";
            String of = p.isEmpty() ? "" : p + "의 ";
            base = switch (matcher) {
                case "toBeVisible" -> lead + "보이는지 확인";
                case "toBeHidden" -> lead + "안 보이는지 확인";
                case "toHaveText", "toContainText" -> of + "글자 확인";
                case "toHaveValue" -> of + "값 확인";
                case "toHaveCount" -> of + "개수 확인";
                case "toHaveAttribute" -> of + "속성 확인";
                case "toBeChecked" -> lead + "체크됐는지 확인";
                case "toBeEnabled" -> lead + "누를 수 있는지 확인";
                case "toBeDisabled" -> lead + "막혀 있는지 확인";
                case "toHaveURL" -> "페이지 주소 확인";
                case "toHaveTitle" -> "페이지 제목 확인";
                default -> (p.isEmpty() ? "" : p + " ") + "확인";
            };
        }
        return negated ? base + " (아닌지)" : base;
    }

    /** {@code expect(...)} 괄호 안. 따옴표 안의 괄호는 세지 않는다. */
    static String expectArg(String code) {
        Matcher call = EXPECT_CALL.matcher(code);
        if (!call.find()) return null;
        int open = call.end() - 1;
        int depth = 0;
        char quote = 0;
        for (int i = open; i < code.length(); i++) {
            char c = code.charAt(i);
            if (quote != 0) {
                if (c == '\\') i++;
                else if (c == quote) quote = 0;
            } else if (c == '\'' || c == '"' || c == '`') {
                quote = c;
            } else if (c == '(') {
                depth++;
            } else if (c == ')' && --depth == 0) {
                return code.substring(open + 1, i);
            }
        }
        return null;
    }

    /** name: 따옴표로 감싼 이름 (없으면 null). kind: "버튼" · "글자" 같은 종류 (없으면 ""). */
    private record Target(String name, String kind) {
        String phrase() {
            if (name == null) return kind;
            return kind.isEmpty() ? name : name + " " + kind;
        }
    }

    /** 체인의 마지막 getBy*() · locator() 를 읽는다. */
    private static Target target(String locator) {
        Matcher m = CALL.matcher(locator);
        int at = -1;
        String fn = null;
        while (m.find()) {
            at = m.end();
            fn = m.group(1);
        }
        if (fn == null) return new Target("'" + locator + "'", "");
        String args = locator.substring(at);
        String first = firstQuoted(args);
        if (fn.equals("getByRole")) {
            Matcher n = ROLE_NAME.matcher(args);
            String name = n.find() ? "'" + (n.group(1) != null ? n.group(1) : n.group(2)) + "'" : null;
            return new Target(name, first == null ? "" : ROLES.getOrDefault(first, first));
        }
        String name = first == null ? null : "'" + first + "'";
        return new Target(name, fn.equals("getByText") ? "글자" : "");
    }

    private static String firstQuoted(String s) {
        Matcher q = QUOTED.matcher(s);
        return q.find() ? (q.group(1) != null ? q.group(1) : q.group(2)) : null;
    }

    /** 받침이 있으면 "이", 없으면 "가", 한글이 아니면 "이(가)". */
    private static String subjectParticle(String phrase) {
        for (int i = phrase.length() - 1; i >= 0; i--) {
            char c = phrase.charAt(i);
            if (c == '\'' || c == ' ') continue;
            if (c >= 0xAC00 && c <= 0xD7A3) return (c - 0xAC00) % 28 != 0 ? "이" : "가";
            return "이(가)";
        }
        return "이(가)";
    }
}
