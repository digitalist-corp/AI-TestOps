package com.playops.api.chat.tools;

import com.playops.api.chat.ChatTool;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolTier;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolSpec;
import com.playops.api.service.SiteMapPromptService;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/** 소스 분석으로 찾아 둔 화면 목록 · 화면 요소. */
@Component
public class GetSitemapTool implements ChatTool {

    private final SiteMapPromptService siteMapPromptService;

    public GetSitemapTool(SiteMapPromptService siteMapPromptService) {
        this.siteMapPromptService = siteMapPromptService;
    }

    @Override
    public LlmToolSpec spec() {
        return new LlmToolSpec(
                "get_sitemap",
                "앱의 소스 코드를 분석해 찾아 둔 화면 목록을 본다. route 를 주면 그 화면의 요소와 셀렉터까지 본다. "
                        + "어떤 화면이 있는지, 화면에 무엇이 있는지 물을 때와 시나리오를 만들기 전에 쓴다.",
                LlmToolSpec.schema(
                        CoreToolSupport.withProjectId(Map.of(
                                "route", LlmToolSpec.string("자세히 볼 화면의 경로. 비우면 전체 목록")))));
    }

    @Override
    public ToolTier tier() {
        return ToolTier.READ;
    }

    @Override
    public ChatToolOutput execute(LlmToolCall call, ChatToolContext context) {
        String projectId = context.projectIdFor(call);
        String route = call.arg("route");
        String text = route == null ? siteMapPromptService.overview(projectId)
                : siteMapPromptService.context(projectId, List.of(route));
        if (text.isBlank()) {
            return ChatToolOutput.ok("아직 구조 분석 결과가 없습니다. 프로젝트의 '구조' 탭에서 소스 저장소를 연결하고 분석을 시작해야 합니다.",
                    "분석 결과 없음");
        }
        return ChatToolOutput.ok(CoreToolSupport.truncate(text), route == null ? "전체 화면" : route);
    }
}
