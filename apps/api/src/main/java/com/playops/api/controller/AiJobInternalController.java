package com.playops.api.controller;

import com.playops.api.dto.LlmProxyRequest;
import com.playops.api.dto.LlmProxyResponse;
import com.playops.api.entity.AiJob;
import com.playops.api.service.AiJobService;
import com.playops.api.service.LlmGatewayService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

/**
 * AI Runner 컨테이너 전용 엔드포인트. 사용자 로그인 토큰이 아니라 job-scoped 콜백 토큰으로 인증한다
 * (AuthInterceptor가 /internal/** 은 통과시키고, 여기서 자체 검증한다).
 */
@RestController
@RequestMapping("/internal/ai-jobs/{jobId}")
public class AiJobInternalController {

    private final AiJobService aiJobService;
    private final LlmGatewayService llmGatewayService;

    public AiJobInternalController(AiJobService aiJobService, LlmGatewayService llmGatewayService) {
        this.aiJobService = aiJobService;
        this.llmGatewayService = llmGatewayService;
    }

    @PostMapping("/llm")
    public LlmProxyResponse callLlm(@PathVariable Long jobId, @RequestBody LlmProxyRequest body, HttpServletRequest request) {
        AiJob job = aiJobService.validateCallbackToken(jobId, extractToken(request));
        String content = llmGatewayService.chat(job.getAiModelProvider(), body.getSystemPrompt(), body.getUserPrompt(),
                "AI 러너", job.getProjectId());
        return new LlmProxyResponse(content);
    }

    private String extractToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            return header.substring(7);
        }
        return null;
    }
}
