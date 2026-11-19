package com.playops.api.controller;

import com.playops.api.chat.ChatTool;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ChatToolRegistry;
import com.playops.api.chat.ToolTier;
import com.playops.api.entity.AiJob;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.service.AiJobService;
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

    private final AiJobService aiJobService;
    private final ChatToolRegistry registry;

    public McpController(AiJobService aiJobService, ChatToolRegistry registry) {
        this.aiJobService = aiJobService;
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
            case "tools/list" -> result(id, Map.of("tools", exported().stream().map(tool -> Map.of(
                    "name", tool.spec().name(),
                    "description", tool.spec().description(),
                    "inputSchema", withoutProjectId(tool.spec().inputSchema()))).toList()));
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

    @SuppressWarnings("unchecked")
    private ResponseEntity<Map<String, Object>> call(AiJob job, Object id, Map<String, Object> params) {
        String name = String.valueOf(params.get("name"));
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
