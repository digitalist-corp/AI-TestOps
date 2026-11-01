package com.playops.api.chat.tools;

import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolSpec;

import java.util.LinkedHashMap;
import java.util.Map;

/** 새 채팅 도구들이 함께 쓰는 작은 도우미 모음. */
final class ToolSupport {

    /** 도구 결과로 모델에게 돌려줄 텍스트 상한. 기존 AiChatToolService 와 같은 값이다. */
    static final int MAX_RESULT_CHARS = 6000;

    private ToolSupport() {
    }

    /** 프로젝트를 대상으로 하는 도구라면 모두 갖는 공통 인자. */
    static Map<String, Object> withProjectId(Map<String, Object> properties) {
        Map<String, Object> merged = new LinkedHashMap<>(properties);
        merged.put("projectId", LlmToolSpec.string("대상 프로젝트 id. 대화 중인 프로젝트가 있으면 생략해도 된다."));
        return merged;
    }

    /**
     * 이번 호출이 대상으로 삼을 프로젝트. 정해지지 않았으면 null.
     *
     * 모델이 인자로 다른 프로젝트를 지정해도 관리자가 아니면 대화 중인 프로젝트 밖은 볼 수 없다.
     * (ChatToolContext.projectIdFor 는 인자를 그대로 믿으므로, 새 도구는 이 검사를 먼저 거친다.)
     */
    static String optionalProject(LlmToolCall call, ChatToolContext context) {
        String explicit = call.arg("projectId");
        if (explicit == null) {
            return context.hasProject() ? context.projectId() : null;
        }
        if (context.admin() || (context.hasProject() && context.projectId().equals(explicit))) {
            return explicit;
        }
        throw new ApiException(403, "열어 둔 프로젝트가 아닌 다른 프로젝트는 볼 수 없습니다.");
    }

    /** optionalProject 와 같지만, 프로젝트를 알 수 없으면 실패시킨다. */
    static String requireProject(LlmToolCall call, ChatToolContext context) {
        optionalProject(call, context);
        return context.projectIdFor(call);
    }

    static ChatToolOutput failed(ApiException e) {
        return ChatToolOutput.failed(e.getMessage());
    }

    static String truncate(String text) {
        return truncate(text, MAX_RESULT_CHARS);
    }

    static String truncate(String text, int max) {
        if (text == null) {
            return "";
        }
        if (text.length() <= max) {
            return text;
        }
        return text.substring(0, max) + "\n... (이후 생략)";
    }

    /** 여러 줄을 한 줄로 합치고 길면 자른다. 표나 목록의 한 칸에 넣을 때 쓴다. */
    static String oneLine(String text, int max) {
        if (text == null) {
            return "";
        }
        String line = text.replaceAll("\\s+", " ").trim();
        return line.length() <= max ? line : line.substring(0, max) + "…";
    }

    /** 첫 번째로 내용이 있는 줄. 오류 메시지처럼 길고 여러 줄인 글에서 요점만 뽑을 때 쓴다. */
    static String firstLine(String text, int max) {
        if (text == null) {
            return "";
        }
        for (String line : text.split("\\R")) {
            if (!line.isBlank()) {
                return oneLine(line, max);
            }
        }
        return "";
    }
}
