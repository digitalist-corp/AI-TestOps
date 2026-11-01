package com.playops.api.chat.tools;

import com.playops.api.chat.ChatToolContext;
import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmToolCall;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ToolSupportTest {

    private static LlmToolCall call(Map<String, Object> args) {
        return new LlmToolCall("c1", "x", args);
    }

    private static ChatToolContext ctx(String projectId, boolean admin) {
        return new ChatToolContext(projectId, 7L, admin, 1L);
    }

    @Test
    void usesTheConversationProjectWhenNoneIsGiven() {
        assertThat(ToolSupport.optionalProject(call(Map.of()), ctx("p1", false))).isEqualTo("p1");
        assertThat(ToolSupport.requireProject(call(Map.of()), ctx("p1", false))).isEqualTo("p1");
    }

    @Test
    void returnsNullWhenThereIsNoProjectAtAll() {
        assertThat(ToolSupport.optionalProject(call(Map.of()), ctx(null, false))).isNull();
        assertThat(ToolSupport.optionalProject(call(Map.of()), ctx("  ", true))).isNull();
    }

    @Test
    void requireProjectFailsWhenThereIsNoProject() {
        assertThatThrownBy(() -> ToolSupport.requireProject(call(Map.of()), ctx(null, false)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("projectId");
    }

    @Test
    void anExplicitProjectEqualToTheConversationProjectIsFine() {
        assertThat(ToolSupport.requireProject(call(Map.of("projectId", "p1")), ctx("p1", false))).isEqualTo("p1");
    }

    @Test
    void aNonAdminCannotNameAnotherProject() {
        assertThatThrownBy(() -> ToolSupport.optionalProject(call(Map.of("projectId", "p2")), ctx("p1", false)))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(403));
        // 대화 중인 프로젝트가 없을 때도 마찬가지다
        assertThatThrownBy(() -> ToolSupport.optionalProject(call(Map.of("projectId", "p2")), ctx(null, false)))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void anAdminMayNameAnyProject() {
        assertThat(ToolSupport.requireProject(call(Map.of("projectId", "p2")), ctx("p1", true))).isEqualTo("p2");
        assertThat(ToolSupport.requireProject(call(Map.of("projectId", "p2")), ctx(null, true))).isEqualTo("p2");
    }

    @Test
    void truncateKeepsShortTextAndCutsLongText() {
        assertThat(ToolSupport.truncate("짧다")).isEqualTo("짧다");
        assertThat(ToolSupport.truncate(null)).isEmpty();
        String cut = ToolSupport.truncate("a".repeat(7000));
        assertThat(cut).startsWith("a".repeat(6000)).endsWith("\n... (이후 생략)");
        assertThat(cut.length()).isEqualTo(6000 + "\n... (이후 생략)".length());
    }

    @Test
    void oneLineAndFirstLineTidyMultilineText() {
        assertThat(ToolSupport.oneLine("a\n  b\t c", 50)).isEqualTo("a b c");
        assertThat(ToolSupport.oneLine("abcdef", 3)).isEqualTo("abc…");
        assertThat(ToolSupport.oneLine(null, 3)).isEmpty();
        assertThat(ToolSupport.firstLine("\n\n  첫 줄  \n둘째", 50)).isEqualTo("첫 줄");
        assertThat(ToolSupport.firstLine("   ", 50)).isEmpty();
        assertThat(ToolSupport.firstLine(null, 50)).isEmpty();
    }
}
