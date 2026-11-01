package com.playops.api.chat.tools;

import com.playops.api.chat.ChatTool;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolDisplay;
import com.playops.api.chat.ToolTier;
import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolSpec;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 프로젝트 데이터를 SQL 로 조회한다. (READ)
 *
 * 안전은 세 겹이다.
 * 1) SqlGuard — 읽기용 한 문장이 아니면 보내기 전에 돌려보낸다.
 * 2) ReadOnlySqlRunner — 읽기 전용 트랜잭션 + ai_readonly 역할 + 5초 제한 + 200행 제한.
 * 3) ai_ro 뷰(V7) — 비밀 열이 없고, 프로젝트 범위 밖의 행은 보이지 않는다.
 */
@Component
public class SqlQueryTool implements ChatTool {

    static final String NAME = "sql_query";

    private static final String NO_SCOPE_NOTE =
            "※ 열어 둔 프로젝트가 없고 관리자도 아니어서 조회 범위가 비어 있습니다. 어떤 뷰에서도 행이 나오지 않는 것이 정상입니다.";
    private static final String ADMIN_ALL_NOTE =
            "※ 프로젝트가 정해지지 않아 관리자 권한으로 모든 프로젝트를 조회했습니다.";

    private static final int MAX_TEXT_CELL_CHARS = 200;

    private final ReadOnlySqlRunner runner;
    private final LlmToolSpec spec;

    public SqlQueryTool(ReadOnlySqlRunner runner) {
        this.runner = runner;
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("sql", LlmToolSpec.string(
                "실행할 SELECT 또는 WITH 쿼리 한 문장. 예: SELECT status, count(*) FROM ai_ro.executions GROUP BY status"));
        properties.put("projectId", LlmToolSpec.string(
                "대상 프로젝트 id. 대화 중인 프로젝트가 있으면 생략해도 된다."));
        this.spec = new LlmToolSpec(NAME, description(), LlmToolSpec.schema(properties, "sql"));
    }

    static String description() {
        return "프로젝트의 실행 기록 · 케이스 결과 · AI 작업 같은 데이터를 SQL 로 조회한다(읽기 전용). "
                + "개수를 세거나 기간별로 묶거나 실패가 잦은 케이스를 찾을 때처럼, 다른 도구로 하나씩 읽기 번거로운 질문에 쓴다.\n"
                + "규칙: SELECT 또는 WITH 한 문장만 쓸 수 있고, 아래 ai_ro 뷰만 조회할 수 있다. "
                + "결과는 최대 200행이며 쿼리는 5초 안에 끝나야 한다. "
                + "프로젝트 범위로 자동 제한되므로 다른 프로젝트의 행은 보이지 않고 WHERE 로 프로젝트를 따로 거를 필요도 없다. "
                + "열 이름을 추측하지 말고 아래 목록에서 고른다.\n"
                + "상태값: executions.status 는 SCHEDULED · PENDING · RUNNING · CANCEL_REQUESTED · CANCELLED · PASSED · FAILED · ERROR, "
                + "execution_case_results.status 는 PASSED · FAILED · SKIPPED. 결과의 시각은 2026-11-01T05:00:00Z 처럼 UTC 로 보인다.\n"
                + "조회할 수 있는 뷰와 열:\n" + AiRoViews.describe();
    }

    @Override
    public LlmToolSpec spec() {
        return spec;
    }

    @Override
    public ToolTier tier() {
        return ToolTier.READ;
    }

    @Override
    public ChatToolOutput execute(LlmToolCall call, ChatToolContext context) {
        String rawSql = call.arg("sql");
        if (rawSql == null) {
            return ChatToolOutput.failed("sql 인자가 필요합니다.");
        }

        String sql;
        try {
            sql = SqlGuard.validate(rawSql);
        } catch (SqlGuard.Rejected e) {
            return ChatToolOutput.failed(e.getMessage());
        }

        try {
            String projectId = ToolSupport.optionalProject(call, context);
            // 프로젝트가 정해졌으면 관리자라도 그 프로젝트만 본다. 관리자가 모든 프로젝트를 보는 것은 프로젝트가 없을 때뿐이다.
            boolean seeAll = context.admin() && projectId == null;
            SqlResult result = runner.run(sql, projectId, seeAll);

            String note = null;
            if (projectId == null) {
                note = seeAll ? ADMIN_ALL_NOTE : NO_SCOPE_NOTE;
            }
            return toOutput(result, sql, note, projectId == null && !seeAll);
        } catch (ApiException e) {
            return ToolSupport.failed(e);
        }
    }

    /**
     * 결과 표를 모델용 글(content)과 화면용 표(display)로 바꾼다.
     *
     * @param note         결과 앞에 붙일 참고 글 (없으면 null)
     * @param emptyByScope 조회 범위가 비어서 행이 없는 경우인지 (요약에 그 사실을 적는다)
     */
    static ChatToolOutput toOutput(SqlResult result, String sql, String note, boolean emptyByScope) {
        StringBuilder text = new StringBuilder();
        if (note != null) {
            text.append(note).append("\n\n");
        }
        int rowCount = result.rows().size();
        if (result.truncated()) {
            text.append("결과 ").append(rowCount).append("행 이상 (").append(rowCount).append("행까지만 보여줍니다. 조건을 좁혀 보세요)\n");
        } else {
            text.append("결과 ").append(rowCount).append("행\n");
        }
        text.append(String.join(" | ", result.columns())).append('\n');
        for (List<Object> row : result.rows()) {
            for (int c = 0; c < row.size(); c++) {
                if (c > 0) {
                    text.append(" | ");
                }
                text.append(textCell(row.get(c)));
            }
            text.append('\n');
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("columns", result.columns());
        data.put("rows", result.rows());
        data.put("truncated", result.truncated());
        data.put("sql", sql);

        String summary = (result.truncated() ? rowCount + "행 이상" : rowCount + "행")
                + (emptyByScope ? " (조회 범위 없음)" : "");
        return ChatToolOutput.ok(ToolSupport.truncate(text.toString().stripTrailing()), summary, ToolDisplay.of("table", data));
    }

    /** 모델이 읽는 표의 한 칸. 줄바꿈은 표를 깨므로 공백으로 바꾸고 길면 자른다. */
    private static String textCell(Object value) {
        if (value == null) {
            return "NULL";
        }
        return ToolSupport.oneLine(String.valueOf(value), MAX_TEXT_CELL_CHARS);
    }
}
