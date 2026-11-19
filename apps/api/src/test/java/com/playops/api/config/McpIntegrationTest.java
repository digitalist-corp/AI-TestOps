package com.playops.api.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.entity.AiJob;
import com.playops.api.entity.AiJobStatus;
import com.playops.api.entity.AiJobType;
import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.repository.AiJobRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/**
 * E-02: ai-service(LangGraph)가 작업 토큰으로 Spring 도구를 MCP 로 부른다.
 * 허용 목록의 읽기 도구만, 그 작업의 프로젝트 안에서만.
 */
@SpringBootTest(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:mcp;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "playops.docker-enabled=false",
        "playops.projects-root=build/tmp/mcp-projects",
        "playops.storage-root=build/tmp/mcp-storage",
        "LOGIN_USERNAME=admin",
        "LOGIN_PASSWORD=admin-test-pass-1"
})
@AutoConfigureMockMvc
class McpIntegrationTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper json;

    @Autowired
    AiJobRepository aiJobs;

    @Autowired
    com.playops.api.repository.ExecutionRepository executions;

    @Autowired
    com.playops.api.chat.ChatToolRegistry registry;

    private AiJob job(String projectId, Instant expiresAt) {
        AiJob job = new AiJob();
        job.setProjectId(projectId);
        job.setJobType(AiJobType.values()[0]);
        job.setStatus(AiJobStatus.RUNNING);
        job.setCallbackToken(UUID.randomUUID().toString());
        job.setCallbackTokenExpiresAt(expiresAt);
        return aiJobs.save(job);
    }

    private AiJob job() {
        return job("example.com", Instant.now().plusSeconds(600));
    }

    private MockHttpServletResponse send(AiJob job, String token, String body) throws Exception {
        MockHttpServletRequestBuilder req = post("/internal/ai-jobs/" + job.getId() + "/mcp")
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON, MediaType.TEXT_EVENT_STREAM)
                .content(body);
        if (token != null) req.header("Authorization", "Bearer " + token);
        return mvc.perform(req).andReturn().getResponse();
    }

    private JsonNode rpc(AiJob job, String method, String params) throws Exception {
        MockHttpServletResponse res = send(job, job.getCallbackToken(),
                "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"" + method + "\"" + (params == null ? "" : ",\"params\":" + params) + "}");
        String body = res.getContentAsString(StandardCharsets.UTF_8);
        assertThat(res.getStatus()).as(body).isEqualTo(200);
        JsonNode node = json.readTree(body);
        assertThat(node.get("jsonrpc").asText()).isEqualTo("2.0");
        assertThat(node.get("id").asInt()).isEqualTo(7);
        return node;
    }

    @Test
    void rejectsMissingWrongOrExpiredToken() throws Exception {
        AiJob job = job();
        AiJob other = job();
        AiJob expired = job("example.com", Instant.now().minusSeconds(1));
        String body = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}";

        assertThat(send(job, null, body).getStatus()).isEqualTo(401);
        assertThat(send(job, "wrong", body).getStatus()).isEqualTo(401);
        assertThat(send(job, other.getCallbackToken(), body).getStatus()).isEqualTo(401);
        assertThat(send(expired, expired.getCallbackToken(), body).getStatus()).isEqualTo(401);
    }

    @Test
    void initializeEchoesProtocolVersion() throws Exception {
        JsonNode result = rpc(job(), "initialize",
                "{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"clientInfo\":{\"name\":\"t\",\"version\":\"1\"}}").get("result");

        assertThat(result.get("protocolVersion").asText()).isEqualTo("2025-06-18");
        assertThat(result.get("capabilities").has("tools")).isTrue();
        assertThat(result.get("serverInfo").get("name").asText()).isEqualTo("ai-testops");
    }

    @Test
    void notificationGets202() throws Exception {
        AiJob job = job();
        MockHttpServletResponse res = send(job, job.getCallbackToken(), "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}");
        assertThat(res.getStatus()).isEqualTo(202);
        assertThat(res.getContentAsString()).isEmpty();
    }

    @Test
    void listsOnlyAllowedReadTools() throws Exception {
        JsonNode tools = rpc(job(), "tools/list", null).get("result").get("tools");
        Set<String> names = new HashSet<>();
        tools.forEach(t -> {
            names.add(t.get("name").asText());
            assertThat(t.get("inputSchema").get("type").asText()).isEqualTo("object");
            assertThat(t.get("description").asText()).isNotBlank();
        });
        assertThat(names).containsExactlyInAnyOrder("list_executions", "get_sitemap", "list_failure_clusters");
        // 작업이 프로젝트를 고정하므로 모델이 projectId 를 추측해 넣지 않게 스키마에서 뺀다
        tools.forEach(t -> assertThat(t.get("inputSchema").path("properties").has("projectId")).as(t.get("name").asText()).isFalse());
    }

    /** 허용 목록 도구가 RUN · CHANGE 로 바뀌면 이 테스트가 깨진다 (그때는 MCP 로 내보내지 않는다). */
    @Test
    void allowedToolsAreAllReadOnly() {
        for (String name : com.playops.api.controller.McpController.ALLOWED) {
            assertThat(registry.find(name)).as(name).isPresent();
            assertThat(registry.find(name).get().tier()).as(name).isEqualTo(com.playops.api.chat.ToolTier.READ);
        }
    }

    /** LLM 은 선택 인자를 빈 값으로 채우곤 한다 — 채팅처럼 "없음"으로 보고, 공백은 다듬는다. */
    @Test
    void blankOrPaddedProjectIdMeansTheJobsProject() throws Exception {
        AiJob job = job();
        for (String value : java.util.List.of("", " example.com ")) {
            JsonNode result = rpc(job, "tools/call", "{\"name\":\"list_executions\",\"arguments\":{\"projectId\":\"" + value + "\"}}").get("result");
            assertThat(result.get("isError").asBoolean()).as("'" + value + "' " + result).isFalse();
        }
    }

    @Test
    void callsListExecutionsForTheJobsProject() throws Exception {
        JsonNode result = rpc(job(), "tools/call", "{\"name\":\"list_executions\"}").get("result");
        assertThat(result.get("isError").asBoolean()).as(result.toString()).isFalse();
        assertThat(result.get("content").get(0).get("type").asText()).isEqualTo("text");
    }

    /** #158: 실행 번호를 받는 도구는 그 실행이 작업의 프로젝트 것일 때만 */
    @Test
    void failureClustersOnlyForTheJobsOwnExecution() throws Exception {
        Execution mine = new Execution();
        mine.setProjectId("example.com");
        mine.setStatus(ExecutionStatus.FAILED);
        Long mineId = executions.save(mine).getId();
        Execution theirs = new Execution();
        theirs.setProjectId("google.com");
        theirs.setStatus(ExecutionStatus.FAILED);
        Long theirsId = executions.save(theirs).getId();
        AiJob job = job();

        JsonNode ok = rpc(job, "tools/call", "{\"name\":\"list_failure_clusters\",\"arguments\":{\"executionId\":" + mineId + "}}").get("result");
        assertThat(ok.get("isError").asBoolean()).as(ok.toString()).isFalse();
        assertThat(ok.get("content").get(0).get("text").asText()).isEqualTo("[]");
        JsonNode other = rpc(job, "tools/call", "{\"name\":\"list_failure_clusters\",\"arguments\":{\"executionId\":" + theirsId + "}}").get("result");
        assertThat(other.get("isError").asBoolean()).as(other.toString()).isTrue();
    }

    @Test
    void rejectsOtherProjectAndUnlistedTools() throws Exception {
        AiJob job = job();
        JsonNode other = rpc(job, "tools/call", "{\"name\":\"list_executions\",\"arguments\":{\"projectId\":\"google.com\"}}").get("result");
        assertThat(other.get("isError").asBoolean()).isTrue();

        assertThat(rpc(job, "tools/call", "{\"name\":\"fix_test\",\"arguments\":{}}").get("error").get("code").asInt()).isEqualTo(-32602);
        assertThat(rpc(job, "resources/list", null).get("error").get("code").asInt()).isEqualTo(-32601);
    }

    @Test
    void getAndDeleteAre405() throws Exception {
        AiJob job = job();
        String url = "/internal/ai-jobs/" + job.getId() + "/mcp";
        assertThat(mvc.perform(get(url).header("Authorization", "Bearer " + job.getCallbackToken())).andReturn().getResponse().getStatus()).isEqualTo(405);
        assertThat(mvc.perform(delete(url).header("Authorization", "Bearer " + job.getCallbackToken())).andReturn().getResponse().getStatus()).isEqualTo(405);
    }
}
