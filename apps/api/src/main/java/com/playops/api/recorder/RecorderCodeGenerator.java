package com.playops.api.recorder;

import com.playops.api.recorder.RecorderDtos.RecordedStep;

import java.net.URI;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * 기록한 단계(RecordedStep)를 Playwright 테스트 코드로 바꾼다. AI 를 쓰지 않는 단순 변환이다.
 * 모양은 docs/design/recorder-contract.md 의 "생성 코드 모양"을 따른다.
 */
public final class RecorderCodeGenerator {

    static final String FRAGILE_COMMENT = " // 순번 의존 — 화면이 바뀌면 깨질 수 있음";
    static final String DEFAULT_TITLE = "녹화한 테스트";
    static final String DEFAULT_SECRET_ENV = "LOGIN_PASSWORD";

    /** record.js 가 만드는 Playwright 로케이터 식만 받는다 — 코드에 그대로 들어가므로 다른 문장이 끼면 안 된다. */
    private static final Pattern SAFE_SELECTOR = Pattern.compile(
            "^(getBy(Role|Text|Label|Placeholder|TestId|AltText|Title)|locator)\\(.*\\)$");
    private static final java.util.Set<String> SELECTOR_WORDS = java.util.Set.of(
            "getByRole", "getByText", "getByLabel", "getByPlaceholder", "getByTestId", "getByAltText", "getByTitle",
            "locator", "nth", "first", "last", "filter", "name", "exact", "true", "false", "hasText", "level");
    private static final Pattern ENV_NAME = Pattern.compile("^[A-Z_][A-Z0-9_]{0,63}$");
    private static final DateTimeFormatter DATE_SLUG = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");

    private RecorderCodeGenerator() {
    }

    public static String generate(String title, List<RecordedStep> steps, String baseUrl) {
        StringBuilder sb = new StringBuilder();
        sb.append("import { test, expect } from '@playwright/test';\n\n");
        sb.append("test(").append(quote(titleOrDefault(title))).append(", async ({ page }) => {\n");
        for (RecordedStep step : steps) {
            sb.append("  ").append(line(step, baseUrl)).append('\n');
        }
        sb.append("});\n");
        return sb.toString();
    }

    static String line(RecordedStep step, String baseUrl) {
        String action = step.action() == null ? "" : step.action();
        if ("goto".equals(action)) {
            return "await page.goto(" + quote(gotoTarget(step.value(), baseUrl)) + ");";
        }
        if ("press".equals(action) && step.selector() == null) {
            return "await page.keyboard.press(" + quote(nullToEmpty(step.value())) + ");";
        }
        if (!isSafeSelector(step.selector())) {
            return "// 건너뜀: " + comment(step.label()) + " (쓸 수 있는 셀렉터가 없습니다)";
        }
        String loc = "page." + step.selector();
        String code = switch (action) {
            case "click" -> "await " + loc + ".click();";
            case "fill" -> "await " + loc + ".fill(" + fillValue(step) + ");";
            case "press" -> "await " + loc + ".press(" + quote(nullToEmpty(step.value())) + ");";
            case "assertVisible" -> "await expect(" + loc + ").toBeVisible();";
            case "assertText" -> "await expect(" + loc + ").toHaveText(" + quote(nullToEmpty(step.value())) + ");";
            default -> "// 건너뜀: 알 수 없는 동작 " + comment(action);
        };
        return step.fragile() && !code.startsWith("//") ? code + FRAGILE_COMMENT : code;
    }

    private static String fillValue(RecordedStep step) {
        if (step.secretEnv() != null) {
            String env = ENV_NAME.matcher(step.secretEnv()).matches() ? step.secretEnv() : DEFAULT_SECRET_ENV;
            return "process.env." + env + " ?? ''";
        }
        return quote(nullToEmpty(step.value()));
    }

