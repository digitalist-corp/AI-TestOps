package com.playops.api.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.entity.AiJob;
import com.playops.api.entity.AiJobStatus;
import com.playops.api.entity.AiJobType;
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
        assertThat(names).containsExactlyInAnyOrder("list_executions", "get_sitemap");
    }

    @Test
    void callsListExecutionsForTheJobsProject() throws Exception {
        JsonNode result = rpc(job(), "tools/call", "{\"name\":\"list_executions\"}").get("result");
        assertThat(result.get("isError").asBoolean()).as(result.toString()).isFalse();
        assertThat(result.get("content").get(0).get("type").asText()).isEqualTo("text");
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
