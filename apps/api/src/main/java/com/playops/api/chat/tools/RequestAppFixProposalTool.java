package com.playops.api.chat.tools;

import com.playops.api.chat.ChatTool;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolTier;
import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolSpec;
import com.playops.api.service.AppFixProposalService;
import org.springframework.stereotype.Component;

/**
 * 결함의 제품 코드 수정안 요청 (RUN — AI 분석을 새로 시작하므로 사용자 허락 뒤에만 실행).
 * 화면과 같은 서비스라 같은 실패 · 같은 기준 커밋이면 이미 있는 수정안을 돌려준다. 읽기 전용 진단이고 저장소에는 쓰지 않는다.
 */
@Component
public class RequestAppFixProposalTool implements ChatTool {

    private final AppFixProposalService service;

    public RequestAppFixProposalTool(AppFixProposalService service) {
        this.service = service;
    }

    @Override
    public LlmToolSpec spec() {
        return new LlmToolSpec(
                "request_app_fix_proposal",
                "코드 · API 오류 후보 결함의 제품 코드 수정안(진단과 검토용 diff) 분석을 시작한다. 실행 전에 사용자의 허락을 받는다. "
                        + "이미 같은 기준의 수정안이 있으면 그것을 돌려준다. 분석은 비동기라 결과는 get_app_fix_proposal 로 본다. "
                        + "승인 · PR · 저장소 쓰기는 하지 않는다.",
                LlmToolSpec.schema(ToolSupport.withProjectId(GetAppFixProposalTool.keyProperties()), "specPath", "grep"));
    }

    @Override
    public ToolTier tier() {
        return ToolTier.RUN;
    }

    @Override
    public String permissionReason(LlmToolCall call) {
        return "결함 \"" + call.arg("grep") + "\" (" + call.arg("specPath") + ")의 제품 코드 수정안을 AI로 분석합니다 (저장소에는 쓰지 않음)";
    }

    @Override
    public ChatToolOutput execute(LlmToolCall call, ChatToolContext context) {
        try {
            String projectId = ToolSupport.requireProject(call, context);
            return ChatToolOutput.ok(GetAppFixProposalTool.describe(service.request(projectId, call.arg("specPath"), call.arg("grep"),
                    null, context.userId(), context.admin())), "제품 코드 수정안 요청");
        } catch (ApiException e) {
            return ToolSupport.failed(e);
        }
    }
}
