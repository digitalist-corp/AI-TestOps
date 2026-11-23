package com.playops.api.chat.tools;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectWriter;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.springframework.stereotype.Component;

import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

@Component
public class ChatUiValidator {

    static final int MAX_COMPONENTS = 40;
    static final int MAX_STRING_LENGTH = 500;
    static final List<String> COMPONENT_TYPES =
            List.of("Column", "Row", "Section", "Text", "Notice", "CheckList", "ChoiceList", "TextInput", "Button");

    private static final int MAX_LIST_ITEMS = 30;
    private static final int MAX_DATA_BYTES = 8 * 1024;
    private static final Pattern ID = Pattern.compile("^[A-Za-z_][A-Za-z0-9_]*$");
    private static final Pattern SECRET = Pattern.compile("비밀번호|password|token|토큰|secret|시크릿|api key");

    private final ObjectWriter json;

    public ChatUiValidator(ObjectMapper mapper) {
        json = mapper.writer().without(SerializationFeature.INDENT_OUTPUT);
    }

    record Question(String question, List<?> components, Map<?, ?> data) {}

    Question validate(Map<String, Object> input) {
        Map<?, ?> args = object(input, "입력");
        String question = string(args.get("question"), "question");
        if (question.isBlank()) {
            throw new IllegalArgumentException("question 에 질문을 입력하세요.");
        }
        Map<?, ?> data = object(args.get("data"), "data");
        checkDataSize(data);
        checkJsonValues(data, "data", false);

        if (!(args.get("components") instanceof List<?> components) || components.size() > MAX_COMPONENTS) {
            throw new IllegalArgumentException("components 는 40개 이하의 목록이어야 합니다.");
        }
        Map<String, List<String>> children = new LinkedHashMap<>();
        boolean hasSubmit = false;
        for (Object rawComponent : components) {
            Map<?, ?> component = object(rawComponent, "component");
            String id = string(component.get("id"), "id");
            if (!ID.matcher(id).matches()) {
                throw new IllegalArgumentException("잘못된 component id 입니다: " + id);
            }
            String type = string(component.get("component"), "component");
            List<String> childIds = List.of();
            if ("Button".equals(type)) {
                hasSubmit |= "submit".equals(validateButton(component));
            } else {
                childIds = validateComponent(component, type);
            }
            if (children.putIfAbsent(id, childIds) != null) {
                throw new IllegalArgumentException("component id 가 중복됩니다: " + id);
            }
        }
        checkTree(children);
        if (!hasSubmit) {
            throw new IllegalArgumentException("submit 버튼이 하나 이상 필요합니다.");
        }
        return new Question(question, components, data);
    }

    private static List<String> validateComponent(Map<?, ?> component, String type) {
        switch (type) {
            case "Column" -> componentProperties(component, "children");
            case "Row" -> {
                componentProperties(component, "children", "align");
                optionalChoice(component, "align", Set.of("start", "end"));
            }
            case "Section" -> {
                componentProperties(component, "title", "children");
                string(component.get("title"), "title");
            }
            case "Text" -> {
                componentProperties(component, "text", "variant");
                textOrPath(component.get("text"));
                optionalChoice(component, "variant", Set.of("body", "muted"));
            }
            case "Notice" -> {
                componentProperties(component, "text", "tone");
                textOrPath(component.get("text"));
                choice(component.get("tone"), "tone", Set.of("info", "success", "warning", "danger"));
            }
            case "CheckList", "ChoiceList" -> {
                componentProperties(component, "items", "value");
                Object items = component.get("items");
                if (items instanceof Map<?, ?>) {
                    path(items, "items");
                } else {
                    for (Object rawItem : list(items, "items")) {
                        Map<?, ?> item = object(rawItem, "items 항목");
                        properties(item, Set.of("id", "title", "detail", "badge"));
                        string(item.get("id"), "items.id");
                        string(item.get("title"), "items.title");
                        optionalString(item, "detail");
                        optionalString(item, "badge");
                    }
                }
                path(component.get("value"), "value");
            }
            case "TextInput" -> {
                componentProperties(component, "label", "value", "placeholder", "multiline");
                noSecret(string(component.get("label"), "label"));
                path(component.get("value"), "value");
                if (component.containsKey("placeholder")) {
                    noSecret(string(component.get("placeholder"), "placeholder"));
                }
                if (component.containsKey("multiline") && !(component.get("multiline") instanceof Boolean)) {
                    throw new IllegalArgumentException("multiline 은 boolean 이어야 합니다.");
                }
            }
            default -> throw new IllegalArgumentException("알 수 없는 component 입니다: " + type);
        }
        if ("Column".equals(type) || "Row".equals(type) || "Section".equals(type)) {
            return list(component.get("children"), "children").stream().map(id -> string(id, "children id")).toList();
        }
        return List.of();
    }

