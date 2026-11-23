package com.playops.api.chat.tools;

import com.playops.api.chat.ChatTool;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolDisplay;
import com.playops.api.chat.ToolTier;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolSpec;
import com.playops.api.service.OnboardingBriefingService;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

@Component
public class AskUserTool implements ChatTool {

    public static final String NAME = "ask_user";
    public static final String DISPLAY_KIND = "a2ui";
    private static final String CATALOG_ID = "https://playops.dev/a2ui/catalogs/chat/v1";

    private static final LlmToolSpec SPEC = new LlmToolSpec(NAME, """
            선택지 고르기, 짧은 입력, 실행 전 조건 확인이 필요하면 질문 화면을 띄웁니다. 성공하면 이번 답변이 끝나고 다음 사용자 메시지에 응답이 옵니다.
            데이터 표시는 기존 조회 도구를 사용하세요. 비밀 값은 set_env_variables 로 받으세요. 이미 답이 분명하면 질문 없이 진행하세요.
            부품은 40개까지, id 는 ^[A-Za-z_][A-Za-z0-9_]*$, root 하나에서 모든 부품을 한 번씩 참조하세요.
            문자열은 500자, 목록은 30개 항목, data 는 JSON 8KB까지입니다. data 를 참조하는 포인터는 {"@path":"/key"} 모양입니다.
            사용할 수 있는 부품과 속성(?는 선택):
            - Column: children (부품 id 배열)
            - Section: title (문자열), children (부품 id 배열)
            - Text: text (문자열 또는 포인터), variant? (body 또는 muted)
            - Notice: text (문자열 또는 포인터), tone (info, success, warning, danger)
            - CheckList: items (항목 배열 또는 포인터), value (문자열 배열을 가리키는 포인터)
            - ChoiceList: items (항목 배열 또는 포인터), value (문자열을 가리키는 포인터)
            - TextInput: label (문자열), value (문자열을 가리키는 포인터), placeholder? (문자열), multiline? (boolean)
            - Button: label (문자열), variant? (primary 또는 outline), action: {"event":{"name":"submit","context":{}}}
            항목은 {id,title,detail?,badge?}이며 각 속성은 문자열입니다. Button의 event.name은 submit 또는 cancel입니다.
            submit 버튼은 하나 이상 필요합니다. event.context 의 포인터는 사용자가 누르는 순간 값으로 바뀝니다.
            예: {"question":"어느 테스트를 다시 실행할까요?","components":[
              {"id":"root","component":"Column","children":["pick","ok"]},
              {"id":"pick","component":"ChoiceList","items":{"@path":"/items"},"value":{"@path":"/selected"}},
              {"id":"ok","component":"Button","label":"보내기","action":{"event":{"name":"submit","context":{"selected":{"@path":"/selected"}}}}}
            ],"data":{"items":[{"id":"login","title":"로그인"},{"id":"logout","title":"로그아웃"}],"selected":"login"}}
            """, LlmToolSpec.schema(Map.of(
            "question", Map.of("type", "string", "maxLength", ChatUiValidator.MAX_STRING_LENGTH),
            "components", Map.of("type", "array", "maxItems", ChatUiValidator.MAX_COMPONENTS,
                    "items", LlmToolSpec.schema(Map.of(
                            "id", Map.of("type", "string", "pattern", "^[A-Za-z_][A-Za-z0-9_]*$"),
                            "component", Map.of("type", "string", "enum", ChatUiValidator.COMPONENT_TYPES)),
                            "id", "component")),
            "data", Map.of("type", "object", "description", "화면의 초기 dataModel")),
            "question", "components", "data"));

    private final ChatUiValidator validator;

    public AskUserTool(ChatUiValidator validator) {
        this.validator = validator;
    }

    @Override
    public LlmToolSpec spec() {
        return SPEC;
    }

    @Override
    public ToolTier tier() {
        return ToolTier.READ;
    }

    @Override
    public ChatToolOutput execute(LlmToolCall call, ChatToolContext context) {
        if (context.messageId() == null || call.id() == null || call.id().isBlank()) {
            return ChatToolOutput.failed("ask_user 는 세션 채팅의 도구 호출에서만 사용할 수 있습니다.");
        }
        ChatUiValidator.Question validated;
        try {
            validated = validator.validate(call.arguments());
        } catch (IllegalArgumentException e) {
            return ChatToolOutput.failed(e.getMessage());
        }

        String question = validated.question();
        String surfaceId = "chat-" + context.messageId() + "-" + call.id();
        List<Map<String, Object>> messages = List.of(
                Map.of("version", OnboardingBriefingService.VERSION, "createSurface",
                        Map.of("surfaceId", surfaceId, "catalogId", CATALOG_ID, "dataModel", validated.data())),
                Map.of("version", OnboardingBriefingService.VERSION, "updateComponents",
                        Map.of("surfaceId", surfaceId, "components", validated.components())));
        ToolDisplay display = ToolDisplay.of(DISPLAY_KIND,
                Map.of("surfaceId", surfaceId, "question", question, "messages", messages));
        return ChatToolOutput.ok(
                "사용자에게 질문 화면을 보여 줬습니다: " + question + ". 답은 다음 사용자 메시지로 옵니다.",
                question, display);
    }
}
