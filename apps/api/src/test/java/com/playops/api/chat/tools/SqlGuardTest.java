package com.playops.api.chat.tools;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SqlGuardTest {

    // ---- 통과해야 하는 쿼리 ----

    @Test
    void plainSelectPassesUnchanged() {
        assertThat(SqlGuard.validate("SELECT id FROM ai_ro.executions")).isEqualTo("SELECT id FROM ai_ro.executions");
    }

    @Test
    void lowercaseAndLeadingWhitespaceAreFine() {
        assertThat(SqlGuard.validate("  \n\t select 1 ")).isEqualTo("select 1");
    }

    @Test
    void withQueryPasses() {
        String sql = "WITH failed AS (SELECT * FROM ai_ro.executions WHERE status = 'FAILED') SELECT count(*) FROM failed";
        assertThat(SqlGuard.validate(sql)).isEqualTo(sql);
    }

    @Test
    void leadingCommentsAreSkippedBeforeCheckingTheFirstWord() {
        assertThat(SqlGuard.validate("-- 실패한 실행\nSELECT 1")).isEqualTo("-- 실패한 실행\nSELECT 1");
        assertThat(SqlGuard.validate("/* 설명 */ select 1")).isEqualTo("/* 설명 */ select 1");
        assertThat(SqlGuard.validate("/* 바깥 /* 안쪽 */ 아직 주석 */ SELECT 1")).endsWith("SELECT 1");
    }

    @Test
    void aTrailingSemicolonIsCutOff() {
        assertThat(SqlGuard.validate("SELECT 1;")).isEqualTo("SELECT 1");
        assertThat(SqlGuard.validate("SELECT 1 ;  \n")).isEqualTo("SELECT 1");
    }

    @Test
    void onlyWhitespaceAndCommentsMayFollowTheSemicolon() {
        assertThat(SqlGuard.validate("SELECT 1; -- 끝")).isEqualTo("SELECT 1");
        assertThat(SqlGuard.validate("SELECT 1; /* 끝 */")).isEqualTo("SELECT 1");
    }

    @Test
    void semicolonInsideStringLiteralIsNotAStatementEnd() {
        assertThat(SqlGuard.validate("SELECT ';' AS sep")).isEqualTo("SELECT ';' AS sep");
        assertThat(SqlGuard.validate("SELECT 'a'';b' AS x; ")).isEqualTo("SELECT 'a'';b' AS x");
    }

    @Test
    void semicolonInsideQuotedIdentifierOrCommentIsNotAStatementEnd() {
        assertThat(SqlGuard.validate("SELECT 1 AS \"a;b\"")).isEqualTo("SELECT 1 AS \"a;b\"");
        assertThat(SqlGuard.validate("SELECT 1 -- a; b\n, 2")).contains(", 2");
        assertThat(SqlGuard.validate("SELECT 1 /* a; b */, 2")).contains(", 2");
    }

    @Test
    void semicolonInsideDollarQuotingIsNotAStatementEnd() {
        assertThat(SqlGuard.validate("SELECT $$a;b$$")).isEqualTo("SELECT $$a;b$$");
        assertThat(SqlGuard.validate("SELECT $tag$ x; DROP TABLE y; $tag$ AS z")).contains("DROP TABLE y");
    }

    @Test
    void wordsInsideStringsAndCommentsAreNotCode() {
        // 문자열 · 주석 안의 DELETE 는 코드가 아니다
        assertThat(SqlGuard.validate("SELECT 'DELETE FROM x' AS note")).contains("DELETE");
        assertThat(SqlGuard.validate("SELECT 1 -- UPDATE later")).contains("UPDATE");
    }

    @Test
    void columnNamesThatContainForbiddenWordsAreNotMistakenForThem() {
        // updated_at · inserted_by 는 한 단어(식별자)다
        assertThat(SqlGuard.validate("SELECT updated_at, inserted_by, deleted FROM x")).startsWith("SELECT");
    }

    // ---- 거절해야 하는 쿼리 ----

    @ParameterizedTest
    @ValueSource(strings = {
            "DELETE FROM ai_ro.executions",
            "UPDATE ai_ro.executions SET status = 'X'",
            "INSERT INTO ai_ro.executions VALUES (1)",
            "DROP TABLE users",
            "CREATE TABLE x(a int)",
            "TRUNCATE users",
            "SET ROLE playops",
            "SHOW app.is_admin",
            "EXPLAIN SELECT 1",
            "COPY users TO PROGRAM 'x'",
            "CALL x()"
    })
    void rejectsAnythingThatDoesNotStartWithSelectOrWith(String sql) {
        assertThatThrownBy(() -> SqlGuard.validate(sql))
                .isInstanceOf(SqlGuard.Rejected.class)
                .hasMessageContaining("SELECT 또는 WITH");
    }

    @ParameterizedTest
    @ValueSource(strings = {"(SELECT 1)", "'SELECT' || 1", "1 + SELECT", "\"select\" 1"})
    void firstCodeTokenMustBeTheWordSelectOrWith(String sql) {
        assertThatThrownBy(() -> SqlGuard.validate(sql))
                .isInstanceOf(SqlGuard.Rejected.class)
                .hasMessageContaining("SELECT 또는 WITH");
    }

    @Test
    void firstWordIsCheckedAfterCommentsAreRemoved() {
        assertThatThrownBy(() -> SqlGuard.validate("/* SELECT */ DELETE FROM x"))
                .isInstanceOf(SqlGuard.Rejected.class);
        assertThatThrownBy(() -> SqlGuard.validate("-- SELECT\nDROP TABLE x"))
                .isInstanceOf(SqlGuard.Rejected.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "SELECT 1; SELECT 2",
            "SELECT 1; DROP TABLE users",
            "SELECT 1;DELETE FROM users;",
            "SELECT 1; /* 주석 */ SELECT 2",
            "SELECT 1;\n-- 주석\nSELECT 2",
            "SELECT ';'; SELECT 2",
            "SELECT 1; ;SELECT 2"
    })
    void rejectsSeveralStatements(String sql) {
        assertThatThrownBy(() -> SqlGuard.validate(sql))
                .isInstanceOf(SqlGuard.Rejected.class)
                .hasMessageContaining("한 문장");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "WITH x AS (DELETE FROM executions RETURNING *) SELECT * FROM x",
            "WITH x AS (UPDATE executions SET status = 'X' RETURNING *) SELECT * FROM x",
            "WITH x AS (INSERT INTO executions DEFAULT VALUES RETURNING *) SELECT * FROM x",
            "WITH x AS (MERGE INTO t USING s ON true WHEN MATCHED THEN DELETE) SELECT 1",
            "SELECT * FROM ai_ro.executions FOR UPDATE",
            "SELECT pg_advisory_lock(1)",
            "SELECT PG_TRY_ADVISORY_LOCK(1)",
            "SELECT set_config('app.is_admin', 'true', true)",
            "SELECT pg_catalog.SET_CONFIG('role', 'x', true)"
    })
    void rejectsWritesAndScopeChangesHiddenInsideAReadQuery(String sql) {
        assertThatThrownBy(() -> SqlGuard.validate(sql))
                .isInstanceOf(SqlGuard.Rejected.class)
                .hasMessageContaining("읽기 전용");
    }

    @Test
    void backslashIsOnlyAnEscapeInsideEStrings() {
        // 보통 문자열에서 \ 는 그냥 글자다. 'a\' 는 닫힌 문자열이므로 뒤의 ; 는 문장 끝이고 그 뒤 코드는 두 번째 문장이다.
        assertThatThrownBy(() -> SqlGuard.validate("SELECT 'a\\'; DELETE FROM x; --'"))
                .isInstanceOf(SqlGuard.Rejected.class);
        // E 문자열에서는 \' 가 따옴표 글자라 문자열이 이어진다.
        assertThat(SqlGuard.validate("SELECT E'a\\'; b' AS x")).isEqualTo("SELECT E'a\\'; b' AS x");
    }

    @Test
    void rejectsUnterminatedQuotesAndComments() {
        assertThatThrownBy(() -> SqlGuard.validate("SELECT 'abc"))
                .isInstanceOf(SqlGuard.Rejected.class).hasMessageContaining("닫히지");
        assertThatThrownBy(() -> SqlGuard.validate("SELECT \"abc"))
                .isInstanceOf(SqlGuard.Rejected.class).hasMessageContaining("닫히지");
        assertThatThrownBy(() -> SqlGuard.validate("SELECT 1 /* abc"))
                .isInstanceOf(SqlGuard.Rejected.class).hasMessageContaining("닫히지");
        assertThatThrownBy(() -> SqlGuard.validate("SELECT $$abc"))
                .isInstanceOf(SqlGuard.Rejected.class).hasMessageContaining("닫히지");
    }

    @Test
    void rejectsEmptyOrCommentOnlyInput() {
        assertThatThrownBy(() -> SqlGuard.validate(null)).isInstanceOf(SqlGuard.Rejected.class);
        assertThatThrownBy(() -> SqlGuard.validate("   ")).isInstanceOf(SqlGuard.Rejected.class);
        assertThatThrownBy(() -> SqlGuard.validate("-- 주석뿐")).isInstanceOf(SqlGuard.Rejected.class);
        assertThatThrownBy(() -> SqlGuard.validate(";")).isInstanceOf(SqlGuard.Rejected.class);
    }

    @Test
    void rejectsQuestionMarkBecauseJdbcWouldTreatItAsAParameter() {
        assertThatThrownBy(() -> SqlGuard.validate("SELECT * FROM ai_ro.executions WHERE id = ?"))
                .isInstanceOf(SqlGuard.Rejected.class).hasMessageContaining("물음표");
        // 문자열 안의 물음표는 괜찮다
        assertThat(SqlGuard.validate("SELECT '?' AS q")).isEqualTo("SELECT '?' AS q");
    }
}
