package com.playops.api.service;

import com.playops.api.dto.AiAnalysisRequest;
import com.playops.api.dto.AiAnalysisResponse;
import com.playops.api.dto.AiChatRequest;
import com.playops.api.dto.ExecutionDetailResponse;
import com.playops.api.dto.ExecutionResponse;
import com.playops.api.entity.AiModelProvider;
import com.playops.api.entity.Project;
import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmMessage;
import com.playops.api.llm.LlmRole;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
public class AiAnalysisService {

    /** 프롬프트에 실어 보낼 이전 대화 최대 턴 수. */
    private static final int MAX_HISTORY_MESSAGES = 20;

    private static final List<AiModelProvider> PROVIDER_PREFERENCE =
            List.of(AiModelProvider.CLAUDE, AiModelProvider.GPT);

    private final ExecutionQueryService executionQueryService;
    private final ExecutionLogService executionLogService;
    private final LlmGatewayService llmGatewayService;
    private final ProjectService projectService;
    private final AiProviderSettingsService aiProviderSettingsService;

    public AiAnalysisService(
            ExecutionQueryService executionQueryService,
            ExecutionLogService executionLogService,
            LlmGatewayService llmGatewayService,
            ProjectService projectService,
            AiProviderSettingsService aiProviderSettingsService
    ) {
        this.executionQueryService = executionQueryService;
        this.executionLogService = executionLogService;
        this.llmGatewayService = llmGatewayService;
        this.projectService = projectService;
        this.aiProviderSettingsService = aiProviderSettingsService;
    }

    public AiAnalysisResponse analyze(AiAnalysisRequest request) {
        Long executionId = request.getExecutionId();
        String userLevel = normalizeUserLevel(request.getUserLevel());

        ExecutionDetailResponse detail = loadDetailOrNull(executionId);
        String logContent = "";
        if (executionId != null) {
            try {
                logContent = executionLogService.readLog(executionId, 0).content();
            } catch (Exception e) {
                // 로그를 못 읽어도 메타정보만으로 분석은 가능하므로 무시한다.
            }
        }

        AiModelProvider provider = resolveProvider(request.getProvider(), detail);
        String systemPrompt = buildPersonaPrompt(userLevel);
        String userPrompt = buildAnalysisPrompt(detail, logContent, userLevel, request.getAdditionalContext());

        String aiResult = callLlm(provider, systemPrompt, List.of(LlmMessage.user(userPrompt)));
        return parseAiResponse(aiResult, userLevel);
    }

    public String chat(AiChatRequest request) {
        String question = request.getQuestion();
        if (question == null || question.isBlank()) {
            throw new ApiException(400, "질문을 입력해주세요.");
        }

        String userLevel = normalizeUserLevel(request.getUserLevel());
        // 실행을 지정하지 않았으면 그 프로젝트의 가장 최근 실행(실패 우선)을 스스로 찾는다.
        ExecutionDetailResponse detail = loadDetailOrNull(request.getExecutionId());
        if (detail == null && request.getProjectId() != null && !request.getProjectId().isBlank()) {
            detail = loadDetailOrNull(findRecentExecutionId(request.getProjectId()));
        }
        AiModelProvider provider = resolveProvider(request.getProvider(), detail);

        String systemPrompt = buildChatSystemPrompt(userLevel, detail, request.getProjectId());

        List<LlmMessage> messages = new ArrayList<>(toLlmHistory(request.getHistory()));
        messages.add(LlmMessage.user(question));

        return callLlm(provider, systemPrompt, messages);
    }

    /** 실패한 실행이 있으면 그것을, 없으면 가장 최근 실행을 고른다. */
    private Long findRecentExecutionId(String projectId) {
        try {
            List<ExecutionResponse> executions = executionQueryService.listByProject(projectId);
            if (executions.isEmpty()) {
                return null;
            }
            for (ExecutionResponse execution : executions) {
                String status = String.valueOf(execution.status());
                if (status.equals("FAILED") || status.equals("ERROR")) {
                    return execution.id();
                }
            }
            return executions.get(0).id();
        } catch (Exception ignored) {
            return null;
        }
    }

    private ExecutionDetailResponse loadDetailOrNull(Long executionId) {
        if (executionId == null) {
            return null;
        }
        try {
            return executionQueryService.getDetail(executionId);
        } catch (Exception ignored) {
            return null;
        }
    }

