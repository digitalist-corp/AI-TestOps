package com.playops.api.service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 요소의 속성으로 Playwright 셀렉터를 조립한다.
 *
 * 셀렉터를 LLM 이 쓰게 하지 않는 이유: 모델은 있을 법한 셀렉터를 지어낸다.
 * 여기서는 코드에 실제로 있다고 확인된 속성만 받아 정해진 우선순위로 만든다.
 */
public final class SelectorBuilder {

    private SelectorBuilder() {}

    /** element 에 selector · selectorKind 를 채운다. 만들 수 없으면 둘 다 null. */
    public static void apply(Map<String, Object> element) {
        String testId = text(element, "testId");
        String role = text(element, "role");
        String name = text(element, "name");
        String label = text(element, "label");
        String placeholder = text(element, "placeholder");
        String text = text(element, "text");
        String kind = text(element, "kind");

        String selector = null;
        String selectorKind = null;
        if (testId != null) {
            selector = "getByTestId(" + quote(testId) + ")";
            selectorKind = "testid";
        } else if (role != null && name != null) {
            selector = "getByRole(" + quote(role) + ", { name: " + quote(name) + ", exact: true })";
            selectorKind = "role";
        } else if (label != null) {
            selector = "getByLabel(" + quote(label) + ", { exact: true })";
            selectorKind = "label";
        } else if (placeholder != null) {
            selector = "getByPlaceholder(" + quote(placeholder) + ", { exact: true })";
            selectorKind = "placeholder";
        } else if (text != null && ("link".equals(kind) || "button".equals(kind))) {
            selector = "getByText(" + quote(text) + ", { exact: true })";
            selectorKind = "text";
        }
        element.put("selector", selector);
        element.put("selectorKind", selectorKind);
    }

    /**
     * 같은 화면에서 셀렉터가 겹치는 요소에 duplicate 를 표시한다.
     * 코드만으로는 어느 것이 화면에 먼저 나오는지 알 수 없으므로 .nth() 로 구분하지 않는다.
     */
    public static void markDuplicates(List<Map<String, Object>> elements) {
        Map<String, Integer> counts = new HashMap<>();
        for (Map<String, Object> element : elements) {
            if (element.get("selector") instanceof String selector) {
                counts.merge(selector, 1, Integer::sum);
            }
        }
        for (Map<String, Object> element : elements) {
            element.put("duplicate", element.get("selector") instanceof String selector && counts.get(selector) > 1);
        }
    }

    private static String text(Map<String, Object> element, String key) {
        return element.get(key) instanceof String value && !value.isBlank() ? value : null;
    }

    static String quote(String value) {
        return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'";
    }
}
