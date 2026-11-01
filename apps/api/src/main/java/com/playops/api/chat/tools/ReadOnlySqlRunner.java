package com.playops.api.chat.tools;

import com.playops.api.exception.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

/**
 * AI 가 쓴 SELECT 한 문장을 안전하게 돌리는 곳.
 *
 * 한 트랜잭션 안에서 아래 순서로 진행하고, 끝나면 무조건 롤백한다.
 * <ol>
 *   <li>SET TRANSACTION READ ONLY — 무엇이 새어 들어와도 쓰기는 안 된다</li>
 *   <li>set_config 로 조회 범위(app.project_id · app.is_admin) 설정 — <b>앱 계정으로, 역할을 바꾸기 전에</b></li>
 *   <li>ai_readonly 가 set_config 를 못 쓰는지 확인 — 막혀 있지 않으면 AI 쿼리가 범위를 바꿀 수 있어 돌리지 않는다</li>
 *   <li>statement_timeout 5초, 역할을 ai_readonly 로 전환 — 이후로는 ai_ro 뷰만 읽을 수 있다</li>
 *   <li>AI 쿼리를 PreparedStatement 한 문장으로 실행, 201행까지만 읽어 200행 + 잘림 표시</li>
 * </ol>
 * 범위 설정을 역할 전환 뒤에 하면 ai_readonly 가 set_config 를 쓸 수 없어 실패한다. 순서를 바꾸지 말 것.
 */
@Component
public class ReadOnlySqlRunner {

    private static final Logger log = LoggerFactory.getLogger(ReadOnlySqlRunner.class);

    /** 모델에게 보여 줄 최대 행 수. 하나 더(201) 읽어 더 있는지 알아낸다. */
    static final int MAX_ROWS = 200;

    private static final int MAX_ERROR_CHARS = 400;

    private final DataSource dataSource;

