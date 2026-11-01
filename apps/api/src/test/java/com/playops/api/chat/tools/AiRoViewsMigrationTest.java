package com.playops.api.chat.tools;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V7 마이그레이션의 뷰와 코드의 AiRoViews 상수가 어긋나지 않는지 본다.
 * 어긋나면 도구 설명이 없는 열을 알려 주거나, 새 열을 모델이 모르게 된다.
 * (SQL 의 동작 자체는 개발 DB 에서 트랜잭션으로 실행해 확인한다 — 작업 보고 참고)
 */
class AiRoViewsMigrationTest {

    private static final Pattern VIEW = Pattern.compile(
            "CREATE OR REPLACE VIEW ai_ro\\.(\\w+) WITH \\(security_barrier\\) AS\\s+SELECT(.*?)\\bFROM\\b(.*?);",
            Pattern.DOTALL);

    /** 이름에 이런 말이 들어간 열은 비밀 · 개인정보 · 큰 본문이라 뷰에 있으면 안 된다. */
    private static final Pattern SECRET_COLUMN = Pattern.compile(
            "(?i)password|secret|encrypted|callback|env_variables|manager_contact|log_output|report_path|diff_path|hash|api_key|webhook");

    private static String sql;
    private static Map<String, List<String>> viewColumns;
    private static Map<String, String> viewTail;

    @BeforeAll
    static void load() throws IOException {
        try (InputStream in = AiRoViewsMigrationTest.class.getResourceAsStream("/db/migration/V7__ai_readonly_views.sql")) {
            assertThat(in).as("V7 마이그레이션 파일").isNotNull();
            // 주석은 열 이름 해석에 방해가 되니 뗀다.
            sql = new String(in.readAllBytes(), StandardCharsets.UTF_8).replaceAll("--[^\\n]*", "");
        }
        viewColumns = new LinkedHashMap<>();
        viewTail = new LinkedHashMap<>();
        Matcher matcher = VIEW.matcher(sql);
        while (matcher.find()) {
            viewColumns.put(matcher.group(1), columnNames(matcher.group(2)));
            viewTail.put(matcher.group(1), matcher.group(3));
        }
    }

    /** SELECT 와 FROM 사이를 쉼표(괄호 밖)로 나눠 각 열의 이름(별칭이 있으면 별칭)을 뽑는다. */
    private static List<String> columnNames(String selectList) {
        List<String> names = new ArrayList<>();
        int depth = 0;
        StringBuilder item = new StringBuilder();
        for (char c : selectList.toCharArray()) {
            if (c == '(') depth++;
            if (c == ')') depth--;
            if (c == ',' && depth == 0) {
                names.add(nameOf(item.toString()));
                item.setLength(0);
            } else {
                item.append(c);
            }
        }
        if (!item.toString().isBlank()) {
            names.add(nameOf(item.toString()));
        }
        return names;
    }

    private static String nameOf(String expression) {
        String trimmed = expression.trim();
        Matcher alias = Pattern.compile("(?is).*\\sAS\\s+(\\w+)$").matcher(trimmed);
        if (alias.matches()) {
            return alias.group(1);
        }
        return trimmed.substring(trimmed.lastIndexOf('.') + 1);
    }

    @Test
    void viewsInTheMigrationAreExactlyTheViewsInTheCodeInTheSameOrder() {
        assertThat(viewColumns.keySet())
                .containsExactlyElementsOf(AiRoViews.ALL.stream().map(AiRoViews.View::name).toList());
    }

    @Test
    void viewsMatchTheContract() {
        // docs/design/ai-chat-agent-contract.md "SQL 안전" 의 뷰 대상
        assertThat(viewColumns.keySet()).containsExactlyInAnyOrder(
                "projects", "executions", "execution_case_results", "test_suites", "execution_schedules",
                "ai_jobs", "ai_usage", "site_node", "site_edge", "notifications");
    }

    @Test
    void everyViewExposesExactlyTheColumnsListedInTheCode() {
        for (AiRoViews.View view : AiRoViews.ALL) {
            assertThat(viewColumns.get(view.name()))
                    .as("뷰 ai_ro." + view.name() + " 의 열")
                    .containsExactlyElementsOf(view.columns());
        }
    }

    @Test
    void noViewExposesASecretLookingColumn() {
        for (Map.Entry<String, List<String>> entry : viewColumns.entrySet()) {
            for (String column : entry.getValue()) {
                assertThat(SECRET_COLUMN.matcher(column).find())
                        .as("ai_ro." + entry.getKey() + "." + column + " 은 비밀 열이 아니어야 한다")
                        .isFalse();
            }
        }
        // 비밀이 든 테이블은 뷰 대상이 아니다
        assertThat(viewColumns.keySet()).doesNotContain(
                "users", "user_sessions", "ai_provider_settings", "slack_settings", "user_audit_logs");
    }

    @Test
    void everyViewFiltersByProjectUnlessAdminAndIsASecurityBarrier() {
        for (Map.Entry<String, String> entry : viewTail.entrySet()) {
            String tail = entry.getValue().replaceAll("\\s+", " ");
            assertThat(tail).as("뷰 ai_ro." + entry.getKey())
                    .contains("current_setting('app.project_id', true)")
                    .contains("current_setting('app.is_admin', true) = 'true'")
                    .contains(" OR ");
        }
        assertThat(sql.split("security_barrier", -1).length - 1).isEqualTo(AiRoViews.ALL.size());
    }

    @Test
    void viewsReadFromPublicTablesWithAQualifiedName() {
        for (Map.Entry<String, String> entry : viewTail.entrySet()) {
            assertThat(entry.getValue()).as("뷰 ai_ro." + entry.getKey()).contains("public.");
        }
    }

    @Test
    void caseResultsViewFiltersThroughTheParentExecution() {
        String tail = viewTail.get("execution_case_results").replaceAll("\\s+", " ");

        assertThat(tail).contains("JOIN public.executions e ON e.id = r.execution_id");
        assertThat(tail).contains("e.project_id = current_setting('app.project_id', true)");
    }

    @Test
    void grantsAreLimitedToReadingTheViews() {
        String flat = sql.replaceAll("\\s+", " ");

        assertThat(flat).contains("GRANT USAGE ON SCHEMA ai_ro TO ai_readonly;");
        assertThat(flat).contains("GRANT SELECT ON ALL TABLES IN SCHEMA ai_ro TO ai_readonly;");
        assertThat(flat).contains("CREATE ROLE ai_readonly NOLOGIN");
        assertThat(flat).contains("GRANT ai_readonly TO CURRENT_USER;");
        // 실제 테이블에는 권한을 주지 않는다
        Set<String> grantsOnPublic = Pattern.compile("GRANT [^;]* ON [^;]*public[^;]*;").matcher(flat).results()
                .map(r -> r.group()).collect(Collectors.toSet());
        assertThat(grantsOnPublic).isEmpty();
    }

    @Test
    void setConfigIsTakenAwayFromEveryoneButTheAppAccount() {
        String flat = sql.replaceAll("\\s+", " ");

        assertThat(flat).contains("REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) FROM PUBLIC;");
        assertThat(flat).contains("GRANT EXECUTE ON FUNCTION pg_catalog.set_config(text, text, boolean) TO CURRENT_USER;");
    }
}