    /**
     * 공급자 결정 순서: 요청에 명시된 값 → 실행이 속한 프로젝트 설정 → 키가 등록된 첫 공급자 → CLAUDE.
     * 마지막 CLAUDE 는 아무 키도 없을 때 "키 미등록" 400 이 그대로 드러나게 하기 위한 값이다.
     */
    private AiModelProvider resolveProvider(String raw, ExecutionDetailResponse detail) {
        AiModelProvider requested = parseProviderOrNull(raw);
        if (requested != null) {
            return requested;
        }

        AiModelProvider fromProject = providerFromProject(detail);
        if (fromProject != null) {
            return fromProject;
        }

        for (AiModelProvider candidate : PROVIDER_PREFERENCE) {
            if (aiProviderSettingsService.hasKey(candidate)) {
                return candidate;
            }
        }
        return AiModelProvider.CLAUDE;
    }

    private AiModelProvider providerFromProject(ExecutionDetailResponse detail) {
        if (detail == null || detail.execution() == null) {
            return null;
        }
        String projectId = detail.execution().projectId();
        if (projectId == null || projectId.isBlank()) {
            return null;
        }
        try {
            Project project = projectService.getProject(projectId);
            return project != null ? project.getAiModelProvider() : null;
        } catch (Exception ignored) {
            return null;
        }
    }

