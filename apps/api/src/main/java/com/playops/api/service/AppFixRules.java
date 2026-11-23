package com.playops.api.service;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 제품 코드 수정안의 규칙들. AI 없이 같은 입력에 같은 결과를 낸다.
 * 분류는 학습 루프의 원인(FailureRules)과 사람이 고친 원인을 그대로 따르고, 제품 결함만 코드 · API 후보로 나눈다.
 */
final class AppFixRules {

    private AppFixRules() {
    }

    /** APP_CODE · APP_API 만 수정 제안 후보다. 응답 코드나 문구 하나로는 확정하지 않는다. */
    enum Category { APP_CODE, APP_API, TEST, ENVIRONMENT, UNKNOWN;

        boolean candidate() {
            return this == APP_CODE || this == APP_API;
        }
    }

    /** 수정 하나: path 파일에서 find 가 정확히 한 번 나오면 replace 로 바꾼다. */
    record Edit(String path, String find, String replace) {}

    private static final Pattern RECEIVED_STATUS = Pattern.compile("Received(?: value)?:\\s*(\\d{3})\\b");
    /** 인증 · 권한 · 시간 초과 · 요청 과다는 제품 결함인지 응답 코드만으로 알 수 없다 */
    private static final Set<String> AMBIGUOUS_STATUS = Set.of("401", "403", "408", "429");

    static Category category(String error, List<String> history, String humanCause) {
        String cause = humanCause != null ? humanCause : FailureRules.classify(error, history).name();
        return switch (cause) {
            case "ENVIRONMENT" -> Category.ENVIRONMENT;
            case "SCRIPT_ERROR" -> Category.TEST;
            case "PRODUCT_DEFECT" -> productCategory(error);
            default -> Category.UNKNOWN;
        };
    }

    private static Category productCategory(String error) {
        Matcher status = RECEIVED_STATUS.matcher(error == null ? "" : error);
        if (!status.find()) return Category.APP_CODE;
        String code = status.group(1);
        if (AMBIGUOUS_STATUS.contains(code)) return Category.UNKNOWN;
        return code.startsWith("4") || code.startsWith("5") ? Category.APP_API : Category.APP_CODE;
    }

    // ── 증거 정리: 모델 입력 · 저장 전에 자격 증명 · 개인정보 · 환경값을 지운다 ──

    private static final Pattern AUTH_HEADER = Pattern.compile("(?i)\\b(authorization|cookie|set-cookie|x-api-key)\\s*[:=][^\\n]*");
    private static final Pattern BEARER = Pattern.compile("(?i)\\bbearer\\s+[A-Za-z0-9._~+/=-]+");
    /** key=value · "key":"value" · key='value'. 키 앞에 붙은 말(access_token 등)과 따옴표로 감싼 값까지 */
    private static final Pattern SECRET_PAIR = Pattern.compile(
            "(?i)\\b([A-Za-z_-]*(?:password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key|session(?:id)?)[\"']?\\s*[:=]\\s*)"
                    + "(\"[^\"]*\"|'[^']*'|[^\\s,;&\"'}]+)");
    /** 주소에 넣은 아이디 · 비밀번호 (https://id:pw@host) */
    private static final Pattern URL_USERINFO = Pattern.compile("(?i)\\b(https?://)[^/\\s@:]+:[^/\\s@]+@");
    private static final Pattern JWT = Pattern.compile("\\beyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}");
    private static final Pattern EMAIL = Pattern.compile("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}");
    private static final Pattern URL_QUERY = Pattern.compile("(https?://[^\\s?#\"']+)[?#][^\\s\"']*");
    /** 입력란에 친 값 (단계 문장 · Playwright 호출). 이름 · 주소 같은 개인정보일 수 있다 */
    private static final Pattern TYPED = Pattern.compile("(입력란에 |\\.fill\\([^,]+,\\s*)(['\"])[^'\"\\n]*\\2");
    private static final Pattern PHONE = Pattern.compile("\\b01[016789]-?\\d{3,4}-?\\d{4}\\b");
    /** 너무 짧은 환경값은 흔한 글자와 겹쳐 지우지 않는다 */
    private static final int MIN_SECRET_LENGTH = 4;

    static String redact(String text, Collection<String> secrets) {
        if (text == null) return "";
        String out = text;
        for (String secret : secrets) {
            if (secret != null && secret.length() >= MIN_SECRET_LENGTH) out = out.replace(secret, "***");
        }
        out = AUTH_HEADER.matcher(out).replaceAll("$1: ***");
        out = BEARER.matcher(out).replaceAll("Bearer ***");
        out = SECRET_PAIR.matcher(out).replaceAll("$1***");
        out = URL_USERINFO.matcher(out).replaceAll("$1***@");
        out = JWT.matcher(out).replaceAll("***");
        out = URL_QUERY.matcher(out).replaceAll("$1");
        out = TYPED.matcher(out).replaceAll("$1$2***$2");
        out = EMAIL.matcher(out).replaceAll("***@***");
        return PHONE.matcher(out).replaceAll("***");
    }

