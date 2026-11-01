package com.playops.api.chat.tools;

import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolTier;
import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmToolCall;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SqlQueryToolTest {

    private final ReadOnlySqlRunner runner = mock(ReadOnlySqlRunner.class);
    private final SqlQueryTool tool = new SqlQueryTool(runner);

    private static LlmToolCall call(Map<String, Object> args) {
        return new LlmToolCall("call-1", "sql_query", args);
    }

    private static ChatToolContext context(String projectId, boolean admin) {
        return new ChatToolContext(projectId, 7L, admin, 1L);
    }

    @SafeVarargs
    private static SqlResult table(List<String> columns, List<Object>... rows) {
        return new SqlResult(columns, new ArrayList<>(Arrays.asList(rows)), false);
    }

    // ---- 도구 정의 ----

    @Test
    void isAReadToolWithARequiredSqlArgument() {
        assertThat(tool.tier()).isEqualTo(ToolTier.READ);
        assertThat(tool.spec().name()).isEqualTo("sql_query");
        assertThat(tool.spec().inputSchema().get("required")).isEqualTo(List.of("sql"));
        @SuppressWarnings("unchecked")
        Map<String, Object> properties = (Map<String, Object>) tool.spec().inputSchema().get("properties");
        assertThat(properties).containsKeys("sql", "projectId");
    }

    @Test
    void descriptionListsEveryViewWithItsColumnsSoTheModelDoesNotGuess() {
        String description = tool.spec().description();

        for (AiRoViews.View view : AiRoViews.ALL) {
            assertThat(description).contains(view.qualifiedName());
            for (String column : view.columns()) {
                assertThat(description).contains(column);
            }
        }
        assertThat(description).contains("프로젝트 범위로 자동 제한");
        assertThat(description).contains("SELECT 또는 WITH");
        assertThat(description).contains("200행");
    }

    // ---- 실행 ----

    @Test
    void runsTheValidatedSqlInTheConversationProject() {
        when(runner.run(anyString(), any(), anyBoolean())).thenReturn(table(List.of("n"), List.of(3L)));

        ChatToolOutput output = tool.execute(
                call(Map.of("sql", "SELECT count(*) AS n FROM ai_ro.executions;")), context("p1", false));

        assertThat(output.error()).isFalse();
        // 끝의 세미콜론은 떼고 보낸다. 프로젝트 범위는 대화 중인 프로젝트.
        verify(runner).run("SELECT count(*) AS n FROM ai_ro.executions", "p1", false);
    }

    @Test
    void rejectedSqlNeverReachesTheDatabase() {
        ChatToolOutput output = tool.execute(call(Map.of("sql", "DELETE FROM ai_ro.executions")), context("p1", false));

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("SELECT 또는 WITH");
        verify(runner, never()).run(anyString(), any(), anyBoolean());

        ChatToolOutput several = tool.execute(call(Map.of("sql", "SELECT 1; SELECT 2")), context("p1", false));
        assertThat(several.error()).isTrue();
        verify(runner, never()).run(anyString(), any(), anyBoolean());
    }

    @Test
    void missingSqlFails() {
        ChatToolOutput output = tool.execute(call(Map.of()), context("p1", false));

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("sql");
    }

    @Test
    void databaseErrorsComeBackAsFailuresThatTheModelCanRead() {
        when(runner.run(anyString(), any(), anyBoolean()))
                .thenThrow(new ApiException(400, "SQL 실행 실패: column \"stat\" does not exist"));

        ChatToolOutput output = tool.execute(call(Map.of("sql", "SELECT stat FROM ai_ro.executions")), context("p1", false));

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("column \"stat\" does not exist");
        assertThat(output.display()).isNull();
    }

    // ---- 조회 범위 ----

    @Test
    void adminInsideAProjectIsScopedToThatProject() {
        when(runner.run(anyString(), any(), anyBoolean())).thenReturn(table(List.of("n"), List.of(1L)));

        tool.execute(call(Map.of("sql", "SELECT 1")), context("p1", true));

        verify(runner).run("SELECT 1", "p1", false);
    }

    @Test
    void adminWithoutAProjectSeesEverythingAndIsToldSo() {
        when(runner.run(anyString(), any(), anyBoolean())).thenReturn(table(List.of("n"), List.of(1L)));

        ChatToolOutput output = tool.execute(call(Map.of("sql", "SELECT 1")), context(null, true));

        verify(runner).run("SELECT 1", null, true);
        assertThat(output.content()).contains("모든 프로젝트를 조회했습니다");
    }

    @Test
    void nonAdminWithoutAProjectGetsNoRowsAndIsToldWhy() {
        when(runner.run(anyString(), any(), anyBoolean())).thenReturn(table(List.of("n")));

        ChatToolOutput output = tool.execute(call(Map.of("sql", "SELECT n FROM ai_ro.executions")), context(null, false));

        verify(runner).run("SELECT n FROM ai_ro.executions", null, false);
        assertThat(output.error()).isFalse();           // 오류가 아니다
        assertThat(output.content()).contains("조회 범위가 비어 있습니다").contains("정상");
        assertThat(output.summary()).isEqualTo("0행 (조회 범위 없음)");
    }

    @Test
    void anExplicitOtherProjectIsRefusedForNonAdmins() {
        ChatToolOutput output = tool.execute(
                call(Map.of("sql", "SELECT 1", "projectId", "someone-elses")), context("p1", false));

        assertThat(output.error()).isTrue();
        assertThat(output.content()).contains("다른 프로젝트");
        verify(runner, never()).run(anyString(), any(), anyBoolean());
    }

    @Test
    void anAdminMayPickAnotherProject() {
        when(runner.run(anyString(), any(), anyBoolean())).thenReturn(table(List.of("n"), List.of(1L)));

        tool.execute(call(Map.of("sql", "SELECT 1", "projectId", "other")), context("p1", true));

        verify(runner).run(eq("SELECT 1"), eq("other"), eq(false));
    }

    // ---- 결과 → 모델용 글 · 화면용 표 ----

    @Test
    @SuppressWarnings("unchecked")
    void convertsAResultIntoATextTableAndATableDisplay() {
        SqlResult result = table(List.of("status", "n"), List.of("PASSED", 8L), List.of("FAILED", 2L));

        ChatToolOutput output = SqlQueryTool.toOutput(result, "SELECT status, count(*) AS n FROM ai_ro.executions GROUP BY 1", null, false);

        assertThat(output.error()).isFalse();
        assertThat(output.summary()).isEqualTo("2행");
        assertThat(output.content()).isEqualTo("결과 2행\nstatus | n\nPASSED | 8\nFAILED | 2");

        assertThat(output.display().kind()).isEqualTo("table");
        Map<String, Object> data = output.display().data();
        assertThat(data.get("columns")).isEqualTo(List.of("status", "n"));
        assertThat((List<List<Object>>) data.get("rows")).containsExactly(List.of("PASSED", 8L), List.of("FAILED", 2L));
        assertThat(data.get("truncated")).isEqualTo(false);
        assertThat(data.get("sql")).isEqualTo("SELECT status, count(*) AS n FROM ai_ro.executions GROUP BY 1");
    }

    @Test
    void anEmptyResultIsStillATable() {
        ChatToolOutput output = SqlQueryTool.toOutput(table(List.of("id")), "SELECT id FROM ai_ro.executions", null, false);

        assertThat(output.content()).isEqualTo("결과 0행\nid");
        assertThat(output.summary()).isEqualTo("0행");
        assertThat(output.display().data().get("rows")).isEqualTo(List.of());
    }

    @Test
    void marksTruncationInBothTheTextAndTheDisplay() {
        List<List<Object>> rows = new ArrayList<>();
        for (long i = 0; i < 200; i++) {
            rows.add(List.of(i));
        }
        ChatToolOutput output = SqlQueryTool.toOutput(new SqlResult(List.of("id"), rows, true), "SELECT id FROM x", null, false);

        assertThat(output.summary()).isEqualTo("200행 이상");
        assertThat(output.content()).contains("200행 이상").contains("조건을 좁혀");
        assertThat(output.display().data().get("truncated")).isEqualTo(true);
    }

    @Test
    void nullsAndMultilineCellsKeepTheTextTableReadable() {
        SqlResult result = table(List.of("a", "b"), Arrays.asList(null, "첫 줄\n  둘째 줄"));

        ChatToolOutput output = SqlQueryTool.toOutput(result, "SELECT a, b FROM x", null, false);

        assertThat(output.content()).contains("NULL | 첫 줄 둘째 줄");
        // 화면용 표는 원래 값 그대로
        assertThat(output.display().data().get("rows")).isEqualTo(List.of(Arrays.asList(null, "첫 줄\n  둘째 줄")));
    }

    @Test
    void textForTheModelIsCappedAt6000CharactersButTheDisplayKeepsEveryRow() {
        List<List<Object>> rows = new ArrayList<>();
        for (int i = 0; i < 200; i++) {
            rows.add(List.of("x".repeat(100) + i));
        }
        ChatToolOutput output = SqlQueryTool.toOutput(new SqlResult(List.of("v"), rows, false), "SELECT v FROM x", null, false);

        assertThat(output.content().length()).isLessThan(6100);
        assertThat(output.content()).endsWith("... (이후 생략)");
        assertThat((List<?>) output.display().data().get("rows")).hasSize(200);
    }

    @Test
    void aLongCellIsShortenedInTheTextTable() {
        ChatToolOutput output = SqlQueryTool.toOutput(
                table(List.of("log"), List.of("y".repeat(900))), "SELECT log FROM x", null, false);

        assertThat(output.content()).contains("y".repeat(200) + "…").doesNotContain("y".repeat(201));
    }

    // ---- 칸 값 정리 (화면 계약: 문자열 · 숫자 · 불리언 · null) ----

    @Test
    void cellValuesAreReducedToStringNumberBooleanOrNull() {
        assertThat(SqlResult.cell(null)).isNull();
        assertThat(SqlResult.cell(5)).isEqualTo(5);
        assertThat(SqlResult.cell(5L)).isEqualTo(5L);
        assertThat(SqlResult.cell(true)).isEqualTo(true);
        assertThat(SqlResult.cell(new BigDecimal("0.12500000"))).isEqualTo(new BigDecimal("0.12500000"));
        assertThat(SqlResult.cell(1.5d)).isEqualTo(1.5d);
        assertThat(SqlResult.cell("abc")).isEqualTo("abc");
    }

    @Test
    void nonFiniteNumbersBecomeStringsBecauseJsonCannotCarryThem() {
        assertThat(SqlResult.cell(Double.NaN)).isEqualTo("NaN");
        assertThat(SqlResult.cell(Double.POSITIVE_INFINITY)).isEqualTo("Infinity");
        assertThat(SqlResult.cell(Float.NaN)).isEqualTo("NaN");
    }

    @Test
    void timestampsBecomeIsoInstants() {
        assertThat(SqlResult.cell(Timestamp.from(Instant.parse("2026-11-01T05:30:00Z"))))
                .isEqualTo("2026-11-01T05:30:00Z");
    }

    @Test
    void binaryAndOtherObjectsBecomeShortText() {
        assertThat(SqlResult.cell(new byte[]{1, 2, 3})).isEqualTo("(바이너리 3바이트)");
        assertThat(SqlResult.cell(java.util.UUID.fromString("00000000-0000-0000-0000-000000000001")))
                .isEqualTo("00000000-0000-0000-0000-000000000001");
    }

    @Test
    void veryLongStringsAreCutInTheTableData() {
        Object cell = SqlResult.cell("z".repeat(5000));

        assertThat((String) cell).hasSize(SqlResult.MAX_CELL_CHARS + 1).endsWith("…");
    }
}
