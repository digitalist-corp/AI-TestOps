package com.playops.api.service;

import com.playops.api.dto.AiChatAction;
import com.playops.api.dto.ExecutionDetailResponse;
import com.playops.api.dto.ExecutionResponse;
import com.playops.api.entity.AiJob;
import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolResult;
import com.playops.api.llm.LlmToolSpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 채팅 중인 AI가 쓸 수 있는 도구 모음.
 *
 * 설계 원칙 하나: <b>파일을 직접 고치는 도구는 두지 않는다.</b>
 * 수정 요청은 모두 AI 작업(AiJob)을 만들어 NEEDS_REVIEW 상태로 세워 두고,
 * 실제 반영은 사람이 "AI 검토" 화면에서 승인해야 일어난다. 테스트 실행도 마찬가지로
 * 곧바로 돌리지 않고 사용자에게 실행 버튼을 보여주는 데까지만 한다.
 * 모델이 잘못 판단해도 사람이 보기 전에는 아무것도 바뀌지 않게 하려는 것이다.
 *
 * 설계 원칙 둘: <b>도구는 호출하는 쪽이 누구인지 몰라야 한다.</b>
 * 지금은 채팅 패널만 부르지만, 개선안의 LangGraph 파이프라인이 붙으면 프로세스 밖에서도
 * 같은 도구를 부르게 된다. 그래서 모든 도구가 projectId 를 인자로 받을 수 있고,
 * 채팅처럼 "지금 열어 둔 프로젝트"가 있는 경우에만 그 값을 기본값으로 쓴다.
 * 도구 정의(LlmToolSpec)와 실행(execute)이 분리돼 있어, MCP 서버를 얹을 때는
 * tools/list 와 tools/call 에 각각 그대로 연결하면 된다.
 */
@Service
public class AiChatToolService {

    private static final Logger log = LoggerFactory.getLogger(AiChatToolService.class);

    /** 도구 결과로 모델에게 돌려줄 텍스트 상한. 로그 전문을 그대로 넣으면 컨텍스트가 터진다. */
    private static final int MAX_RESULT_CHARS = 6000;

    private final FileStorageService fileStorageService;
    private final ExecutionQueryService executionQueryService;
    private final AiJobService aiJobService;

    public AiChatToolService(
            FileStorageService fileStorageService,
            ExecutionQueryService executionQueryService,
            AiJobService aiJobService
    ) {
        this.fileStorageService = fileStorageService;
        this.executionQueryService = executionQueryService;
        this.aiJobService = aiJobService;
    }

    /** 도구를 실행하며 쌓인 부수 효과(만들어진 작업, 사용자에게 낼 제안)를 모으는 그릇. */
    public static class ToolContext {
        private final String projectId;
        private final Long userId;
        private final Long recentExecutionId;
        private final List<AiChatAction> actions = new ArrayList<>();

        public ToolContext(String projectId, Long userId, Long recentExecutionId) {
            this.projectId = projectId;
            this.userId = userId;
            this.recentExecutionId = recentExecutionId;
        }

        public List<AiChatAction> actions() {
            return actions;
        }

        public boolean hasProject() {
            return projectId != null && !projectId.isBlank();
        }

        /**
         * 이번 도구 호출이 대상으로 삼을 프로젝트.
         *
         * 인자로 넘어온 값이 우선이고, 없으면 대화 중인 프로젝트를 쓴다.
         * 둘 다 없으면 어느 프로젝트인지 알 수 없으므로 실패를 분명히 알린다.
         */
        String projectIdFor(LlmToolCall call) {
            String explicit = call.arg("projectId");
            if (explicit != null) {
                return explicit;
            }
            if (hasProject()) {
                return projectId;
            }
            throw new ApiException(400, "projectId 를 알 수 없습니다. 인자로 프로젝트를 지정하세요.");
        }
    }

    /** 프로젝트를 대상으로 하는 도구라면 모두 갖는 공통 인자. */
    private static Map<String, Object> withProjectId(Map<String, Object> properties) {
        Map<String, Object> merged = new java.util.LinkedHashMap<>(properties);
        merged.put("projectId", LlmToolSpec.string(
                "대상 프로젝트 id. 대화 중인 프로젝트가 있으면 생략해도 된다."));
        return merged;
    }

    /**
     * 모델에게 알려줄 도구 목록.
     * 프로젝트를 열지 않은 화면에서는 대상이 없으므로 도구를 주지 않는다.
     */
    public List<LlmToolSpec> toolsFor(ToolContext context) {
        if (!context.hasProject()) {
            // 프로젝트를 열지 않은 화면에서는 대상이 없어 도구를 줘도 부를 수가 없다.
            // (외부 오케스트레이터는 projectId 를 인자로 넘기므로 catalog() 를 쓴다.)
            return List.of();
        }
        return catalog();
    }