    // ── 후보 파일을 찾을 단서 ──

    private static final Pattern URL_PATH = Pattern.compile("https?://[^/\\s\"']+(/[^\\s\"'?#)]*)");
    private static final Pattern API_PATH = Pattern.compile("(?<![\\w/])(/api/[A-Za-z0-9_./-]+)");
    private static final Pattern QUOTED = Pattern.compile("[\"']([^\"'\\n]{2,40})[\"']");
    private static final Pattern SOURCE_FILE = Pattern.compile("([A-Za-z0-9_-]+\\.(?:tsx|ts|jsx|js|vue|svelte|java|kt|py))\\b");
    /** Playwright 의 역할 이름 같은, 화면 글자가 아닌 따옴표 값 */
    private static final Set<String> NOT_CLUES = Set.of("button", "link", "heading", "textbox", "checkbox", "combobox", "tab",
            "menuitem", "dialog", "option", "row", "cell", "img", "listitem");

    static Set<String> clues(String evidence) {
        Set<String> out = new LinkedHashSet<>();
        if (evidence == null) return out;
        Matcher m = URL_PATH.matcher(evidence);
        while (m.find()) if (m.group(1).length() > 1) out.add(m.group(1));
        m = API_PATH.matcher(evidence);
        while (m.find()) out.add(m.group(1));
        m = SOURCE_FILE.matcher(evidence);
        while (m.find()) out.add(m.group(1));
        m = QUOTED.matcher(evidence);
        while (m.find()) {
            String value = m.group(1).strip();
            if (!NOT_CLUES.contains(value) && !value.startsWith("http")) out.add(value);
        }
        return out;
    }

    // ── diff: 서버가 원본에 직접 적용해 만든다. 적용할 수 없으면 null ──

    private static final int CONTEXT = 3;

    static String unifiedDiff(String path, String original, List<Edit> edits) {
        String changed = original;
        for (Edit edit : edits) {
            if (edit.find() == null || edit.find().isEmpty() || edit.replace() == null) return null;
            int at = changed.indexOf(edit.find());
            if (at < 0 || changed.indexOf(edit.find(), at + 1) >= 0) return null;
            changed = changed.substring(0, at) + edit.replace() + changed.substring(at + edit.find().length());
        }
        if (changed.equals(original)) return null;
        // ponytail: 마지막 줄바꿈이 없거나 바뀌는 파일은 "No newline" 표시를 만들지 않고 진단으로 내린다. 필요해지면 git apply --check 로 확인한다.
        if (!original.endsWith("\n") || !changed.endsWith("\n")) return null;

        String[] before = original.split("\n", -1);
        String[] after = changed.split("\n", -1);
        int prefix = 0;
        while (prefix < before.length && prefix < after.length && before[prefix].equals(after[prefix])) prefix++;
        int suffix = 0;
        while (suffix < before.length - prefix && suffix < after.length - prefix
                && before[before.length - 1 - suffix].equals(after[after.length - 1 - suffix])) suffix++;

        int start = Math.max(0, prefix - CONTEXT);
        // 끝의 빈 줄(파일 끝 줄바꿈)은 문맥으로 보이지 않는다
        int beforeEnd = Math.min(lastContent(before), before.length - suffix + CONTEXT);
        int afterEnd = Math.min(lastContent(after), after.length - suffix + CONTEXT);
        StringBuilder out = new StringBuilder()
                .append("--- a/").append(path).append('\n')
                .append("+++ b/").append(path).append('\n')
                .append("@@ -").append(start + 1).append(',').append(beforeEnd - start)
                .append(" +").append(start + 1).append(',').append(afterEnd - start).append(" @@\n");
        for (int i = start; i < prefix; i++) out.append(' ').append(before[i]).append('\n');
        for (int i = prefix; i < before.length - suffix; i++) out.append('-').append(before[i]).append('\n');
        for (int i = prefix; i < after.length - suffix; i++) out.append('+').append(after[i]).append('\n');
        for (int i = before.length - suffix; i < beforeEnd; i++) out.append(' ').append(before[i]).append('\n');
        return out.toString();
    }

    private static int lastContent(String[] lines) {
        return lines.length > 0 && lines[lines.length - 1].isEmpty() ? lines.length - 1 : lines.length;
    }
}
