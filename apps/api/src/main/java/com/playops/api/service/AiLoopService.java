package com.playops.api.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.entity.AiJob;
import com.playops.api.entity.AiJobStatus;
import com.playops.api.entity.AiJobType;
import com.playops.api.entity.PostApplyVerificationStatus;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.AiJobRepository;
import com.playops.api.repository.ExecutionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.event.TransactionalEventListener;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 학습 루프(E-06 · E-07 · E-09)의 Spring 쪽. 그래프는 ai-service(LangGraph, compose 프로필 ai)에서 돈다.
 * 여기서는 루프 작업을 만들어 넘기고, 그래프가 MCP 로 부르는 수정 작업(CODE_FIX 러너 — 사본에서 고치고 다시 돌려 통과해야 diff 를 냄)을
 * 띄우고, 그 작업이 바뀌면 재개를 넘긴다. 반영은 자식 작업의 기존 승인 경로(AiJobService.approve → applyDiff) 그대로다.
 */
@Service
public class AiLoopService {

    private static final Logger log = LoggerFactory.getLogger(AiLoopService.class);
    /** 러너가 끝났거나 사람이 거부한 상태. APPLIED 는 사후 검증(재실행)이 끝나야 넘긴다 */
    private static final Set<AiJobStatus> SETTLED = EnumSet.of(AiJobStatus.NEEDS_REVIEW, AiJobStatus.REJECTED,
            AiJobStatus.FAILED, AiJobStatus.ERROR, AiJobStatus.TIMEOUT, AiJobStatus.CANCELED);

    private final AiJobRepository aiJobs;
    private final ExecutionRepository executions;
    private final AiJobService aiJobService;
    private final ProjectService projectService;
    private final String baseUrl;
    private final ObjectMapper json = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();

    public AiLoopService(AiJobRepository aiJobs, ExecutionRepository executions, AiJobService aiJobService,
                         ProjectService projectService, @Value("${AI_SERVICE_URL:}") String baseUrl) {
        this.aiJobs = aiJobs;
        this.executions = executions;
        this.aiJobService = aiJobService;
        this.projectService = projectService;
        this.baseUrl = baseUrl.strip().replaceAll("/+$", "");
    }

