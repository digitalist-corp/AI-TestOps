package com.playops.api.chat.tools;

import com.playops.api.chat.ChatTool;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolDisplay;
import com.playops.api.chat.ToolTier;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolSpec;
import com.playops.api.repository.ExecutionCaseResultRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 케이스 이름으로 최근 실행 결과 이력을 본다. (READ)
 * "이 케이스가 요즘 자주 깨지나?" 를 물을 때 쓴다.
 */
@Component
public class GetCaseHistoryTool implements ChatTool {

    static final String NAME = "get_case_history";

    static final int DEFAULT_LIMIT = 10;
    static final int MAX_LIMIT = 50;
    private static final int MAX_ERROR_CHARS = 200;
    private static final int MAX_TITLE_CHARS = 120;

    /** 사용자가 화면에서 보는 시각과 맞추기 위해 한국 시간으로 보여 준다. */
    private static final DateTimeFormatter TIME_FORMAT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneId.of("Asia/Seoul"));

    private static final List<String> COLUMNS = List.of("실행", "케이스", "시각(KST)", "상태", "오류(첫 줄)");

    private final ExecutionCaseResultRepository caseResultRepository;
    private final LlmToolSpec spec;

    public GetCaseHistoryTool(ExecutionCaseResultRepository caseResultRepository) {
        this.caseResultRepository = caseResultRepository;

        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("caseName", LlmToolSpec.string("찾을 케이스 이름. 일부만 써도 된다(대소문자 구분 없음). 예: 로그인"));
        properties.put("limit", LlmToolSpec.integer("가져올 결과 수. 기본 " + DEFAULT_LIMIT + ", 최대 " + MAX_LIMIT));
        this.spec = new LlmToolSpec(
                NAME,
                "케이스 이름으로 최근 실행 결과 이력(실행 ID · 시각 · 통과/실패 · 오류 첫 줄)을 최신순으로 본다. "
                        + "이름이 부분만 맞아도 찾는다. 같은 케이스가 반복해서 실패하는지, 언제부터 깨졌는지 확인할 때 쓴다.",
                LlmToolSpec.schema(ToolSupport.withProjectId(properties), "caseName"));
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
        String caseName = call.arg("caseName");
        if (caseName == null) {
            return ChatToolOutput.failed("caseName 인자가 필요합니다.");
        }
        int limit = (int) Math.max(1, Math.min(MAX_LIMIT, call.argLong("limit", DEFAULT_LIMIT)));

        try {
            String projectId = ToolSupport.requireProject(call, context);
            // 하나 더 읽어서 limit 보다 더 있는지 알아낸다.
            List<ExecutionCaseResult> found = caseResultRepository.findRecentByProjectAndCaseTitle(
                    projectId, likePattern(caseName), PageRequest.of(0, limit + 1));
            if (found.isEmpty()) {
                return ChatToolOutput.ok("이름에 '" + caseName + "' 이(가) 들어간 케이스의 실행 결과가 없습니다.", "0건");
            }
            boolean truncated = found.size() > limit;
            return toOutput(truncated ? found.subList(0, limit) : found, truncated);
        } catch (ApiException e) {
            return ToolSupport.failed(e);
        }
    }

    static ChatToolOutput toOutput(List<ExecutionCaseResult> results, boolean truncated) {
        List<List<Object>> rows = new ArrayList<>();
        StringBuilder text = new StringBuilder();
        text.append(String.join(" | ", COLUMNS)).append('\n');
        for (ExecutionCaseResult result : results) {
            String time = result.getCreatedAt() == null ? "" : TIME_FORMAT.format(result.getCreatedAt());
            String title = ToolSupport.oneLine(result.getCaseTitle(), MAX_TITLE_CHARS);
            String error = ToolSupport.firstLine(result.getErrorMessage(), MAX_ERROR_CHARS);
            List<Object> row = new ArrayList<>(List.of(
                    "#" + result.getExecutionId(), title, time, String.valueOf(result.getStatus()), error));
            rows.add(row);
            text.append(String.join(" | ", "#" + result.getExecutionId(), title, time,
                    String.valueOf(result.getStatus()), error.isEmpty() ? "-" : error)).append('\n');
        }
        if (truncated) {
            text.append("... 더 오래된 결과가 있습니다. limit 을 늘려 보세요.\n");
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("columns", COLUMNS);
        data.put("rows", rows);
        data.put("truncated", truncated);
        return ChatToolOutput.ok(
                ToolSupport.truncate(text.toString().stripTrailing()),
                results.size() + "건" + (truncated ? " 이상" : ""),
                ToolDisplay.of("table", data));
    }

    /**
     * 부분 일치용 LIKE 패턴. 사용자가 쓴 % 와 _ 는 글자 그대로 찾도록 막는다(이스케이프 글자는 !).
     * 저장소 쿼리의 escape '!' 와 짝이다.
     */
    static String likePattern(String caseName) {
        String escaped = caseName.toLowerCase(Locale.ROOT)
                .replace("!", "!!")
                .replace("%", "!%")
                .replace("_", "!_");
        return "%" + escaped + "%";
    }
}