    public ReadOnlySqlRunner(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    /**
     * @param sql       SqlGuard 를 통과한 읽기용 한 문장
     * @param projectId 조회 범위로 삼을 프로젝트. 없으면 null (관리자가 아니면 아무 행도 안 보인다)
     * @param admin     true 면 모든 프로젝트를 본다
     * @throws ApiException 실행하지 못했거나 DB 가 거절했을 때. 메시지는 모델에게 그대로 보여 준다
     */
    public SqlResult run(String sql, String projectId, boolean admin) {
        try (Connection connection = dataSource.getConnection()) {
            boolean originalAutoCommit = connection.getAutoCommit();
            connection.setAutoCommit(false);
            try {
                return runInTransaction(connection, sql, projectId, admin);
            } finally {
                try {
                    connection.rollback();
                } catch (SQLException e) {
                    log.warn("sql_query 롤백 실패: {}", e.getMessage());
                }
                try {
                    connection.setAutoCommit(originalAutoCommit);
                } catch (SQLException e) {
                    log.warn("sql_query 연결 상태 복구 실패: {}", e.getMessage());
                }
            }
        } catch (SQLException e) {
            throw translate(e);
        }
    }

    private SqlResult runInTransaction(Connection connection, String sql, String projectId, boolean admin)
            throws SQLException {
        try (Statement statement = connection.createStatement()) {
            statement.execute("SET TRANSACTION READ ONLY");
        }

        // 조회 범위. 값은 문자열 인자로만 넣는다. 트랜잭션 안에서만 유효(세 번째 인자 true)해 롤백하면 사라진다.
        try (PreparedStatement scope = connection.prepareStatement(
                "SELECT set_config('app.project_id', ?, true), set_config('app.is_admin', ?, true)")) {
            scope.setString(1, projectId == null ? "" : projectId);
            scope.setString(2, admin ? "true" : "false");
            scope.execute();
        }

        ensureScopeCannotBeChanged(connection);

        try (Statement statement = connection.createStatement()) {
            statement.execute("SET LOCAL statement_timeout = '5s'");
            statement.execute("SET LOCAL ROLE ai_readonly");
        }

        try (PreparedStatement query = connection.prepareStatement(sql)) {
            query.setEscapeProcessing(false);
            query.setMaxRows(MAX_ROWS + 1);
            try (ResultSet rs = query.executeQuery()) {
                return read(rs);
            }
        }
    }

    /** ai_readonly 가 set_config 를 쓸 수 있으면 AI 쿼리가 스스로 범위를 넓힐 수 있다. 그런 상태로는 돌리지 않는다. */
    private void ensureScopeCannotBeChanged(Connection connection) throws SQLException {
        try (PreparedStatement check = connection.prepareStatement(
                "SELECT has_function_privilege('ai_readonly', 'pg_catalog.set_config(text,text,boolean)', 'EXECUTE')");
             ResultSet rs = check.executeQuery()) {
            if (!rs.next() || rs.getBoolean(1)) {
                log.error("ai_readonly 가 set_config 를 쓸 수 있어 sql_query 를 막았습니다. V7 의 REVOKE 가 적용됐는지 확인하세요.");
                throw new ApiException(503, "SQL 조회가 잠겨 있습니다. 읽기 전용 권한 설정이 끝나지 않았으니 관리자에게 알려 주세요.");
            }
        }
    }

    private SqlResult read(ResultSet rs) throws SQLException {
        ResultSetMetaData meta = rs.getMetaData();
        int columnCount = meta.getColumnCount();
        List<String> columns = new ArrayList<>(columnCount);
        for (int c = 1; c <= columnCount; c++) {
            columns.add(meta.getColumnLabel(c));
        }

        List<List<Object>> rows = new ArrayList<>();
        boolean truncated = false;
        while (rs.next()) {
            if (rows.size() >= MAX_ROWS) {
                truncated = true;
                break;
            }
            List<Object> row = new ArrayList<>(columnCount);
            for (int c = 1; c <= columnCount; c++) {
                row.add(SqlResult.cell(rs.getObject(c)));
            }
            rows.add(row);
        }
        return new SqlResult(columns, rows, truncated);
    }

    /** DB 오류를 모델이 고쳐 쓸 수 있는 말로 바꾼다. */
    private ApiException translate(SQLException e) {
        String detail = firstLine(e.getMessage());
        String state = e.getSQLState();
        String message;
        if ("57014".equals(state)) {
            message = "5초 안에 끝나지 않아 멈췄습니다. 기간이나 조건을 좁히고 필요한 열만 고르세요.";
        } else if ("42501".equals(state)) {
            message = "접근 권한이 없습니다. ai_ro 스키마의 뷰만 조회할 수 있습니다. (" + detail + ")";
        } else if ("42P01".equals(state)) {
            message = "없는 테이블입니다. ai_ro.<뷰 이름> 형태로, 도구 설명에 있는 뷰만 쓰세요. (" + detail + ")";
        } else if ("42704".equals(state)) {
            message = "읽기 전용 역할(ai_readonly)이 준비되지 않았습니다. DB 마이그레이션 V7 이 적용됐는지 관리자에게 확인해 달라고 하세요.";
        } else if (state != null && state.startsWith("08")) {
            log.warn("sql_query DB 연결 실패: {}", e.getMessage());
            message = "DB 에 연결하지 못했습니다. 잠시 뒤 다시 시도하세요.";
        } else {
            message = "SQL 실행 실패: " + detail;
        }
        return new ApiException(400, message.length() > MAX_ERROR_CHARS ? message.substring(0, MAX_ERROR_CHARS) + "…" : message);
    }

    private static String firstLine(String text) {
        if (text == null) {
            return "";
        }
        int newline = text.indexOf('\n');
        String line = (newline < 0 ? text : text.substring(0, newline)).trim();
        return line.startsWith("ERROR: ") ? line.substring("ERROR: ".length()) : line;
    }
}
