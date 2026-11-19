package com.playops.api.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * 학습 루프 E-04 · E-05: 실패를 서명으로 묶고 원인 5종으로 나눈다. AI 없이 규칙으로만 — 평가셋 docs/eval/failure-classify.json.
 * 서명 = 첫 줄(숫자 · 주소를 지움) + 로케이터 + spec 경로. 스택은 저장하지 않아 맨 위 프레임인 spec 경로로 대신하고, 줄 번호는 수정 뒤 바뀌어 뺀다.
 */
final class FailureRules {

    private FailureRules() {
    }

    enum Cause { PRODUCT_DEFECT, SCRIPT_ERROR, ENVIRONMENT, FLAKY, UNCLASSIFIED }

    /** key: 묶음 키(sha1 앞 12자). head · locator 는 비슷한 과거 수정을 찾을 때 쓴다. */
    record Signature(String key, String head, String locator) {}

    private static final Pattern ANSI = Pattern.compile("\\u001B\\[[0-9;]*[A-Za-z]");
    private static final Pattern URL = Pattern.compile("https?://\\S+");
    private static final Pattern NUMBER = Pattern.compile("\\d+");

    private static final Pattern ENVIRONMENT = Pattern.compile(
            "net::ERR_|ECONNREFUSED|ENOTFOUND|ECONNRESET|EAI_AGAIN|socket hang up|browserType\\.launch"
                    + "|Executable doesn't exist|page\\.goto: Timeout|No space left");
    private static final Pattern NOT_FOUND = Pattern.compile("element\\(s\\) not found|element not found");
    private static final Pattern SCRIPT = Pattern.compile(
            "TypeError|ReferenceError|SyntaxError|is not a function|Cannot find module|strict mode violation"
                    + "|is not a valid selector|Element is not an? |waiting for (getBy|locator\\()");
    private static final Pattern RECEIVED = Pattern.compile("Received(?: string| value)?:|toHaveURL");

    static Signature signature(String specPath, String error) {
        String text = error == null ? "" : ANSI.matcher(error).replaceAll("");
        String head = text.lines().map(String::strip).filter(line -> !line.isEmpty()).findFirst().orElse("")
                .replaceFirst("^Error: ", "");
        head = NUMBER.matcher(URL.matcher(head).replaceAll("<url>")).replaceAll("N");
        SiteMapPromptService.SelectorCall call = text.isBlank() ? null : CoverageRules.targetSelector(text);
        String locator = call == null ? null : call.text();
        return new Signature(sha1(head + "\n" + locator + "\n" + specPath).substring(0, 12), head, locator);
    }

    /** 서명이 같은 것끼리, 처음 나온 순서대로 */
    static <T> Map<String, List<T>> cluster(List<T> items, Function<T, Signature> signature) {
        return items.stream().collect(Collectors.groupingBy(
                item -> signature.apply(item).key(), LinkedHashMap::new, Collectors.toCollection(ArrayList::new)));
    }

    /**
     * history: 같은 케이스의 이전 상태(최신 먼저). 지금 실패를 앞에 붙여 통과 · 실패가 두 번 넘게 뒤집혔으면 불안정.
     * expect 실패는 요소를 찾았으면 제품 결함(값 · 주소가 기대와 다름), 못 찾았으면 스크립트 오류로 본다.
     */
    static Cause classify(String error, List<String> history) {
        if (error == null || error.isBlank()) return Cause.UNCLASSIFIED;
        String text = ANSI.matcher(error).replaceAll("");
        if (ENVIRONMENT.matcher(text).find()) return Cause.ENVIRONMENT;
        if (flips(history) >= 2) return Cause.FLAKY;
        if (text.contains("expect(")) {
            if (NOT_FOUND.matcher(text).find()) return Cause.SCRIPT_ERROR;
            if (RECEIVED.matcher(text).find()) return Cause.PRODUCT_DEFECT;
        }
        if (SCRIPT.matcher(text).find()) return Cause.SCRIPT_ERROR;
        return Cause.UNCLASSIFIED;
    }

    private static int flips(List<String> history) {
        String previous = "FAILED";
        int flips = 0;
        for (String status : history) {
            if (!"PASSED".equals(status) && !"FAILED".equals(status)) continue;
            if (!status.equals(previous)) flips++;
            previous = status;
        }
        return flips;
    }

    private static String sha1(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-1").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