    /**
     * 호출자와 무관한 전체 도구 목록.
     *
     * 채팅은 여기에 대화 중인 프로젝트를 기본값으로 얹어 쓰고, 프로세스 밖 호출자는
     * projectId 를 인자로 넘겨 그대로 쓴다. MCP 서버의 tools/list 가 그대로 이 목록이다.
     */
    public List<LlmToolSpec> catalog() {
        return List.of(
                new LlmToolSpec(
                        "list_files",
                        "프로젝트에 있는 파일 목록을 본다. 어떤 spec 파일이 있는지, 폴더 구조가 어떤지 확인할 때 쓴다.",
                        LlmToolSpec.schema(withProjectId(Map.of()))
                ),
                new LlmToolSpec(
                        "read_file",
                        "프로젝트 안의 파일 내용을 읽는다. 테스트 코드를 고치기 전에 반드시 먼저 읽어 현재 내용을 확인한다.",
                        LlmToolSpec.schema(
                                withProjectId(Map.of(
                                        "path", LlmToolSpec.string("프로젝트 기준 상대 경로. 예: tests/login.spec.ts"))),
                                "path")
                ),
                new LlmToolSpec(
                        "list_executions",
                        "프로젝트의 최근 테스트 실행 목록을 본다. 언제 무엇이 실패했는지 훑을 때 쓴다.",
                        LlmToolSpec.schema(withProjectId(Map.of()))
                ),
                new LlmToolSpec(
                        "get_execution_detail",
                        "특정 실행의 상세 결과와 로그를 읽는다. 실패 원인을 짚을 때 쓴다.",
                        LlmToolSpec.schema(
                                Map.of("executionId", LlmToolSpec.integer("실행 ID")),
                                "executionId")
                ),
                new LlmToolSpec(
                        "fix_test",
                        "기존 테스트 코드 수정을 요청한다. 코드가 곧바로 바뀌지는 않고 'AI 검토' 목록에 올라가 "
                                + "사람이 승인해야 반영된다. 무엇을 왜 고쳐야 하는지 instruction 에 구체적으로 적는다.",
                        LlmToolSpec.schema(
                                withProjectId(Map.of(
                                        "specPath", LlmToolSpec.string("고칠 파일 경로. 예: tests/login.spec.ts"),
                                        "instruction", LlmToolSpec.string("무엇을 어떻게 고쳐야 하는지에 대한 구체적인 지시")
                                )),
                                "specPath", "instruction")
                ),
                new LlmToolSpec(
                        "generate_scenario",
                        "새 테스트 시나리오 파일 생성을 요청한다. 역시 'AI 검토'에서 승인해야 프로젝트에 추가된다. "
                                + "경로는 반드시 tests/ 아래의 .spec.ts 여야 Playwright 가 인식한다.",
                        LlmToolSpec.schema(
                                withProjectId(Map.of(
                                        "specPath", LlmToolSpec.string("새로 만들 파일 경로. 예: tests/checkout.spec.ts"),
                                        "instruction", LlmToolSpec.string("어떤 시나리오를 만들지에 대한 설명")
                                )),
                                "specPath", "instruction")
                ),
                new LlmToolSpec(
                        "propose_test_run",
                        "테스트를 돌려보자고 사용자에게 제안한다. 이 도구는 테스트를 직접 실행하지 않고 "
                                + "화면에 실행 버튼만 띄운다. 실행 여부는 사용자가 정한다.",
                        LlmToolSpec.schema(
                                withProjectId(Map.of(
                                        "specPath", LlmToolSpec.string("실행할 파일 경로. 비우면 전체 실행"),
                                        "reason", LlmToolSpec.string("왜 지금 돌려봐야 하는지 한 줄 설명")
                                )))
                ),
                new LlmToolSpec(
                        "get_job_status",
                        "앞서 만든 AI 작업이 지금 어떤 상태인지 확인한다. 사용자가 '아까 그거 됐어?' 라고 물을 때 쓴다. "
                                + "승인 대기 중이면 사용자가 아직 승인하지 않았다는 뜻이다.",
                        LlmToolSpec.schema(
                                Map.of("jobId", LlmToolSpec.integer("확인할 AI 작업 ID")),
                                "jobId")
                )
        );
    }

