package com.playops.api.chat.tools;

import com.playops.api.exception.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** JDBC 를 가짜로 만들어, 문장이 안전한 순서로 나가는지 · 안전장치가 걸리는지 · 반드시 롤백하는지를 본다. */
class ReadOnlySqlRunnerTest {

    private static final String QUERY = "SELECT id, status FROM ai_ro.executions";

    private final DataSource dataSource = mock(DataSource.class);
    private final Connection connection = mock(Connection.class);
    private final Statement statement = mock(Statement.class);
    private final PreparedStatement scopeStatement = mock(PreparedStatement.class);
    private final PreparedStatement guardStatement = mock(PreparedStatement.class);
    private final PreparedStatement queryStatement = mock(PreparedStatement.class);
    private final ResultSet guardResult = mock(ResultSet.class);
    private final ResultSet queryResult = mock(ResultSet.class);
    private final ResultSetMetaData metaData = mock(ResultSetMetaData.class);

    private final ReadOnlySqlRunner runner = new ReadOnlySqlRunner(dataSource);

    @BeforeEach
    void wire() throws SQLException {
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.getAutoCommit()).thenReturn(true);
        when(connection.createStatement()).thenReturn(statement);
        when(connection.prepareStatement(startsWith("SELECT set_config"))).thenReturn(scopeStatement);
        when(connection.prepareStatement(startsWith("SELECT has_function_privilege"))).thenReturn(guardStatement);
        when(connection.prepareStatement(QUERY)).thenReturn(queryStatement);

        // set_config 를 ai_readonly 가 쓸 수 없는 정상 상태
        when(guardStatement.executeQuery()).thenReturn(guardResult);
        when(guardResult.next()).thenReturn(true);
        when(guardResult.getBoolean(1)).thenReturn(false);

