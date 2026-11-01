package com.playops.api.chat.tools;

import com.playops.api.llm.LlmToolSpec;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 기존 채팅 도구(AiChatToolService 에서 옮겨 온 8개)가 같이 쓰는 작은 도움 함수들.
 */
final class CoreToolSupport {

    /** 도구 결과로 모델에게 돌려줄 텍스트 상한. 로그 전문을 그대로 넣으면 컨텍스트가 터진다. */
    static final int MAX_RESULT_CHARS = 6000;

    private CoreToolSupport() {
    }

    /** 프로젝트를 대상으로 하는 도구라면 모두 갖는 공통 인자. */
    static Map<String, Object> withProjectId(Map<String, Object> properties) {
        Map<String, Object> merged = new LinkedHashMap<>(properties);
        merged.put("projectId", LlmToolSpec.string(
                "대상 프로젝트 id. 대화 중인 프로젝트가 있으면 생략해도 된다."));
        return merged;
    }

    static String truncate(String text) {
        if (text == null) {
            return "";
        }
        if (text.length() <= MAX_RESULT_CHARS) {
            return text;
        }
        return text.substring(0, MAX_RESULT_CHARS) + "\n... (이후 생략)";
    }

    /**
     * 카드에 실을 한 줄 설명.
     *
     * 모델이 AI 작업에 넘기는 지시문은 수천 자에 이르는 상세 명세라, 그대로 카드에 넣으면
     * 화면이 글로 덮인다. 전문은 'AI 검토' 화면에서 볼 수 있으므로 여기서는 앞부분만 보여준다.
     */
    static String summarize(String instruction) {
        if (instruction == null) {
            return "";
        }
        String oneLine = instruction.replaceAll("\\s+", " ").trim();
        return oneLine.length() <= 160 ? oneLine : oneLine.substring(0, 160) + "…";
    }

    /**
     * Playwright 는 testDir(./tests) 안의 *.spec.ts 만 테스트로 수집한다.
     * 모델이 경로를 대충 주더라도 실제로 실행될 수 있는 자리에 놓이도록 맞춰 준다.
     */
    static String normalizeSpecPath(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String path = raw.trim().replace('\\', '/');
        while (path.startsWith("/") || path.startsWith("./")) {
            path = path.startsWith("/") ? path.substring(1) : path.substring(2);
        }
        if (!path.endsWith(".spec.ts") && !path.endsWith(".spec.js")
                && !path.endsWith(".test.ts") && !path.endsWith(".test.js")) {
            path = path.replaceAll("\\.(ts|js)$", "") + ".spec.ts";
        }
        if (!path.startsWith("tests/")) {
            path = "tests/" + path;
        }
        return path;
    }

    /** 파일 확장자로 코드 블록 언어를 짐작한다. 모르면 null. */
    static String languageOf(String path) {
        if (path == null) {
            return null;
        }
        String lower = path.toLowerCase();
        if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
        if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs") || lower.endsWith(".jsx")) return "javascript";
        if (lower.endsWith(".json")) return "json";
        if (lower.endsWith(".md")) return "markdown";
        if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
        if (lower.endsWith(".html")) return "html";
        if (lower.endsWith(".css")) return "css";
        return null;
    }
}