    /** 프로필 ai 가 꺼져 있으면(주소 없음 · 응답 없음) false — 화면은 버튼 대신 안내를 보인다 */
    public boolean available() {
        if (baseUrl.isEmpty()) return false;
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/health")).timeout(Duration.ofSeconds(2)).GET().build();
            return http.send(request, HttpResponse.BodyHandlers.discarding()).statusCode() == 200;
        } catch (Exception e) {
            return false;
        }
    }

    public AiJob start(String projectId, Long executionId, Long userId) {
        requireExecution(projectId, executionId);
        if (aiJobs.existsByJobTypeAndFailedExecutionIdAndStatus(AiJobType.LEARNING_LOOP, executionId, AiJobStatus.RUNNING)) {
            throw new ApiException(409, "STATE_CONFLICT", "이 실행의 AI 루프가 이미 돌고 있습니다.");
        }
        if (!available()) {
            throw new ApiException(503, "AI_LOOP_UNAVAILABLE", "AI 루프 서비스가 꺼져 있습니다 (compose 프로필 ai).");
        }
        AiJob loop = new AiJob();
        loop.setProjectId(projectId);
        loop.setJobType(AiJobType.LEARNING_LOOP);
        loop.setStatus(AiJobStatus.RUNNING);
        loop.setFailedExecutionId(executionId);
        loop.setInstruction("실행 #" + executionId + " 실패를 AI 루프로 고치기");
        loop.setRequestedBy(userId);
        loop.setCallbackToken(UUID.randomUUID().toString());
        // 루프는 사람 승인을 몇 시간씩 기다릴 수 있다. 그동안 ai-service 가 이 토큰으로 MCP 를 부른다
        loop.setCallbackTokenExpiresAt(Instant.now().plus(24, ChronoUnit.HOURS));
        loop = aiJobs.save(loop);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("jobId", loop.getId());
        body.put("token", loop.getCallbackToken());
        body.put("projectId", projectId);
        body.put("executionId", executionId);
        try {
            return record(loop.getId(), post("/loops", body));
        } catch (Exception e) {
            loop.setStatus(AiJobStatus.ERROR);
            loop.setErrorMessage("AI 루프 서비스에 넘기지 못했습니다: " + e.getMessage());
            aiJobs.save(loop);
            throw new ApiException(503, "AI_LOOP_UNAVAILABLE", "AI 루프 서비스에 넘기지 못했습니다.");
        }
    }

    /** MCP start_code_fix: 그래프가 과거 수정을 넣어 만든 지시문으로 수정 작업을 띄운다. 그 프로젝트 실행만 */
    public AiJob startFix(AiJob loop, Long executionId, String specPath, String instruction) {
        if (loop.getJobType() != AiJobType.LEARNING_LOOP || loop.getStatus() != AiJobStatus.RUNNING) {
            throw new ApiException(409, "STATE_CONFLICT", "돌고 있는 AI 루프만 수정을 띄울 수 있습니다.");
        }
        if (specPath == null || specPath.isBlank() || instruction == null || instruction.isBlank()) {
            throw new ApiException(400, "VALIDATION_ERROR", "specPath 와 instruction 이 필요합니다.");
        }
        requireExecution(loop.getProjectId(), executionId);
        String target = FixProposalService.projectRelative(projectService.getProjectPath(loop.getProjectId()), specPath.strip());
        return aiJobService.createCodeFixJob(loop.getProjectId(), executionId, target, instruction, loop.getRequestedBy(), loop.getId());
    }

    /** 루프가 띄운 수정 작업이 멈출 곳에 오면(검토 대기 · 실패 · 거부 · 재실행 끝) 그 상태로 루프를 재개한다 */
    @Async("aiLoopExecutor")
    @TransactionalEventListener(fallbackExecution = true)
    public void onJobChanged(AiJobChanged change) {
        AiJob child = aiJobs.findById(change.id()).orElse(null);
        if (child == null || child.getParentJobId() == null || !settled(child)) return;
        AiJob loop = aiJobs.findById(child.getParentJobId()).orElse(null);
        if (loop == null || loop.getStatus() != AiJobStatus.RUNNING) return;
        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("jobId", child.getId());
        snapshot.put("status", child.getStatus().name());
        snapshot.put("iterationsUsed", child.getIterationsUsed());
        snapshot.put("reviewedBy", child.getReviewedBy());
        snapshot.put("verificationStatus", child.getPostApplyVerificationStatus() == null ? null : child.getPostApplyVerificationStatus().name());
        snapshot.put("verificationExecutionId", child.getPostApplyVerificationExecutionId());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("token", loop.getCallbackToken());
        body.put("child", snapshot);
        try {
            record(loop.getId(), post("/loops/" + loop.getId() + "/resume", body));
        } catch (Exception e) {
            // ai-service 가 꺼져 있었으면 루프는 체크포인트에 멈춰 있다. 다음 상태 변화나 다시 시작으로 이어진다
            log.warn("AI 루프 {} 재개를 넘기지 못했습니다: {}", loop.getId(), e.getMessage());
        }
    }

    private static boolean settled(AiJob child) {
        if (SETTLED.contains(child.getStatus())) return true;
        PostApplyVerificationStatus verification = child.getPostApplyVerificationStatus();
        return child.getStatus() == AiJobStatus.APPLIED && verification != null && verification != PostApplyVerificationStatus.PENDING;
    }

    /** 그래프가 돌려준 노드 기록(E-10 간이)을 루프 작업에 남긴다. done 이면 결과에 맞는 상태로 닫는다 */
    private AiJob record(Long loopId, JsonNode reply) {
        AiJob loop = aiJobs.findById(loopId).orElseThrow();
        if (reply.path("ignored").asBoolean()) return loop;
        List<String> steps = new ArrayList<>();
        reply.path("steps").forEach(step -> steps.add(step.asText()));
        if (!steps.isEmpty()) loop.setSummary(String.join("\n", steps));
        loop.setIterationsUsed(reply.path("round").asInt(loop.getIterationsUsed()));
        if (reply.path("done").asBoolean()) {
            loop.setStatus(switch (reply.path("outcome").asText()) {
                case "PASSED" -> AiJobStatus.APPLIED;
                case "REJECTED" -> AiJobStatus.CANCELED;
                default -> AiJobStatus.FAILED;
            });
        }
        return aiJobs.save(loop);
    }

    private void requireExecution(String projectId, Long executionId) {
        if (executionId == null || executions.findById(executionId).filter(e -> projectId.equals(e.getProjectId())).isEmpty()) {
            throw new ApiException(404, "실행을 찾을 수 없습니다: " + executionId);
        }
    }

    private JsonNode post(String path, Map<String, Object> body) throws Exception {
        // 그래프가 다음 기다림(interrupt)까지 도는 시간. MCP 호출 몇 번이라 짧다
        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + path))
                .timeout(Duration.ofSeconds(60))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)))
                .build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) throw new IllegalStateException("ai-service " + response.statusCode());
        return json.readTree(response.body());
    }
}
