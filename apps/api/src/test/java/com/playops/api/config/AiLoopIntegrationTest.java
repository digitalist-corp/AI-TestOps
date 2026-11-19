package com.playops.api.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.entity.AiJob;
import com.playops.api.entity.AiJobStatus;
import com.playops.api.entity.AiJobType;
import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.repository.AiJobRepository;
import com.playops.api.repository.ExecutionCaseResultRepository;
import com.playops.api.repository.ExecutionRepository;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * E-06 · E-07 Spring 쪽: 루프 작업을 만들어 ai-service 에 넘기고, 그래프가 MCP 로 자식 수정 작업을 띄우며,
 * 자식이 바뀌면 재개를 전달한다. ai-service 는 가짜 HTTP 서버로 대신한다.
 */
@SpringBootTest(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:loop;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "playops.docker-enabled=false",
        "playops.projects-root=build/tmp/loop-projects",
        "playops.storage-root=build/tmp/loop-storage",
        "LOGIN_USERNAME=admin",
        "LOGIN_PASSWORD=admin-test-pass-1"
})
@AutoConfigureMockMvc
class AiLoopIntegrationTest {

    record Received(String path, JsonNode body) {}

    static final BlockingQueue<Received> RECEIVED = new LinkedBlockingQueue<>();
    static volatile boolean healthy = true;
    static volatile String resumeReply = "{\"done\":false,\"round\":1,\"steps\":[]}";
    static final HttpServer AI_SERVICE = fakeAiService();

    static HttpServer fakeAiService() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            ObjectMapper mapper = new ObjectMapper();
            server.createContext("/", exchange -> {
                String path = exchange.getRequestURI().getPath();
                byte[] in = exchange.getRequestBody().readAllBytes();
                String reply;
                int status = 200;
                if (path.equals("/health")) {
                    status = healthy ? 200 : 500;
                    reply = "{\"status\":\"UP\"}";
                } else {
                    RECEIVED.add(new Received(path, mapper.readTree(in)));
                    reply = path.endsWith("/resume") ? resumeReply
                            : "{\"done\":false,\"round\":1,\"steps\":[\"분류: 스크립트 오류 · 과거 수정 0건 참고\"]}";
                }
                byte[] out = reply.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(status, out.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(out);
                }
            });
            server.start();
            return server;
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @DynamicPropertySource
    static void aiServiceUrl(DynamicPropertyRegistry registry) {
        registry.add("AI_SERVICE_URL", () -> "http://127.0.0.1:" + AI_SERVICE.getAddress().getPort());
    }