        when(queryStatement.executeQuery()).thenReturn(queryResult);
        when(queryResult.getMetaData()).thenReturn(metaData);
        when(metaData.getColumnCount()).thenReturn(2);
        when(metaData.getColumnLabel(1)).thenReturn("id");
        when(metaData.getColumnLabel(2)).thenReturn("status");
    }

    @Test
    void runsStatementsInSafeOrderAndAlwaysRollsBack() throws SQLException {
        when(queryResult.next()).thenReturn(true, true, false);
        when(queryResult.getObject(1)).thenReturn(1L, 2L);
        when(queryResult.getObject(2)).thenReturn("PASSED", "FAILED");

        SqlResult result = runner.run(QUERY, "p1", false);

        assertThat(result.columns()).containsExactly("id", "status");
        assertThat(result.rows()).containsExactly(java.util.List.of(1L, "PASSED"), java.util.List.of(2L, "FAILED"));
        assertThat(result.truncated()).isFalse();

        InOrder order = inOrder(connection, statement, scopeStatement, guardStatement, queryStatement);
        order.verify(connection).setAutoCommit(false);
        order.verify(statement).execute("SET TRANSACTION READ ONLY");
        // 범위 설정은 앱 계정으로, 역할을 바꾸기 전에
        order.verify(scopeStatement).setString(1, "p1");
        order.verify(scopeStatement).setString(2, "false");
        order.verify(scopeStatement).execute();
        order.verify(guardStatement).executeQuery();
        order.verify(statement).execute("SET LOCAL statement_timeout = '5s'");
        order.verify(statement).execute("SET LOCAL ROLE ai_readonly");
        order.verify(queryStatement).setMaxRows(201);
        order.verify(queryStatement).executeQuery();
        order.verify(connection).rollback();
        order.verify(connection).setAutoCommit(true);
        verify(connection, never()).commit();
    }

    @Test
    void emptyScopeIsSentAsEmptyStringAndAdminAsTrue() throws SQLException {
        when(queryResult.next()).thenReturn(false);

        runner.run(QUERY, null, false);
        verify(scopeStatement).setString(1, "");
        verify(scopeStatement).setString(2, "false");

        runner.run(QUERY, null, true);
        verify(scopeStatement).setString(2, "true");
    }

    @Test
    void readsOneRowMoreThanTheLimitToTellThereIsMore() throws SQLException {
        when(queryResult.next()).thenReturn(true); // 끝없이 나오는 결과
        when(queryResult.getObject(anyInt())).thenReturn("x");

        SqlResult result = runner.run(QUERY, "p1", false);

        assertThat(result.rows()).hasSize(200);
        assertThat(result.truncated()).isTrue();
        verify(queryResult, times(201)).next();
    }

    @Test
    void exactlyTheLimitIsNotTruncated() throws SQLException {
        // 정확히 200행: true 200번 뒤에 false
        Boolean[] rest = new Boolean[200];
        java.util.Arrays.fill(rest, true);
        rest[199] = false;
        when(queryResult.next()).thenReturn(true, rest);
        when(queryResult.getObject(anyInt())).thenReturn("x");

        SqlResult result = runner.run(QUERY, "p1", false);

        assertThat(result.rows()).hasSize(200);
        assertThat(result.truncated()).isFalse();
    }

    @Test
    void refusesToRunWhenAiReadonlyCouldStillChangeTheScope() throws SQLException {
        when(guardResult.getBoolean(1)).thenReturn(true);

        assertThatThrownBy(() -> runner.run(QUERY, "p1", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("잠겨 있습니다");

        // 역할을 바꾸지도, AI 쿼리를 보내지도 않았다
        verify(statement, never()).execute("SET LOCAL ROLE ai_readonly");
        verify(connection, never()).prepareStatement(QUERY);
        verify(connection).rollback();
    }

    @Test
    void refusesWhenTheGuardQueryReturnsNothing() throws SQLException {
        when(guardResult.next()).thenReturn(false);

        assertThatThrownBy(() -> runner.run(QUERY, "p1", false)).isInstanceOf(ApiException.class);
        verify(connection, never()).prepareStatement(QUERY);
    }

    @Test
    void rollsBackEvenWhenTheQueryFails() throws SQLException {
        when(queryStatement.executeQuery()).thenThrow(new SQLException("boom", "42601"));

        assertThatThrownBy(() -> runner.run(QUERY, "p1", false)).isInstanceOf(ApiException.class);

        verify(connection).rollback();
        verify(connection, never()).commit();
        verify(connection).close();
    }

    @Test
    void statementTimeoutBecomesAHintToNarrowTheQuery() throws SQLException {
        when(queryStatement.executeQuery()).thenThrow(
                new SQLException("ERROR: canceling statement due to statement timeout", "57014"));

        assertThatThrownBy(() -> runner.run(QUERY, "p1", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("5초");
    }

    @Test
    void permissionDeniedPointsAtTheViews() throws SQLException {
        when(queryStatement.executeQuery()).thenThrow(
                new SQLException("ERROR: permission denied for table users\n  Position: 15", "42501"));

        assertThatThrownBy(() -> runner.run(QUERY, "p1", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("ai_ro")
                .hasMessageContaining("permission denied for table users")
                .hasMessageNotContaining("Position");
    }

    @Test
    void unknownTableSuggestsTheViewNames() throws SQLException {
        when(queryStatement.executeQuery()).thenThrow(
                new SQLException("ERROR: relation \"executions\" does not exist", "42P01"));

        assertThatThrownBy(() -> runner.run(QUERY, "p1", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("ai_ro.<뷰 이름>");
    }

    @Test
    void missingRoleMeansTheMigrationWasNotApplied() throws SQLException {
        when(guardStatement.executeQuery()).thenThrow(
                new SQLException("ERROR: role \"ai_readonly\" does not exist", "42704"));

        assertThatThrownBy(() -> runner.run(QUERY, "p1", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("V7");
        verify(connection).rollback();
    }

    @Test
    void connectionFailureDoesNotLeakDriverDetails() throws SQLException {
        when(dataSource.getConnection()).thenThrow(new SQLException("connect to 10.0.0.5:5432 refused", "08001"));

        assertThatThrownBy(() -> runner.run(QUERY, "p1", false))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("연결하지 못했습니다")
                .hasMessageNotContaining("10.0.0.5");
    }

    @Test
    void otherSqlErrorsKeepTheDatabaseMessageSoTheModelCanFixTheQuery() throws SQLException {
        when(queryStatement.executeQuery()).thenThrow(
                new SQLException("ERROR: column \"stat\" does not exist\n  Hint: Perhaps you meant status.", "42703"));

        assertThatThrownBy(() -> runner.run(QUERY, "p1", false))
                .isInstanceOf(ApiException.class)
                .hasMessage("SQL 실행 실패: column \"stat\" does not exist");
    }
}
