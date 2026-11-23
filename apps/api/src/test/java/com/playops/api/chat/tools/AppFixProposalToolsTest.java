package com.playops.api.chat.tools;

import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolTier;
import com.playops.api.dto.AppFixDtos.FileDiff;
import com.playops.api.dto.AppFixDtos.Proposal;
import com.playops.api.dto.AppFixDtos.View;
import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.service.AppFixProposalService;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 채팅의 제품 코드 수정안 도구: 화면과 같은 서비스 · 같은 권한, 요청은 사용자 허락(RUN) 뒤에만. */
class AppFixProposalToolsTest {

    private final AppFixProposalService service = mock(AppFixProposalService.class);
    private final GetAppFixProposalTool get = new GetAppFixProposalTool(service);
    private final RequestAppFixProposalTool request = new RequestAppFixProposalTool(service);
    private final ChatToolContext member = new ChatToolContext("shop", 7L, false, 1L);

    private static LlmToolCall call(String name, Map<String, Object> extra) {
        Map<String, Object> args = new HashMap<>(Map.of("specPath", "tests/cart.spec.ts", "grep", "합계"));
        args.putAll(extra);
        return new LlmToolCall("c1", name, args);
    }

    private static View ready() {
        Proposal p = new Proposal(5L, "DIFF_READY", "APP_CODE", 41L, "acme/shop", null,
                "0123456789abcdef0123456789abcdef01234567", "apps/shop", "DIFF_APPLIES", "증거", "합계에서 1을 뺀다",
                List.of("apps/shop/app/cart/page.tsx:2 — items.length - 1"), List.of(),
                List.of(new FileDiff("apps/shop/app/cart/page.tsx", "--- a/x\n+++ b/x\n")), null, null, 7L, null, null);
        return new View("APP_CODE", 41L, false, p);
    }

    @Test
    void readingIsReadTierAndRequestingAsksTheUserFirst() {
        assertThat(get.tier()).isEqualTo(ToolTier.READ);
        assertThat(request.tier()).isEqualTo(ToolTier.RUN);
        assertThat(request.permissionReason(call("request_app_fix_proposal", Map.of()), member))
                .contains("합계", "AI");
    }

    @Test
    void readUsesTheChatUsersOwnPermission() {
        when(service.get("shop", "tests/cart.spec.ts", "합계", 7L, false)).thenReturn(ready());

        ChatToolOutput out = get.execute(call("get_app_fix_proposal", Map.of()), member);

        assertThat(out.error()).isFalse();
        assertThat(out.content()).contains("DIFF_READY", "0123456", "apps/shop/app/cart/page.tsx", "재현 테스트 미실행");
    }

    @Test
    void serviceRefusalComesBackAsAFailedResult() {
        when(service.request("shop", "tests/cart.spec.ts", "합계", null, 7L, false))
                .thenThrow(new ApiException(403, "FORBIDDEN", "이 프로젝트의 멤버가 아닙니다."));

        ChatToolOutput out = request.execute(call("request_app_fix_proposal", Map.of()), member);

        assertThat(out.error()).isTrue();
        assertThat(out.content()).contains("멤버가 아닙니다");
    }

    @Test
    void anotherProjectThanTheOpenChatIsRefusedBeforeTheService() {
        ChatToolOutput out = request.execute(call("request_app_fix_proposal", Map.of("projectId", "other")), member);

        assertThat(out.error()).isTrue();
        verify(service, never()).request(anyString(), anyString(), anyString(), any(), any(), anyBoolean());
    }
}
