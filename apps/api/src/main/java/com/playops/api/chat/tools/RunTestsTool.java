package com.playops.api.chat.tools;

import com.playops.api.chat.ChatTool;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolDisplay;
import com.playops.api.chat.ToolTier;
import com.playops.api.dto.ExecutionResponse;
import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolSpec;
import com.playops.api.service.ExecutionQueryService;
import com.playops.api.service.FileStorageService;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 테스트 실행을 시작한다. (RUN — 사용자 허락을 받은 뒤에만 실행된다)
 *
 * 화면의 "실행" 버튼과 같은 경로(ExecutionQueryService.triggerRun)로 실행을 만든다.
 * 실행은 비동기라 시작만 하고 끝나기를 기다리지 않는다. 결과는 get_execution_detail 로 본다.
 * 허락을 묻는 일은 에이전트 루프가 tier 를 보고 한다. 이 도구는 허락 창에 보일 문구(permissionReason)만 구체적으로 만든다.
 */
@Component
public class RunTestsTool implements ChatTool {

    static final String NAME = "run_tests";

    private final ExecutionQueryService executionQueryService;
    private final FileStorageService fileStorageService;
    private final LlmToolSpec spec;

    public RunTestsTool(ExecutionQueryService executionQueryService, FileStorageService fileStorageService) {
        this.executionQueryService = executionQueryService;
        this.fileStorageService = fileStorageService;

        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("specPath", LlmToolSpec.string("실행할 spec 파일 경로. 예: tests/login.spec.ts. 비우면 전체"));
        properties.put("grep", LlmToolSpec.string("케이스 이름으로 좁힌다. 예: 로그인 성공. 비우면 spec 안의 모든 케이스"));
        this.spec = new LlmToolSpec(
                NAME,
                "테스트를 실제로 실행한다. 실행 전에 사용자의 허락을 받는다. specPath 로 파일을, grep 으로 케이스를 좁힐 수 있고 "
                        + "둘 다 비우면 프로젝트 전체를 실행한다. 실행을 시작만 하고 끝나기를 기다리지 않는다. "
                        + "끝난 뒤 결과는 get_execution_detail 로 확인한다. 경로가 확실하지 않으면 먼저 list_files 로 확인한다.",
                LlmToolSpec.schema(ToolSupport.withProjectId(properties)));
    }

    @Override
    public LlmToolSpec spec() {
        return spec;
    }

    @Override
    public ToolTier tier() {
        return ToolTier.RUN;
    }

    /** 허락 창에 보일 한 줄. 무엇을 실행하는지 사용자가 눈으로 확인할 수 있게 구체적으로 적는다. */
    @Override
    public String permissionReason(LlmToolCall call) {
        String specPath = call.arg("specPath");
        String grep = call.arg("grep");
        if (specPath != null && grep != null) {
            return "spec " + specPath + " 의 케이스 \"" + grep + "\" 를 실행합니다";
        }
        if (specPath != null) {
            return "spec " + specPath + " 의 모든 케이스를 실행합니다";
        }
        if (grep != null) {
            return "이름에 \"" + grep + "\" 가 들어간 케이스를 실행합니다";
        }
        return "프로젝트의 전체 테스트를 실행합니다";
    }

    @Override
    public ChatToolOutput execute(LlmToolCall call, ChatToolContext context) {
        try {
            String projectId = ToolSupport.requireProject(call, context);
            String specPath = call.arg("specPath");
            String grep = call.arg("grep");

            if (specPath != null) {
                specPath = specPath.replace('\\', '/');
                // 경로가 프로젝트 밖을 가리키면 resolveFile 이 거절한다. 없는 파일이면 실행을 만들기 전에 알려 준다.
                if (!Files.exists(fileStorageService.resolveFile(projectId, specPath))) {
                    return ChatToolOutput.failed(
                            "'" + specPath + "' 파일을 찾을 수 없습니다. list_files 나 grep_files 로 경로를 먼저 확인하세요.");
                }
            }

            // 케이스 이름으로 좁힌 실행은 이력에 그 이름이 보이도록 caseTitle 도 함께 남긴다.
            ExecutionResponse started = executionQueryService.triggerRun(projectId, grep, specPath, null, grep, false);
            return toOutput(started, projectId);
        } catch (ApiException e) {
            return ToolSupport.failed(e);
        }
    }

    static ChatToolOutput toOutput(ExecutionResponse started, String projectId) {
        String status = String.valueOf(started.status());
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("executionId", started.id());
        data.put("status", status);
        data.put("projectId", projectId);
        return ChatToolOutput.ok(
                "실행 #" + started.id() + " 을 시작했습니다. (상태 " + status + ") 테스트는 아직 도는 중일 수 있으니, "
                        + "결과가 필요하면 잠시 뒤 get_execution_detail 로 확인하세요. 사용자는 '실행' 탭에서도 볼 수 있습니다.",
                "실행 #" + started.id() + " 시작",
                ToolDisplay.of("execution", data));
    }
}
