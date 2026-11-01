package com.playops.api.chat;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.Map;

/**
 * 메시지 본문의 블록 하나. 모양은 docs/design/ai-chat-agent-contract.md 의 ChatBlock 과 같다.
 * DB(ai_chat_messages.blocks)에 JSON 으로 저장하고, 화면에도 그대로 내려 준다.
 *
 * type=text 면 text 만, type=tool 이면 나머지 필드를 쓴다. 비어 있는 필드는 JSON 에서 빠진다.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = true)
public class ChatBlock {

    public static final String TEXT = "text";
    public static final String TOOL = "tool";

    public String type;
    public String text;

    public String callId;
    public String name;
    /** READ · RUN · CHANGE */
    public String tier;
    public Map<String, Object> input;
    /** running · ok · error · denied · cancelled */
    public String status;
    public String summary;
    /** 화면용 결과 글 (최대 4000자). 다음 질문 때 모델에게 보낼 이전 도구 결과로도 쓴다. */
    public String output;
    public ToolDisplay display;
    public Long durationMs;
    public Permission permission;

    public static ChatBlock text(String text) {
        ChatBlock block = new ChatBlock();
        block.type = TEXT;
        block.text = text;
        return block;
    }

    public static ChatBlock tool(String callId, String name, ToolTier tier, Map<String, Object> input) {
        ChatBlock block = new ChatBlock();
        block.type = TOOL;
        block.callId = callId;
        block.name = name;
        block.tier = tier.name();
        block.input = input == null ? Map.of() : input;
        block.status = "running";
        return block;
    }

    @JsonIgnore // 이름을 isText 로 하면 Jackson 이 "text" 속성과 섞어 글이 사라진다
    public boolean isTextBlock() {
        return TEXT.equals(type);
    }

    @JsonIgnore
    public boolean isToolBlock() {
        return TOOL.equals(type);
    }

    /** RUN 도구에 대해 사용자에게 물은 기록. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Permission {
        public String requestId;
        public String reason;
        /** ALLOW · ALLOW_SESSION · DENY. 아직 답이 없으면 null. */
        public String decision;

        public Permission() {
        }

        public Permission(String requestId, String reason) {
            this.requestId = requestId;
            this.reason = reason;
        }
    }
}