    @AfterAll
    static void stop() {
        AI_SERVICE.stop(0);
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired AiJobRepository aiJobs;
    @Autowired ExecutionRepository executions;
    @Autowired ExecutionCaseResultRepository results;

    private static int signups;
    private String admin;
    private String member;

    @BeforeEach
    void setUp() throws Exception {
        healthy = true;
        RECEIVED.clear();
        admin = call(post("/api/auth/login").content("{\"username\":\"admin\",\"password\":\"admin-test-pass-1\"}"), null)
                .get("token").asText();
        String name = "l" + UUID.randomUUID().toString().substring(0, 8);
        JsonNode signup = call(post("/api/auth/signup").header("X-Forwarded-For", "10.8.0." + (++signups))
                .content("{\"username\":\"" + name + "\",\"name\":\"팀원\",\"password\":\"password123\"}"), null);
        member = signup.get("token").asText();
        call(post("/api/projects/example.com/members")
                .content("{\"userId\":" + signup.get("user").get("id").asLong() + ",\"role\":\"MEMBER\"}"), admin);
    }

    private JsonNode call(MockHttpServletRequestBuilder req, String token) throws Exception {
        MockHttpServletResponse res = send(req, token);
        assertThat(res.getStatus()).as(res.getContentAsString(StandardCharsets.UTF_8)).isEqualTo(200);
        String body = res.getContentAsString(StandardCharsets.UTF_8);
        return body.isBlank() ? null : json.readTree(body);
    }

    private MockHttpServletResponse send(MockHttpServletRequestBuilder req, String token) throws Exception {
        req.contentType(MediaType.APPLICATION_JSON);
        if (token != null) req.header("Authorization", "Bearer " + token);
        return mvc.perform(req).andReturn().getResponse();
    }

    private Long failedRun(String projectId) {
        Execution e = new Execution();
        e.setProjectId(projectId);
        e.setStatus(ExecutionStatus.FAILED);
        Long id = executions.save(e).getId();
        ExecutionCaseResult r = new ExecutionCaseResult();
        r.setExecutionId(id);
        r.setSpecPath("demo.spec.ts");
        r.setCaseTitle("문의하기 링크가 보인다");
        r.setStatus("FAILED");
        r.setErrorMessage("Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('link', { name: '문의하기' })\n"
                + "Expected: visible\nTimeout: 5000ms\nError: element(s) not found");
        results.save(r);
        return id;
    }

    private AiJob loop(Long executionId) {
        AiJob job = new AiJob();
        job.setProjectId("example.com");
        job.setJobType(AiJobType.LEARNING_LOOP);
        job.setStatus(AiJobStatus.RUNNING);
        job.setFailedExecutionId(executionId);
        job.setCallbackToken(UUID.randomUUID().toString());
        job.setCallbackTokenExpiresAt(Instant.now().plusSeconds(600));
        return aiJobs.save(job);
    }

    private JsonNode mcp(AiJob job, String method, String params) throws Exception {
        MockHttpServletResponse res = mvc.perform(post("/internal/ai-jobs/" + job.getId() + "/mcp")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", "Bearer " + job.getCallbackToken())
                .content("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"" + method + "\",\"params\":" + params + "}"))
                .andReturn().getResponse();
        assertThat(res.getStatus()).isEqualTo(200);
        return json.readTree(res.getContentAsString(StandardCharsets.UTF_8)).get("result");
    }

    @Test
    void startHandsTheLoopToAiServiceAndRecordsItsSteps() throws Exception {
        assertThat(call(get("/api/ai-loop/status"), member).get("available").asBoolean()).isTrue();
        Long run = failedRun("example.com");

        JsonNode loop = call(post("/api/projects/example.com/executions/" + run + "/ai-loop"), admin);

        assertThat(loop.get("jobType").asText()).isEqualTo("LEARNING_LOOP");
        assertThat(loop.get("status").asText()).isEqualTo("RUNNING");
        assertThat(loop.get("summary").asText()).contains("과거 수정 0건 참고");
        Received started = RECEIVED.poll(5, TimeUnit.SECONDS);
        assertThat(started.path()).isEqualTo("/loops");
        assertThat(started.body().get("jobId").asLong()).isEqualTo(loop.get("id").asLong());
        assertThat(started.body().get("executionId").asLong()).isEqualTo(run);
        AiJob saved = aiJobs.findById(loop.get("id").asLong()).orElseThrow();
        assertThat(started.body().get("token").asText()).isEqualTo(saved.getCallbackToken());

        // 같은 실행에 루프가 돌고 있으면 또 시작하지 않는다
        assertThat(send(post("/api/projects/example.com/executions/" + run + "/ai-loop"), admin).getStatus()).isEqualTo(409);
    }

    @Test
    void offWhenAiServiceIsDownAndPmOnly() throws Exception {
        Long run = failedRun("example.com");
        assertThat(send(post("/api/projects/example.com/executions/" + run + "/ai-loop"), member).getStatus()).isEqualTo(403);
        Long theirs = failedRun("google.com");
        assertThat(send(post("/api/projects/example.com/executions/" + theirs + "/ai-loop"), admin).getStatus()).isEqualTo(404);

        healthy = false;
        assertThat(call(get("/api/ai-loop/status"), admin).get("available").asBoolean()).isFalse();
        long before = aiJobs.count();
        assertThat(send(post("/api/projects/example.com/executions/" + run + "/ai-loop"), admin).getStatus()).isEqualTo(503);
        assertThat(aiJobs.count()).isEqualTo(before);
    }

    @Test
    void graphStartsASupervisedFixAndChildChangesResumeTheLoop() throws Exception {
        Long run = failedRun("example.com");
        AiJob loop = loop(run);
        resumeReply = "{\"done\":true,\"outcome\":\"STOPPED\",\"round\":1,\"steps\":[\"분류: 스크립트 오류\",\"정지: 수정 실패\"]}";

        JsonNode tools = mcp(loop, "tools/list", "{}").get("tools");
        assertThat(tools.findValuesAsText("name")).contains("start_code_fix", "list_failure_clusters");
        JsonNode result = mcp(loop, "tools/call", "{\"name\":\"start_code_fix\",\"arguments\":{\"executionId\":" + run
                + ",\"specPath\":\"demo.spec.ts\",\"instruction\":\"링크 이름을 고쳐 주세요\"}}");
        assertThat(result.get("isError").asBoolean()).as(result.toString()).isFalse();
        long childId = json.readTree(result.get("content").get(0).get("text").asText()).get("jobId").asLong();

        AiJob child = aiJobs.findById(childId).orElseThrow();
        assertThat(child.getJobType()).isEqualTo(AiJobType.CODE_FIX);
        assertThat(child.getParentJobId()).isEqualTo(loop.getId());
        assertThat(child.isAutoCreated()).as("사람 승인 없이 반영되지 않게").isTrue();
        assertThat(child.getInstruction()).isEqualTo("링크 이름을 고쳐 주세요");
        assertThat(child.getFailedExecutionId()).isEqualTo(run);

        // 러너가 없어(docker 꺼짐) 자식은 오류로 끝난다 → 그 상태로 재개를 넘긴다
        Received resumed = RECEIVED.poll(10, TimeUnit.SECONDS);
        assertThat(resumed).isNotNull();
        assertThat(resumed.path()).isEqualTo("/loops/" + loop.getId() + "/resume");
        assertThat(resumed.body().get("token").asText()).isEqualTo(loop.getCallbackToken());
        assertThat(resumed.body().get("child").get("jobId").asLong()).isEqualTo(childId);
        assertThat(resumed.body().get("child").get("status").asText()).isIn("ERROR", "FAILED");

        AiJob after = null;
        for (int i = 0; i < 50; i++) {
            after = aiJobs.findById(loop.getId()).orElseThrow();
            if (after.getStatus() != AiJobStatus.RUNNING) break;
            Thread.sleep(100);
        }
        assertThat(after.getStatus()).isEqualTo(AiJobStatus.FAILED);
        assertThat(after.getSummary()).isEqualTo("분류: 스크립트 오류\n정지: 수정 실패");
    }

    @Test
    void startCodeFixOnlyForLoopJobsAndTheirProject() throws Exception {
        AiJob loop = loop(failedRun("example.com"));
        Long theirs = failedRun("google.com");
        JsonNode other = mcp(loop, "tools/call", "{\"name\":\"start_code_fix\",\"arguments\":{\"executionId\":" + theirs
                + ",\"specPath\":\"demo.spec.ts\",\"instruction\":\"x\"}}");
        assertThat(other.get("isError").asBoolean()).isTrue();
        assertThat(aiJobs.findAll()).noneMatch(j -> loop.getId().equals(j.getParentJobId()));
        assertThat(List.of(AiJobType.values()).indexOf(AiJobType.CODE_FIX)).as("기존 테스트가 values()[0] 을 씀").isZero();
    }
}
