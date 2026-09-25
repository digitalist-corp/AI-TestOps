package com.playops.api.service;

import com.playops.api.dto.AiEditAssistVerifyResponse;
import com.playops.api.entity.Project;
import com.playops.api.exception.ApiException;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;

/**
 * 소스 탐색기에서 파일을 편집하는 동안 AI에게 자연어로 수정을 요청하는 기능("Playwright 시나리오 작성
 * AI 도움").파일을 직접 읽거나 쓰지 않는다 — 에디터에 이미 열려 있는 버퍼 내용을 그대로 받아 수정된
 * 전체 내용을 돌려주고, 프론트가 에디터 버퍼만 교체한다. 실제 파일 저장은 기존 "저장" 버튼을 눌러야
 * 반영되므로 그 자체가 검토 단계 역할을 한다 — CODE_FIX/TEMPLATE_GENERATE처럼 별도 AiJob 검토 파이프라인이
 * 필요 없다.
 *
 * verifyEdit()은 여기서 한 단계 더 나아가, AI가 제안한 내용을 실제로 실행해서 통과/실패를 보여준다
 * (디스크에는 쓰지 않는 별도의 샌드박스 검증 — CODE_FIX의 자동 적용 게이트와는 무관).
 */
@Service
public class AiEditAssistService {

    private final LlmGatewayService llmGatewayService;
    private final ProjectService projectService;
    private final AiRunnerDockerService aiRunnerDockerService;

    public AiEditAssistService(
            LlmGatewayService llmGatewayService,
            ProjectService projectService,
            AiRunnerDockerService aiRunnerDockerService
    ) {
        this.llmGatewayService = llmGatewayService;
        this.projectService = projectService;
        this.aiRunnerDockerService = aiRunnerDockerService;
    }

    public String editFile(String projectId, String filePath, String currentContent, String instruction) {
        if (filePath == null || filePath.isBlank()) {
            throw new ApiException(400, "대상 파일 경로가 필요합니다.");
        }
        if (instruction == null || instruction.isBlank()) {
            throw new ApiException(400, "요청 사항을 입력하세요.");
        }
        Project project = projectService.getProject(projectId);

        String systemPrompt = """
                You are an expert QA automation engineer specializing in Playwright v%s and TypeScript,
                helping a user edit the file "%s" inside an existing AI-TestOps-managed test project.
                You will be given the file's CURRENT full content (may be empty) and a natural-language instruction.
                Return ONLY the complete, updated file content reflecting the instruction —
                no markdown code fences, no explanation, no diff syntax, just the raw new file content.
                """.formatted(project.getPlaywrightVersion(), filePath);

        String userPrompt = "현재 파일 내용:\n```\n"
                + (currentContent != null ? currentContent : "")
                + "\n```\n\n요청 사항: " + instruction;

        String raw = llmGatewayService.chat(project.getAiModelProvider(), systemPrompt, userPrompt);
        return stripMarkdownFence(raw);
    }

    public AiEditAssistVerifyResponse verifyEdit(String projectId, String filePath, String proposedContent, String specPath) {
        if (filePath == null || filePath.isBlank()) {
            throw new ApiException(400, "대상 파일 경로가 필요합니다.");
        }
        String effectiveSpec = (specPath != null && !specPath.isBlank()) ? specPath : filePath;
        if (!effectiveSpec.endsWith(".spec.ts") && !effectiveSpec.endsWith(".spec.js")) {
            throw new ApiException(400, "실행할 spec 파일을 지정하세요 (.spec.ts/.spec.js).");
        }
        Project project = projectService.getProject(projectId);

        Instant start = Instant.now();
        AiRunnerDockerService.VerifyResult result = aiRunnerDockerService.runVerifyJob(
                project, effectiveSpec, Map.of(filePath, proposedContent != null ? proposedContent : ""));
        int durationMs = (int) Duration.between(start, Instant.now()).toMillis();
        return new AiEditAssistVerifyResponse(result.passed(), result.output(), durationMs, effectiveSpec);
    }

    private String stripMarkdownFence(String raw) {
        String trimmed = raw.trim();
        if (trimmed.startsWith("```")) {
            trimmed = trimmed.replaceFirst("^```(typescript|ts|javascript|js)?", "").trim();
            if (trimmed.endsWith("```")) {
                trimmed = trimmed.substring(0, trimmed.length() - 3).trim();
            }
        }
        return trimmed;
    }
}
