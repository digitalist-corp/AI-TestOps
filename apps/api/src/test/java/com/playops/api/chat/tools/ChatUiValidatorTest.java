package com.playops.api.chat.tools;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ChatUiValidatorTest {

    private final ChatUiValidator validator = new ChatUiValidator(new ObjectMapper());
    private final List<Map<String, Object>> components = new ArrayList<>(List.of(
            component("root", "Column", Map.of("children", List.of("body", "cancel"))),
            component("body", "Section", Map.of("title", "선택", "children",
                    List.of("intro", "notice", "check", "choice", "input", "ok"))),
            component("intro", "Text", Map.of("text", path("/intro"), "variant", "muted")),
            component("notice", "Notice", Map.of("text", "하나 이상 골라 주세요", "tone", "info")),
            component("check", "CheckList", Map.of("items", path("/items"), "value", path("/selected"))),
            component("choice", "ChoiceList", Map.of("items", List.of(Map.of("id", "login", "title", "로그인")),
                    "value", path("/choice"))),
            component("input", "TextInput", Map.of("label", "메모", "value", path("/note"),
                    "placeholder", "선택 이유", "multiline", true)),
            component("ok", "Button", Map.of("label", "보내기", "variant", "primary",
                    "action", event("submit", Map.of("selected", path("/selected"))))),
            component("cancel", "Button", Map.of("label", "취소", "variant", "outline",
                    "action", event("cancel", Map.of())))));
    private Map<String, Object> data = Map.of("intro", "어제 실패한 테스트를 골라 주세요",
            "items", List.of(Map.of("id", "login", "title", "로그인", "badge", "실패")),
            "selected", List.of("login"), "choice", "login", "note", "");
    private String question = "어느 테스트를 다시 실행할까요?";

    @Test
    void acceptsAllCatalogComponentsAndBoundValues() {
        validate();
    }

    @Test
    void rejectsUnknownComponent() {
        components.get(2).put("component", "Video");
        rejects("Video");
    }

    @Test
    void rejectsHyphenInId() {
        components.get(2).put("id", "intro-text");
        rejects("intro-text");
    }

    @Test
    void rejectsDuplicateIds() {
        components.get(3).put("id", "intro");
        rejects("중복");
    }

    @Test
    void rejectsMissingRoot() {
        components.removeFirst();
        rejects("root");
    }

    @Test
    void rejectsMissingChild() {
        components.remove(2);
        rejects("intro");
    }

    @Test
    void rejectsRepeatedChild() {
        components.getFirst().put("children", List.of("body", "body", "cancel"));
        rejects("body");
    }

    @Test
    void rejectsDisconnectedComponents() {
        components.add(component("orphan", "Text", Map.of("text", "고립")));
        rejects("root");
    }

    @Test
    void rejectsRootAsAChild() {
        components.getFirst().put("children", List.of("body", "cancel", "root"));
        rejects("root");
    }

    @Test
    void requiresSubmit() {
        components.get(7).put("action", event("cancel", Map.of()));
        rejects("submit");
    }

    @Test
    void rejectsUnknownEventName() {
        components.get(7).put("action", event("delete", Map.of()));
        rejects("submit");
    }

    @Test
    void rejectsInvalidPropertiesAndPointerTypes() {
        components.get(6).put("multiline", "true");
        rejects("multiline");
        components.get(6).put("multiline", true);
        components.get(6).put("value", path("note"));
        rejects("@path");
        components.get(6).put("value", path("/note"));
        components.get(6).remove("label");
        rejects("label");
    }

    @Test
    void rejectsInvalidPointerInsideButtonContext() {
        components.get(7).put("action", event("submit", Map.of("nested", List.of(path("bad")))));
        rejects("@path");
    }

    @Test
    void rejectsSecretLabelAndPlaceholderIgnoringCase() {
        components.get(6).put("label", "서비스 비밀번호");
        rejects("비밀 값은 set_env_variables 로 받으세요");
        components.get(6).put("label", "메모");
        components.get(6).put("placeholder", "your API KEY");
        rejects("비밀 값은 set_env_variables 로 받으세요");
    }

    @Test
    void rejectsOverlongStrings() {
        question = "가".repeat(501);
        rejects("500");
    }

    @Test
    void rejectsMoreThanThirtyListEntries() {
        components.get(5).put("items", Collections.nCopies(31, Map.of("id", "id", "title", "항목")));
        rejects("30");
    }

    @Test
    void rejectsMoreThanFortyComponents() {
        IntStream.range(0, 40).forEach(i -> components.add(component("text" + i, "Text", Map.of("text", "문단"))));
        rejects("40");
    }

    @Test
    void countsDataSizeInUtf8Bytes() {
        data = Map.of("rows", Collections.nCopies(6, "가".repeat(500)));
        rejects("8KB");
    }

    private void validate() {
        validator.validate(Map.of("question", question, "components", components, "data", data));
    }

    private void rejects(String message) {
        assertThatThrownBy(this::validate).isInstanceOf(IllegalArgumentException.class).hasMessageContaining(message);
    }

    private static Map<String, Object> component(String id, String kind, Map<String, Object> props) {
        Map<String, Object> component = new LinkedHashMap<>(props);
        component.put("id", id);
        component.put("component", kind);
        return component;
    }

    private static Map<String, Object> path(String value) {
        return Map.of("@path", value);
    }

    private static Map<String, Object> event(String name, Map<String, Object> context) {
        return Map.of("event", Map.of("name", name, "context", context));
    }
}
