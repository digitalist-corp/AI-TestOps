package com.playops.api.chat.tools;

import com.playops.api.chat.ChatTool;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolTier;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolSpec;
import com.playops.api.service.ProjectService;
import com.playops.api.util.ProjectEnvVariables;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * AI 채팅에서 테스트에 필요한 로그인 계정 및 환경변수를 프로젝트 설정에 직접 저장하는 도구.
 * 사용자가 알려준 아이디, 비밀번호를 LOGIN_ID, LOGIN_PASSWORD, USERNAME, PASSWORD 로 저장한다.
 */
@Component
public class SetEnvVariablesTool implements ChatTool {

    private final ProjectService projectService;

    public SetEnvVariablesTool(ProjectService projectService) {
        this.projectService = projectService;
    }

    @Override
    public LlmToolSpec spec() {
        return new LlmToolSpec(
                "set_env_variables",
                "프로젝트의 환경변수(로그인 아이디, 비밀번호, 기타 변수)를 설정하거나 변경한다. "
                        + "로그인 테스트나 사이트 탐색에 필요한 로그인 계정(loginId, loginPassword)을 직접 저장할 수 있다.",
                LlmToolSpec.schema(
                        CoreToolSupport.withProjectId(Map.of(
                                "loginId", LlmToolSpec.string("로그인 아이디 또는 사용자명 (LOGIN_ID, USERNAME 에 저장)"),
                                "loginPassword", LlmToolSpec.string("로그인 비밀번호 (LOGIN_PASSWORD, PASSWORD 에 저장)"),
                                "loginPath", LlmToolSpec.string("로그인 화면 경로 또는 URL. 예: /login (선택)"),
                                "variables", LlmToolSpec.string("추가 환경변수 (KEY=VALUE 형태의 여러 줄 또는 쉼표 구분, 선택)")
                        ))
                ));
    }

    @Override
    public ToolTier tier() {
        return ToolTier.CHANGE;
    }

    @Override
    public ChatToolOutput execute(LlmToolCall call, ChatToolContext context) {
        String projectId = context.projectIdFor(call);
        Map<String, String> additions = new LinkedHashMap<>();

        String loginId = call.arg("loginId");
        if (loginId != null && !loginId.isBlank()) {
            additions.put("LOGIN_ID", loginId.trim());
            additions.put("USERNAME", loginId.trim());
        }

        String loginPassword = call.arg("loginPassword");
        if (loginPassword != null && !loginPassword.isBlank()) {
            additions.put("LOGIN_PASSWORD", loginPassword.trim());
            additions.put("PASSWORD", loginPassword.trim());
        }

        String loginPath = call.arg("loginPath");
        if (loginPath != null && !loginPath.isBlank()) {
            additions.put("LOGIN_PATH", loginPath.trim());
        }

        String variables = call.arg("variables");
        if (variables != null && !variables.isBlank()) {
            String trimmed = variables.trim();
            if (trimmed.startsWith("{")) {
                try {
                    additions.putAll(ProjectEnvVariables.parse(trimmed));
                } catch (Exception e) {
                    parseKeyValueLines(trimmed, additions);
                }
            } else {
                parseKeyValueLines(trimmed, additions);
            }
        }

        if (additions.isEmpty()) {
            return ChatToolOutput.failed("설정할 환경변수 값(loginId, loginPassword 또는 variables)이 없습니다.");
        }

        projectService.mergeEnvVariables(projectId, additions);

        StringBuilder sb = new StringBuilder();
        sb.append("프로젝트 환경변수를 성공적으로 저장했습니다: ");
        sb.append(String.join(", ", additions.keySet()));
        if (additions.containsKey("LOGIN_ID")) {
            sb.append("\n(로그인 아이디: ").append(additions.get("LOGIN_ID")).append(" 설정됨)");
        }
        sb.append("\n이제 생성된 테스트 실행이나 사이트 탐색에서 이 환경변수가 사용됩니다.");

        return ChatToolOutput.ok(sb.toString(), "환경변수 설정 (" + String.join(", ", additions.keySet()) + ")");
    }

    private void parseKeyValueLines(String text, Map<String, String> target) {
        String[] lines = text.split("[\r\n,]+");
        for (String line : lines) {
            line = line.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;
            int eq = line.indexOf('=');
            if (eq > 0) {
                String key = line.substring(0, eq).trim();
                String val = line.substring(eq + 1).trim();
                if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
                    if (val.length() >= 2) {
                        val = val.substring(1, val.length() - 1);
                    }
                }
                target.put(key, val);
            }
        }
    }
}
