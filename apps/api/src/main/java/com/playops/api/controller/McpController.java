package com.playops.api.controller;

import com.playops.api.chat.ChatTool;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ChatToolRegistry;
import com.playops.api.chat.ToolTier;
import com.playops.api.entity.AiJob;
import com.playops.api.entity.AiJobType;
import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.service.AiJobService;
import com.playops.api.service.AiLoopService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * E-02: ai-service(LangGraph)가 Spring 도구를 MCP 로 부르는 입구. 도구 정의는 ChatToolRegistry 한 곳이다.
 *
 * MCP Java SDK 대신 initialize · tools/list · tools/call 만 받는 무상태 JSON-RPC (docs/langgraph-placement-decision.md).
 * 인증은 사용자 로그인이 아니라 그 AI 작업의 콜백 토큰이고(/internal/**), 도구는 그 작업의 프로젝트 안에서만 돈다.
 * 허용 목록의 읽기 도구만 내보낸다 — 파일을 쓰는 도구는 없다(반영은 AiJobService.applyDiff 한 곳).
 */
@RestController
@RequestMapping("/internal/ai-jobs/{jobId}/mcp")
public class McpController {

    /** 실행 번호를 받는 도구는 다른 프로젝트 실행을 볼 수 있어(#158) 소속 확인을 붙인 뒤에 넣는다. */
    public static final Set<String> ALLOWED = Set.of("list_executions", "get_sitemap", "list_failure_clusters");
    private static final String DEFAULT_PROTOCOL_VERSION = "2025-06-18";

    /**
     * 학습 루프 작업에만 보이는 도구. 파일을 쓰지 않는다 — 러너가 사본에서 고친 diff 를 만들고, 반영은 사람이 승인해야 한다.
     * 루프 작업 id 를 알아야 해서 채팅 도구 목록이 아니라 여기 둔다.
     */
    static final String START_CODE_FIX = "start_code_fix";
    private static final com.fasterxml.jackson.databind.ObjectMapper JSON = new com.fasterxml.jackson.databind.ObjectMapper();
    private static final Map<String, Object> START_CODE_FIX_SPEC = Map.of(
            "name", START_CODE_FIX,
            "description", "실패한 실행의 spec 하나를 AI 수정 러너로 고친다. 러너는 격리된 사본에서 고치고 다시 돌려 통과한 diff 만 내며, "
                    + "반영은 사람이 승인해야 한다. 돌려주는 jobId 의 상태 변화로 루프가 재개된다.",
            "inputSchema", Map.of(
                    "type", "object",
                    "properties", Map.of(
                            "executionId", Map.of("type", "integer", "description", "실패한 실행 번호 (이 작업의 프로젝트 것)"),
                            "specPath", Map.of("type", "string", "description", "고칠 spec 경로 (리포트 경로 그대로 가능)"),
                            "instruction", Map.of("type", "string", "description", "러너에게 줄 지시문 (과거 수정 예시 포함)")),
                    "required", List.of("executionId", "specPath", "instruction")));

    private final AiJobService aiJobService;
    private final AiLoopService aiLoopService;
    private final ChatToolRegistry registry;

    public McpController(AiJobService aiJobService, AiLoopService aiLoopService, ChatToolRegistry registry) {
        this.aiJobService = aiJobService;
        this.aiLoopService = aiLoopService;
        this.registry = registry;
    }

    @PostMapping
    @SuppressWarnings("unchecked")
    public ResponseEntity<Map<String, Object>> handle(@PathVariable Long jobId, @RequestBody Map<String, Object> body,
                                                      HttpServletRequest request) {
        AiJob job = aiJobService.validateCallbackToken(jobId, bearer(request));
        Object id = body.get("id");
        if (id == null) {
            // 알림(notifications/initialized 등)은 응답 본문이 없다
            return ResponseEntity.accepted().build();
        }
        Map<String, Object> params = body.get("params") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
        String method = String.valueOf(body.get("method"));
        return switch (method) {
            case "initialize" -> result(id, Map.of(
                    "protocolVersion", params.getOrDefault("protocolVersion", DEFAULT_PROTOCOL_VERSION),
                    "capabilities", Map.of("tools", Map.of()),
                    "serverInfo", Map.of("name", "ai-testops", "version", "1")));
            case "ping" -> result(id, Map.of());
            case "tools/list" -> result(id, Map.of("tools", toolList(job)));
            case "tools/call" -> call(job, id, params);
            default -> error(id, -32601, "지원하지 않는 메서드: " + method);
        };
    }

    /** 무상태라 SSE 스트림(GET) · 세션 종료(DELETE)는 없다. 클라이언트는 405 를 보고 POST 만 쓴다. */
    @RequestMapping(method = {RequestMethod.GET, RequestMethod.DELETE})
    public ResponseEntity<Void> notAllowed() {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED).build();
    }

    private List<ChatTool> exported() {
        return registry.all().stream()
                .filter(tool -> ALLOWED.contains(tool.spec().name()) && tool.tier() == ToolTier.READ)
                .toList();
    }

    private List<Map<String, Object>> toolList(AiJob job) {
        List<Map<String, Object>> tools = new java.util.ArrayList<>(exported().stream().map(tool -> Map.<String, Object>of(
                "name", tool.spec().name(),
                "description", tool.spec().description(),
                "inputSchema", withoutProjectId(tool.spec().inputSchema()))).toList());
        if (job.getJobType() == AiJobType.LEARNING_LOOP) tools.add(START_CODE_FIX_SPEC);
        return tools;
    }

    @SuppressWarnings("unchecked")
    private ResponseEntity<Map<String, Object>> call(AiJob job, Object id, Map<String, Object> params) {
        String name = String.valueOf(params.get("name"));
        if (START_CODE_FIX.equals(name) && job.getJobType() == AiJobType.LEARNING_LOOP) {
            Map<String, Object> args = params.get("arguments") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
            try {
                Object execution = args.get("executionId");
                AiJob child = aiLoopService.startFix(job,
                        execution instanceof Number n ? n.longValue() : execution == null ? null : Long.valueOf(execution.toString()),
                        args.get("specPath") == null ? null : args.get("specPath").toString(),
                        args.get("instruction") == null ? null : args.get("instruction").toString());
                return toolResult(id, JSON.writeValueAsString(Map.of("jobId", child.getId(), "targetSpecPath", child.getTargetSpecPath())), false);
            } catch (ApiException | NumberFormatException | com.fasterxml.jackson.core.JsonProcessingException e) {
                return toolResult(id, "수정을 띄우지 못했습니다: " + e.getMessage(), true);
            }
        }
        ChatTool tool = exported().stream().filter(t -> t.spec().name().equals(name)).findFirst().orElse(null);
        if (tool == null) {
            return error(id, -32602, "쓸 수 없는 도구: " + name);
        }
        Map<String, Object> args = params.get("arguments") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
        LlmToolCall toolCall = new LlmToolCall(String.valueOf(id), name, args);
        // 채팅과 같은 규칙(LlmToolCall.arg): 빈 값은 없음, 앞뒤 공백은 다듬는다
        String projectId = toolCall.arg("projectId");
        if (projectId != null && !job.getProjectId().equals(projectId)) {
            return toolResult(id, "이 작업의 프로젝트(" + job.getProjectId() + ") 밖은 볼 수 없습니다.", true);
        }
        try {
            ChatToolOutput output = tool.execute(toolCall,
                    new ChatToolContext(job.getProjectId(), job.getRequestedBy(), false, null));
            return toolResult(id, output.content(), output.error());
        } catch (RuntimeException e) {
            return toolResult(id, "도구 실행 실패: " + e.getMessage(), true);
        }
    }

    /** 작업이 프로젝트를 고정하므로 모델이 projectId 를 추측해 넣지 않게 스키마에서 뺀다. */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> withoutProjectId(Map<String, Object> schema) {
        Map<String, Object> copy = new LinkedHashMap<>(schema);
        if (copy.get("properties") instanceof Map<?, ?> properties) {
            Map<String, Object> rest = new LinkedHashMap<>((Map<String, Object>) properties);
            rest.remove("projectId");
            copy.put("properties", rest);
        }
        if (copy.get("required") instanceof List<?> required) {
            copy.put("required", required.stream().filter(r -> !"projectId".equals(r)).toList());
        }
        return copy;
    }

    private static ResponseEntity<Map<String, Object>> toolResult(Object id, String text, boolean isError) {
        return result(id, Map.of("content", List.of(Map.of("type", "text", "text", text == null ? "" : text)), "isError", isError));
    }

    private static ResponseEntity<Map<String, Object>> result(Object id, Object result) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("jsonrpc", "2.0");
        body.put("id", id);
        body.put("result", result);
        return ResponseEntity.ok(body);
    }

    private static ResponseEntity<Map<String, Object>> error(Object id, int code, String message) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("jsonrpc", "2.0");
        body.put("id", id);
        body.put("error", Map.of("code", code, "message", message));
        return ResponseEntity.ok(body);
    }

    private static String bearer(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        return header != null && header.startsWith("Bearer ") ? header.substring(7) : null;
    }
}