    private static String validateButton(Map<?, ?> component) {
        componentProperties(component, "label", "variant", "action");
        string(component.get("label"), "label");
        optionalChoice(component, "variant", Set.of("primary", "outline"));
        Map<?, ?> action = object(component.get("action"), "action");
        properties(action, Set.of("event"));
        Map<?, ?> event = object(action.get("event"), "action.event");
        properties(event, Set.of("name", "context"));
        String name = choice(event.get("name"), "action.event.name", Set.of("submit", "cancel"));
        checkJsonValues(object(event.get("context"), "action.event.context"), "action.event.context", true);
        return name;
    }

    private static void checkTree(Map<String, List<String>> children) {
        if (!children.containsKey("root")) {
            throw new IllegalArgumentException("root component 가 필요합니다.");
        }
        Set<String> seen = new HashSet<>();
        ArrayDeque<String> pending = new ArrayDeque<>();
        pending.add("root");
        while (!pending.isEmpty()) {
            String id = pending.removeFirst();
            if (!seen.add(id)) {
                throw new IllegalArgumentException("children 에 같은 component 가 여러 번 나타납니다: " + id);
            }
            List<String> next = children.get(id);
            if (next == null) {
                throw new IllegalArgumentException("children 이 가리키는 component 가 없습니다: " + id);
            }
            pending.addAll(next);
        }
        if (seen.size() != children.size()) {
            throw new IllegalArgumentException("모든 component 는 root 에서 닿아야 합니다.");
        }
    }

    private void checkDataSize(Map<?, ?> data) {
        try {
            if (json.writeValueAsBytes(data).length > MAX_DATA_BYTES) {
                throw new IllegalArgumentException("data 는 JSON 8KB 이하여야 합니다.");
            }
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("data 를 JSON 으로 변환할 수 없습니다.", e);
        }
    }

    private static void checkJsonValues(Object value, String field, boolean allowPaths) {
        if (value instanceof String) {
            string(value, field);
        } else if (value instanceof List<?>) {
            for (Object element : list(value, field)) {
                checkJsonValues(element, field, allowPaths);
            }
        } else if (value instanceof Map<?, ?> map) {
            if (allowPaths && map.containsKey("@path")) {
                path(map, field);
            } else {
                for (Map.Entry<?, ?> entry : map.entrySet()) {
                    string(entry.getKey(), field + " 키");
                    checkJsonValues(entry.getValue(), field, allowPaths);
                }
            }
        }
    }

    private static void textOrPath(Object value) {
        if (value instanceof Map<?, ?>) {
            path(value, "text");
        } else {
            string(value, "text");
        }
    }

    private static void path(Object value, String field) {
        if (!(value instanceof Map<?, ?> map) || map.size() != 1 || !(map.get("@path") instanceof String pointer)
                || !string(pointer, field + ".@path").startsWith("/")) {
            throw new IllegalArgumentException(field + " 는 '/' 로 시작하는 @path 를 가져야 합니다.");
        }
    }

    private static void noSecret(String text) {
        if (SECRET.matcher(text.toLowerCase(Locale.ROOT)).find()) {
            throw new IllegalArgumentException("비밀 값은 set_env_variables 로 받으세요");
        }
    }

    private static String string(Object value, String field) {
        if (!(value instanceof String text) || text.codePointCount(0, text.length()) > MAX_STRING_LENGTH) {
            throw new IllegalArgumentException(field + " 는 500자 이하의 문자열이어야 합니다.");
        }
        return text;
    }

    private static void optionalString(Map<?, ?> map, String field) {
        if (map.containsKey(field)) {
            string(map.get(field), field);
        }
    }

    private static String choice(Object value, String field, Set<String> allowed) {
        if (!(value instanceof String text) || !allowed.contains(text)) {
            throw new IllegalArgumentException(field + " 에 허용되는 값: " + String.join(", ", allowed));
        }
        return text;
    }

    private static void optionalChoice(Map<?, ?> map, String field, Set<String> allowed) {
        if (map.containsKey(field)) {
            choice(map.get(field), field, allowed);
        }
    }

    private static Map<?, ?> object(Object value, String field) {
        if (!(value instanceof Map<?, ?> map)) {
            throw new IllegalArgumentException(field + " 는 JSON 객체여야 합니다.");
        }
        return map;
    }

    private static List<?> list(Object value, String field) {
        if (!(value instanceof List<?> values) || values.size() > MAX_LIST_ITEMS) {
            throw new IllegalArgumentException(field + " 는 30개 이하의 목록이어야 합니다.");
        }
        return values;
    }

    private static void componentProperties(Map<?, ?> map, String... names) {
        Set<String> allowed = new HashSet<>(List.of(names));
        allowed.add("id");
        allowed.add("component");
        properties(map, allowed);
    }

    private static void properties(Map<?, ?> map, Set<String> allowed) {
        for (Object key : map.keySet()) {
            if (!(key instanceof String name) || !allowed.contains(name)) {
                throw new IllegalArgumentException("허용되지 않는 속성입니다: " + key);
            }
        }
    }
}