    /** baseUrl 과 같은 출처면 경로만 쓴다 (Playwright config 의 baseURL 을 쓰게). */
    static String gotoTarget(String value, String baseUrl) {
        String v = nullToEmpty(value).trim();
        if (v.isEmpty()) {
            return "/";
        }
        if (baseUrl == null || baseUrl.isBlank() || !(v.startsWith("http://") || v.startsWith("https://"))) {
            return v;
        }
        try {
            URI u = URI.create(v);
            URI b = URI.create(baseUrl.trim());
            if (sameOrigin(u, b)) {
                String path = u.getRawPath() == null || u.getRawPath().isEmpty() ? "/" : u.getRawPath();
                if (u.getRawQuery() != null) {
                    path += "?" + u.getRawQuery();
                }
                if (u.getRawFragment() != null) {
                    path += "#" + u.getRawFragment();
                }
                return path;
            }
        } catch (IllegalArgumentException ignored) {
            // 주소 모양이 아니면 그대로 쓴다
        }
        return v;
    }

    private static boolean sameOrigin(URI a, URI b) {
        return a.getScheme() != null && a.getScheme().equalsIgnoreCase(b.getScheme())
                && a.getHost() != null && a.getHost().equalsIgnoreCase(b.getHost())
                && port(a) == port(b);
    }

    private static int port(URI u) {
        if (u.getPort() != -1) {
            return u.getPort();
        }
        return "https".equalsIgnoreCase(u.getScheme()) ? 443 : 80;
    }

    /**
     * 셀렉터는 코드에 그대로 들어가므로 Playwright 로케이터 식인지 확인한다.
     * 작은따옴표 문자열 밖에는 허용한 이름(getByRole · nth · exact 등) · 숫자 · 괄호 · 쉼표 · 점 · 콜론만 올 수 있다.
     */
    static boolean isSafeSelector(String selector) {
        if (selector == null || selector.isEmpty() || selector.length() > 1000 || !SAFE_SELECTOR.matcher(selector).matches()) {
            return false;
        }
        boolean inString = false;
        StringBuilder word = new StringBuilder();
        for (int i = 0; i < selector.length(); i++) {
            char ch = selector.charAt(i);
            if (ch == '\n' || ch == '\r' || ch == '\u2028' || ch == '\u2029') {
                return false;
            }
            if (inString) {
                if (ch == '\\') {
                    i++;
                } else if (ch == '\'') {
                    inString = false;
                }
                continue;
            }
            if (Character.isLetterOrDigit(ch) || ch == '_') {
                word.append(ch);
                continue;
            }
            if (!allowedWord(word)) {
                return false;
            }
            word.setLength(0);
            if (ch == '\'') {
                inString = true;
            } else if ("(){},.: ".indexOf(ch) < 0) {
                return false;
            }
        }
        return !inString && allowedWord(word);
    }

    private static boolean allowedWord(CharSequence word) {
        String w = word.toString();
        return w.isEmpty() || w.chars().allMatch(Character::isDigit) || SELECTOR_WORDS.contains(w);
    }

    /** 저장 경로 제안: tests/recorded/<영문 slug 또는 날짜>.spec.ts */
    public static String suggestSpecPath(String title, LocalDateTime now) {
        String slug = titleOrDefault(title).toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
        if (slug.length() > 50) {
            slug = slug.substring(0, 50).replaceAll("-+$", "");
        }
        if (slug.isEmpty()) {
            slug = "recorded-" + DATE_SLUG.format(now);
        }
        return "tests/recorded/" + slug + ".spec.ts";
    }

    static String titleOrDefault(String title) {
        return title == null || title.isBlank() ? DEFAULT_TITLE : title.trim();
    }

    /** 작은따옴표 JS 문자열. 줄바꿈 · 역슬래시 · 따옴표를 이스케이프한다. */
    static String quote(String s) {
        StringBuilder sb = new StringBuilder("'");
        for (char ch : s.toCharArray()) {
            switch (ch) {
                case '\\' -> sb.append("\\\\");
                case '\'' -> sb.append("\\'");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case ' ' -> sb.append("\\u2028");
                case ' ' -> sb.append("\\u2029");
                default -> sb.append(ch);
            }
        }
        return sb.append('\'').toString();
    }

    private static String comment(String s) {
        return nullToEmpty(s).replaceAll("[\\r\\n\\u2028\\u2029]+", " ");
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }
}
