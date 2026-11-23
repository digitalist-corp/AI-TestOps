package com.playops.api.chat.tools;

import com.playops.api.chat.ChatTool;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolTier;
import com.playops.api.dto.AppFixDtos.FileDiff;
import com.playops.api.dto.AppFixDtos.Proposal;
import com.playops.api.dto.AppFixDtos.View;
import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolSpec;
import com.playops.api.service.AppFixProposalService;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 결함의 제품 코드 수정안 조회 (READ). 결함 화면의 "AI 수정 제안 보기"와 같은 서비스 · 같은 권한(채팅 사용자의 권한)이다.
 * 분류 정정 · 승인 · 게시 · 저장소 쓰기는 하지 않는다.
 */
@Component
public class GetAppFixProposalTool implements ChatTool {

    private final AppFixProposalService service;

    public GetAppFixProposalTool(AppFixProposalService service) {
        this.service = service;
    }

    @Override
    public LlmToolSpec spec() {
        return new LlmToolSpec(
                "get_app_fix_proposal",
                "결함(실패한 계획 항목)의 서버 분류와 가장 최근 제품 코드 수정안(진단 · 기준 커밋 · 파일별 diff)을 본다. "
                        + "테스트 코드가 아니라 테스트 대상 서비스의 코드다. 읽기만 한다.",
                LlmToolSpec.schema(ToolSupport.withProjectId(keyProperties()), "specPath", "grep"));
    }

    static Map<String, Object> keyProperties() {
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("specPath", LlmToolSpec.string("결함의 spec 파일 경로. 예: tests/cart.spec.ts"));
        properties.put("grep", LlmToolSpec.string("결함 케이스의 grep (결함 목록의 grep 값 그대로)"));
        return properties;
    }

    @Override
    public ToolTier tier() {
        return ToolTier.READ;
    }

    @Override
    public ChatToolOutput execute(LlmToolCall call, ChatToolContext context) {
        try {
            String projectId = ToolSupport.requireProject(call, context);
            View view = service.get(projectId, call.arg("specPath"), call.arg("grep"), context.userId(), context.admin());
            return ChatToolOutput.ok(describe(view), "제품 코드 수정안 조회");
        } catch (ApiException e) {
            return ToolSupport.failed(e);
        }
    }

    /** 모델에게 줄 요약. diff 본문은 길어 파일 경로까지만 싣는다 */
    static String describe(View view) {
        StringBuilder out = new StringBuilder("분류: ").append(view.category())
                .append(" (APP_CODE · APP_API 만 수정 제안 후보)\n마지막 실패 실행: #").append(view.latestFailedExecutionId()).append('\n');
        Proposal p = view.proposal();
        if (p == null) {
            return out.append("수정안: 아직 없음. 사용자가 원하면 request_app_fix_proposal 로 요청한다.").toString();
        }
        out.append("수정안 #").append(p.id()).append(" 상태: ").append(p.status());
        if (view.stale()) out.append(" (이전 수정안: 지금 실패 실행 · 소스 설정과 다름)");
        out.append('\n');
        if (p.sourceRepository() != null) {
            out.append("소스: ").append(p.sourceRepository()).append(p.sourceBranch() == null ? "" : " (" + p.sourceBranch() + ")")
                    .append(" @ ").append(p.sourceSha() == null ? "기준 커밋 없음" : p.sourceSha())
                    .append(" · 배포 버전 미확인\n");
        }
        if (p.appRoot() != null) out.append("앱 폴더: ").append(p.appRoot()).append('\n');
        if ("DIFF_APPLIES".equals(p.verification())) out.append("검증: diff 적용 확인 · 재현 테스트 미실행\n");
        if (p.summary() != null) out.append("진단: ").append(p.summary()).append('\n');
        p.causes().forEach(c -> out.append("- 원인 후보: ").append(c).append('\n'));
        p.checks().forEach(c -> out.append("- 확인할 곳: ").append(c).append('\n'));
        for (FileDiff f : p.files()) out.append("- 수정 파일: ").append(f.path()).append('\n');
        if (p.limitation() != null) out.append("한계: ").append(p.limitation()).append('\n');
        if (p.errorMessage() != null) out.append("실패 이유: ").append(p.errorMessage()).append('\n');
        return ToolSupport.truncate(out.toString());
    }
}