    /** 모델이 요청한 도구를 실제로 실행한다. 실패는 숨기지 않고 모델에게 그대로 알린다. */
    public LlmToolResult execute(LlmToolCall call, ToolContext context) {
        try {
            return LlmToolResult.ok(call.id(), dispatch(call, context));
        } catch (Exception e) {
            log.warn("채팅 도구 실행 실패 [{}]: {}", call.name(), e.getMessage());
            return LlmToolResult.failed(call.id(), "도구 실행 실패: " + e.getMessage());
        }
    }

    private String dispatch(LlmToolCall call, ToolContext context) {
        return switch (call.name()) {
            case "list_files" -> listFiles(call, context);
            case "read_file" -> readFile(call, context);
            case "list_executions" -> listExecutions(call, context);
            case "get_execution_detail" -> executionDetail(call);
            case "fix_test" -> fixTest(call, context);
            case "generate_scenario" -> generateScenario(call, context);
            case "propose_test_run" -> proposeTestRun(call, context);
            case "get_job_status" -> jobStatus(call);
            default -> "알 수 없는 도구입니다: " + call.name();
        };
    }

    private String listFiles(LlmToolCall call, ToolContext context) {
        List<String> files = fileStorageService.listFiles(context.projectIdFor(call));
        if (files.isEmpty()) {
            return "프로젝트에 파일이 없습니다. 아직 초기화되지 않았을 수 있습니다.";
        }
        return truncate(String.join("\n", files));
    }

    private String readFile(LlmToolCall call, ToolContext context) {
        String path = call.arg("path");
        if (path == null) {
            return "path 인자가 필요합니다.";
        }
        return truncate(fileStorageService.readFile(context.projectIdFor(call), path));
    }

    private String listExecutions(LlmToolCall call, ToolContext context) {
        List<ExecutionResponse> executions =
                executionQueryService.listByProject(context.projectIdFor(call));
        if (executions.isEmpty()) {
            return "아직 실행 기록이 없습니다.";
        }
        StringBuilder sb = new StringBuilder();
        int shown = 0;
        for (ExecutionResponse execution : executions) {
            if (shown++ >= 10) break;
            sb.append("실행 #").append(execution.id())
              .append(" | 상태 ").append(execution.status())
              .append(" | 통과 ").append(execution.passedTests())
              .append(" / 실패 ").append(execution.failedTests())
              .append(" | 대상 ").append(execution.specPath() == null ? "전체" : execution.specPath())
              .append('\n');
        }
        return sb.toString();
    }

    private String executionDetail(LlmToolCall call) {
        long executionId = call.argLong("executionId", -1);
        if (executionId < 0) {
            return "executionId 인자가 필요합니다.";
        }
        ExecutionDetailResponse detail = executionQueryService.getDetail(executionId);
        StringBuilder sb = new StringBuilder();
        ExecutionResponse execution = detail.execution();
        sb.append("실행 #").append(execution.id()).append(" 상태 ").append(execution.status())
          .append(" | 통과 ").append(execution.passedTests())
          .append(" / 실패 ").append(execution.failedTests()).append('\n');

        if (detail.caseResults() != null) {
            for (var caseResult : detail.caseResults()) {
                String status = String.valueOf(caseResult.status());
                if (status.equals("FAILED") || status.equals("ERROR")) {
                    sb.append("실패: ").append(caseResult.caseTitle())
                      .append(" (").append(caseResult.specPath()).append(")\n");
                    if (caseResult.errorMessage() != null) {
                        sb.append("  ").append(caseResult.errorMessage()).append('\n');
                    }
                }
            }
        }
        if (detail.logOutput() != null && !detail.logOutput().isBlank()) {
            sb.append("\n[로그]\n").append(detail.logOutput());
        }
        return truncate(sb.toString());
    }

    private String fixTest(LlmToolCall call, ToolContext context) {
        String specPath = call.arg("specPath");
        String instruction = call.arg("instruction");
        if (specPath == null || instruction == null) {
            return "specPath 와 instruction 이 모두 필요합니다.";
        }
        String projectId = context.projectIdFor(call);
        AiJob job = aiJobService.createCodeFixJob(
                projectId, context.recentExecutionId, specPath, instruction, context.userId);
        context.actions.add(AiChatAction.created(
                "FIX_TEST", specPath + " 수정 요청", summarize(instruction), job.getId(), projectId, specPath));
        return "AI 작업 #" + job.getId() + " 을 만들었습니다. 상태는 '검토 대기'이며, "
                + "사용자가 'AI 검토' 화면에서 승인해야 실제 파일에 반영됩니다. "
                + "사용자에게 이 사실과 승인이 필요하다는 점을 알려주세요.";
    }