    private AiModelProvider parseProviderOrNull(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return AiModelProvider.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private String normalizeUserLevel(String userLevel) {
        return userLevel != null ? userLevel.toUpperCase() : "JUNIOR";
    }

    /** 알 수 없는 role 은 버리고, 내용이 빈 메시지도 건너뛴다. 최근 MAX_HISTORY_MESSAGES 건만 남긴다. */
    private List<LlmMessage> toLlmHistory(List<AiChatRequest.ChatHistoryMessage> history) {
        if (history == null || history.isEmpty()) {
            return List.of();
        }
        List<LlmMessage> mapped = new ArrayList<>();
        for (AiChatRequest.ChatHistoryMessage entry : history) {
            if (entry == null || entry.getContent() == null || entry.getContent().isBlank()) {
                continue;
            }
            LlmRole role = parseRoleOrNull(entry.getRole());
            if (role == null) {
                continue;
            }
            mapped.add(new LlmMessage(role, entry.getContent()));
        }
        if (mapped.size() > MAX_HISTORY_MESSAGES) {
            mapped = new ArrayList<>(mapped.subList(mapped.size() - MAX_HISTORY_MESSAGES, mapped.size()));
        }
        // Claude 는 첫 메시지가 user 여야 하므로, 잘라낸 뒤 선두에 남은 assistant 턴은 버린다.
        while (!mapped.isEmpty() && mapped.get(0).role() == LlmRole.ASSISTANT) {
            mapped.remove(0);
        }
        return mapped;
    }

    private LlmRole parseRoleOrNull(String role) {
        if (role == null) {
            return null;
        }
        return switch (role.trim().toLowerCase()) {
            case "user" -> LlmRole.USER;
            case "assistant" -> LlmRole.ASSISTANT;
            default -> null;
        };
    }

    private String buildPersonaPrompt(String userLevel) {
        switch (userLevel) {
            case "NON_DEVELOPER":
                return "당신은 IT 비전공자 및 일반 사용자를 위해 친절하고 쉬운 비유로 설명해주는 웹 테스트 전문 AI 컨설턴트입니다. " +
                       "절대로 복잡한 기술 용어(DOM Selector, NullPointer, StackTrace 등)를 그대로 쓰지 말고, '웹사이트 버튼', '페이지 로딩 지연' 등 쉽게 이해 가능한 일상적 비유로 한글로 해설하세요.";
            case "SENIOR":
                return "당신은 대규모 E2E 프레임워크 및 Docker 환경 시니어 전문가/QA 아키텍트입니다. " +
                       "스택트레이스, Docker 컨테이너 격리 상태, Playwright Locator 선택자의 견고성(Robustness), Async/Await 레이스 조건, 네트워크 타임아웃을 명확하고 정교하게 기술적으로 분석하고 심층 개선 코드를 제안하세요.";
            case "JUNIOR":
            default:
                return "당신은 컴퓨터공학과 학부생 및 초급 개발자를 지도하는 멘토 개발자 AI입니다. " +
                       "Playwright 기본 개념(page.waitForSelector, locator.click, HTTP Status 등)을 활용하여 원인을 차근차근 설명하고, 학부생 눈높이에 맞춘 구체적인 Playwright 코드 수정 예시와 팁을 제공하세요.";
        }
    }

    /** 대화용 시스템 프롬프트: 페르소나 + 참고 실행 정보 + 답변 지침. 사용자 메시지에는 질문만 담는다. */
    /**
      * 채팅용 시스템 프롬프트.
      *
      * 예전에는 상태 · 통과 · 실패 세 숫자만 넣어, AI가 사용자에게 "실패 로그를 붙여넣어 달라"고
      * 요구할 수밖에 없었다. 지금은 프로젝트 정보와 실제 실패 로그 · 실패 케이스를 함께 넣는다.
      */
    private String buildChatSystemPrompt(String userLevel, ExecutionDetailResponse detail, String projectId) {
        StringBuilder sb = new StringBuilder(buildPersonaPrompt(userLevel));
        sb.append("\n\nPlaywright 테스트 및 E2E 결과 관련 질의응답을 진행합니다.\n");

        appendProjectContext(sb, projectId);
        appendExecutionContext(sb, detail);

        sb.append("\n답변 규칙\n");
        sb.append("- 위 정보는 이미 시스템이 제공했습니다. 사용자에게 로그나 코드를 붙여넣어 달라고 요구하지 마세요.\n");
        sb.append("- 정보가 부족하면 무엇이 더 필요한지 한 줄로만 말하고, 가진 정보로 할 수 있는 추정과 다음 행동을 먼저 제시하세요.\n");
        sb.append("- 실패 원인을 짚을 때는 근거가 된 로그 줄을 인용하세요.\n");
        sb.append("- 코드 수정이 필요하면 고칠 파일과 바뀔 부분을 구체적으로 제시하세요. 다만 실제 반영은 사람이 승인해야 하므로,\n");
        sb.append("  \"소스 탭의 AI 수정 도움\" 또는 \"AI로 만들기\"로 이어가라고 안내하세요.\n");
        sb.append("- 사용자의 기술 수준(").append(userLevel).append(")에 맞춰 한글 Markdown으로 답하세요.");
        return sb.toString();
    }

    private void appendProjectContext(StringBuilder sb, String projectId) {
        if (projectId == null || projectId.isBlank()) {
            sb.append("\n[지금 보고 있는 프로젝트] 없음 (전체 화면에서의 질문)\n");
            return;
        }
        try {
            var project = projectService.getProject(projectId);
            sb.append("\n[지금 보고 있는 프로젝트]\n");
            sb.append("- 이름: ").append(project.getProjectName()).append(" (id=").append(project.getProjectId()).append(")\n");
            if (project.getBaseUrl() != null) {
                sb.append("- 대상 사이트: ").append(project.getBaseUrl()).append("\n");
            }
            sb.append("- 실행 환경: Node ").append(project.getNodeVersion())
              .append(" · Playwright ").append(project.getPlaywrightVersion()).append("\n");
        } catch (Exception ignored) {
            sb.append("\n[지금 보고 있는 프로젝트] id=").append(projectId).append(" (상세 조회 실패)\n");
        }
    }

    private void appendExecutionContext(StringBuilder sb, ExecutionDetailResponse detail) {
        if (detail == null || detail.execution() == null) {
            sb.append("\n[최근 실행] 아직 실행 기록이 없습니다.\n");
            return;
        }
        var exec = detail.execution();
        sb.append("\n[참고할 최근 실행]\n");
        sb.append("- 실행 ID: ").append(exec.id()).append(", 상태: ").append(exec.status()).append("\n");
        sb.append("- 통과 ").append(exec.passedTests()).append(" / 실패 ").append(exec.failedTests())
          .append(" (전체 ").append(exec.totalTests()).append("), 소요 ").append(exec.durationMs()).append("ms\n");

        if (detail.caseResults() != null && !detail.caseResults().isEmpty()) {
            sb.append("- 실패한 케이스:\n");
            int shown = 0;
            for (var caseResult : detail.caseResults()) {
                if (shown >= 5) break;
                String status = String.valueOf(caseResult.status());
                if (status.equals("FAILED") || status.equals("ERROR")) {
                    sb.append("  · ").append(caseResult.caseTitle())
                      .append(" (").append(caseResult.specPath()).append(")\n");
                    if (caseResult.errorMessage() != null && !caseResult.errorMessage().isBlank()) {
                        String message = caseResult.errorMessage();
                        sb.append("    → ").append(message.length() > 500 ? message.substring(0, 500) : message).append("\n");
                    }
                    shown++;
                }
            }
        }

        String logs = detail.logOutput();
        if (logs != null && !logs.isBlank()) {
            String tail = logs.length() > 3000 ? logs.substring(logs.length() - 3000) : logs;
            sb.append("\n[실행 로그 (마지막 부분)]\n").append(tail).append("\n");
        }
    }

    private String buildAnalysisPrompt(ExecutionDetailResponse detail, String logs, String userLevel, String additionalContext) {
        StringBuilder sb = new StringBuilder();
        sb.append("다음 Playwright E2E 웹 테스트 결과를 분석해주세요.\n\n");
        if (detail != null && detail.execution() != null) {
            var exec = detail.execution();
            sb.append("[실행 메타정보]\n");
            sb.append("- 실행 ID: ").append(exec.id()).append("\n");
            sb.append("- 최종 상태: ").append(exec.status()).append("\n");
            sb.append("- 전체 테스트: ").append(exec.totalTests())
              .append(", 성공: ").append(exec.passedTests())
              .append(", 실패: ").append(exec.failedTests()).append("\n");
            sb.append("- 실행시간: ").append(exec.durationMs()).append("ms\n\n");
        }
        if (logs != null && !logs.isBlank()) {
            sb.append("[실행 로그 및 오류 내역]\n");
            // 로그가 너무 길면 하위 2500자 사용
            String trimmedLogs = logs.length() > 2500 ? logs.substring(logs.length() - 2500) : logs;
            sb.append(trimmedLogs).append("\n\n");
        }
        if (additionalContext != null && !additionalContext.isBlank()) {
            sb.append("[추가 요청사항]\n").append(additionalContext).append("\n\n");
        }

        sb.append("답변은 반드시 다음 Markdown 헤더 항목 구조를 갖춰 한글로 작성해 주세요:\n");
        sb.append("### 📌 한 줄 요약\n(핵심 결론 요약)\n\n");
        sb.append("### 🔍 원인 분석\n(사용자 수준 ").append(userLevel).append("에 맞춘 맞춤형 해설)\n\n");
        sb.append("### 💡 추천 조치 및 수정 코드\n(개선 방법 및 Playwright 코드 예시)\n\n");
        sb.append("### 🛡️ 예방 팁\n(향후 재발 방지 팁)\n");

        return sb.toString();
    }

    /**
     * 호출 실패는 그대로 드러낸다 — 예전처럼 가짜 예시 답변을 돌려주면
     * 사용자가 사실이 아닌 분석을 진짜 결과로 믿게 된다.
     */
    private String callLlm(AiModelProvider provider, String systemPrompt, List<LlmMessage> messages) {
        try {
            return llmGatewayService.chat(provider, systemPrompt, messages, "실패 분석", null);
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(502, "AI 호출 실패: " + e.getMessage());
        }
    }

    private AiAnalysisResponse parseAiResponse(String rawText, String userLevel) {
        String summary = "";
        String detailed = "";
        String codeFix = "";
        String prevention = "";

        if (rawText.contains("### 📌 한 줄 요약")) {
            String[] parts = rawText.split("### ");
            for (String part : parts) {
                if (part.startsWith("📌 한 줄 요약")) {
                    summary = part.replace("📌 한 줄 요약", "").trim();
                } else if (part.startsWith("🔍 원인 분석")) {
                    detailed = part.replace("🔍 원인 분석", "").trim();
                } else if (part.startsWith("💡 추천 조치 및 수정 코드")) {
                    codeFix = part.replace("💡 추천 조치 및 수정 코드", "").trim();
                } else if (part.startsWith("🛡️ 예방 팁")) {
                    prevention = part.replace("🛡️ 예방 팁", "").trim();
                }
            }
        } else {
            summary = "E2E 테스트 실행 결과 AI 분석 완료";
            detailed = rawText;
        }

        return new AiAnalysisResponse(summary, detailed, codeFix, prevention, userLevel, rawText);
    }
}
