package com.playops.api.service;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class SelectorBuilderTest {

    private static Map<String, Object> element(Object... keyValues) {
        Map<String, Object> element = new HashMap<>();
        for (int i = 0; i < keyValues.length; i += 2) {
            element.put((String) keyValues[i], keyValues[i + 1]);
        }
        SelectorBuilder.apply(element);
        return element;
    }

    @Test
    void usesTheMostStableAttributeAvailable() {
        assertThat(element("testId", "login-email", "role", "textbox", "name", "이메일").get("selector"))
                .isEqualTo("getByTestId('login-email')");
        assertThat(element("role", "button", "name", "로그인", "text", "로그인").get("selector"))
                .isEqualTo("getByRole('button', { name: '로그인', exact: true })");
        assertThat(element("label", "비밀번호", "placeholder", "8자 이상").get("selector"))
                .isEqualTo("getByLabel('비밀번호', { exact: true })");
        assertThat(element("placeholder", "검색").get("selector"))
                .isEqualTo("getByPlaceholder('검색', { exact: true })");
        assertThat(element("kind", "link", "text", "회원가입").get("selector"))
                .isEqualTo("getByText('회원가입', { exact: true })");
    }

    @Test
    void leavesSelectorEmptyRatherThanGuessing() {
        Map<String, Object> onlyText = element("kind", "input", "text", "안내 문구");
        assertThat(onlyText.get("selector")).isNull();
        assertThat(onlyText.get("selectorKind")).isNull();
        assertThat(element("role", "button").get("selector")).isNull();
    }

    @Test
    void escapesQuotesAndBackslashes() {
        assertThat(element("label", "It's a \\ test").get("selector"))
                .isEqualTo("getByLabel('It\\'s a \\\\ test', { exact: true })");
    }

    @Test
    void marksElementsThatShareASelector() {
        List<Map<String, Object>> elements = new ArrayList<>(List.of(
                element("role", "button", "name", "삭제"),
                element("role", "button", "name", "삭제"),
                element("role", "button", "name", "저장"),
                element("role", "button")));
        SelectorBuilder.markDuplicates(elements);

        assertThat(elements).extracting(e -> e.get("duplicate")).containsExactly(true, true, false, false);
    }
}