    private String generateScenario(LlmToolCall call, ToolContext context) {
        String specPath = normalizeSpecPath(call.arg("specPath"));
        String instruction = call.arg("instruction");
        if (specPath == null || instruction == null) {
            return "specPath 와 instruction 이 모두 필요합니다.";
        }
        String projectId = context.projectIdFor(call);
        AiJob job = aiJobService.createTemplateGenerateJob(
                projectId, specPath, instruction, context.userId);
        context.actions.add(AiChatAction.created(
                "GENERATE_SCENARIO", specPath + " 생성 요청", summarize(instruction), job.getId(),
                projectId, specPath));
        return "AI 작업 #" + job.getId() + " 을 만들었습니다. 생성 경로는 " + specPath + " 이고, "
                + "'AI 검토' 화면에서 승인해야 프로젝트에 추가됩니다.";
    }

    private String proposeTestRun(LlmToolCall call, ToolContext context) {
        String specPath = call.arg("specPath");
        String reason = call.arg("reason");
        String label = specPath == null ? "전체 테스트 실행" : specPath + " 실행";
        context.actions.add(AiChatAction.proposed(
                label, reason == null ? "" : reason, context.projectIdFor(call), specPath, null));
        return "사용자 화면에 '" + label + "' 버튼을 띄웠습니다. 테스트는 아직 돌지 않았습니다. "
                + "사용자가 버튼을 눌러야 실행됩니다.";
    }

    private String jobStatus(LlmToolCall call) {
        long jobId = call.argLong("jobId", -1);
        if (jobId < 0) {
            return "jobId 인자가 필요합니다.";
        }
        AiJob job = aiJobService.getJob(jobId);
        StringBuilder sb = new StringBuilder();
        sb.append("AI 작업 #").append(job.getId())
          .append(" | 종류 ").append(job.getJobType())
          .append(" | 상태 ").append(job.getStatus()).append('\n');
        sb.append("대상: ").append(job.getTargetSpecPath()).append('\n');
        if (job.getSummary() != null && !job.getSummary().isBlank()) {
            sb.append("요약: ").append(job.getSummary()).append('\n');
        }
        if (job.getErrorMessage() != null && !job.getErrorMessage().isBlank()) {
            sb.append("오류: ").append(job.getErrorMessage()).append('\n');
        }
        sb.append(switch (job.getStatus()) {
            case NEEDS_REVIEW, DIFF_READY -> "→ 사용자의 승인을 기다리는 중입니다. 아직 파일은 바뀌지 않았습니다.";
            case PENDING, RUNNING -> "→ 아직 작업 중입니다.";
            case APPLIED -> "→ 승인되어 파일에 반영되었습니다.";
            case REJECTED -> "→ 사용자가 거부했습니다. 반영되지 않았습니다.";
            default -> "→ 종료된 작업입니다.";
        });
        return sb.toString();
    }

    /**
     * Playwright 는 testDir(./tests) 안의 *.spec.ts 만 테스트로 수집한다.
     * 모델이 경로를 대충 주더라도 실제로 실행될 수 있는 자리에 놓이도록 맞춰 준다.
     */
    static String normalizeSpecPath(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String path = raw.trim().replace('\\', '/');
        while (path.startsWith("/") || path.startsWith("./")) {
            path = path.startsWith("/") ? path.substring(1) : path.substring(2);
        }
        if (!path.endsWith(".spec.ts") && !path.endsWith(".spec.js")
                && !path.endsWith(".test.ts") && !path.endsWith(".test.js")) {
            path = path.replaceAll("\\.(ts|js)$", "") + ".spec.ts";
        }
        if (!path.startsWith("tests/")) {
            path = "tests/" + path;
        }
        return path;
    }

    /**
     * 카드에 실을 한 줄 설명.
     *
     * 모델이 AI 작업에 넘기는 지시문은 수천 자에 이르는 상세 명세라, 그대로 카드에 넣으면
     * 화면이 글로 덮인다. 전문은 'AI 검토' 화면에서 볼 수 있으므로 여기서는 앞부분만 보여준다.
     */
    private String summarize(String instruction) {
        if (instruction == null) {
            return "";
        }
        String oneLine = instruction.replaceAll("\\s+", " ").trim();
        return oneLine.length() <= 160 ? oneLine : oneLine.substring(0, 160) + "…";
    }

    private String truncate(String text) {
        if (text == null) {
            return "";
        }
        if (text.length() <= MAX_RESULT_CHARS) {
            return text;
        }
        return text.substring(0, MAX_RESULT_CHARS) + "\n... (이후 생략)";
    }
}
