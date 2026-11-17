package com.playops.api.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/**
 * 관리자 · PM · 팀원 권한을 실제 앱(인터셉터 · 컨트롤러 · H2 DB)으로 확인한다 (#105).
 * 시드: admin 은 모든 데모 프로젝트의 PM, 게스트는 example.com 팀원.
 */
@SpringBootTest(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:roles;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "playops.docker-enabled=false",
        "playops.projects-root=build/tmp/roles-projects",
        "playops.storage-root=build/tmp/roles-storage",
        "LOGIN_USERNAME=admin",
        "LOGIN_PASSWORD=admin"
})
@AutoConfigureMockMvc
class RolePermissionIntegrationTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper json;

    @Autowired
    com.playops.api.repository.ExecutionRepository executions;

    @Autowired
    com.playops.api.repository.SiteAnalysisRunRepository analysisRuns;

    @Autowired
    com.playops.api.repository.ScenarioCaseSettingRepository planRows;

    private static int signups;
    private String admin;
    private String member;
    private long memberId;

    private JsonNode call(MockHttpServletRequestBuilder req, String token, int expectStatus) throws Exception {
        if (token != null) req.header("Authorization", "Bearer " + token);
        var res = mvc.perform(req.contentType(MediaType.APPLICATION_JSON)).andReturn().getResponse();
        assertThat(res.getStatus()).as(res.getContentAsString()).isEqualTo(expectStatus);
        String body = res.getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        return body.isBlank() ? null : json.readTree(body);
    }

    private int status(MockHttpServletRequestBuilder req, String token) throws Exception {
        req.header("Authorization", "Bearer " + token);
        return mvc.perform(req.contentType(MediaType.APPLICATION_JSON)).andReturn().getResponse().getStatus();
    }

    @BeforeEach
    void setUp() throws Exception {
        admin = call(post("/api/auth/login").content("{\"username\":\"admin\",\"password\":\"admin\"}"), null, 200)
                .get("token").asText();
        String name = "m" + UUID.randomUUID().toString().substring(0, 8);
        // 가입은 IP당 분당 5회라 테스트마다 다른 주소에서 가입한다
        JsonNode signup = call(post("/api/auth/signup").header("X-Forwarded-For", "10.9.0." + (++signups))
                .content("{\"username\":\"" + name + "\",\"name\":\"팀원\",\"password\":\"password123\"}"), null, 200);
        member = signup.get("token").asText();
        memberId = signup.get("user").get("id").asLong();
        call(post("/api/projects/example.com/members").content("{\"userId\":" + memberId + ",\"role\":\"MEMBER\"}"), admin, 200);
    }

    private List<String> projectIds(String token) throws Exception {
        List<String> ids = new ArrayList<>();
        call(get("/api/projects"), token, 200).forEach(p -> ids.add(p.get("projectId").asText()));
        return ids;
    }

    @Test
    void teamMemberSeesOnlyTheirProjects() throws Exception {
        assertThat(projectIds(member)).containsExactly("example.com");
        assertThat(projectIds(admin)).contains("example.com", "google.com", "naver.com");
    }

    @Test
    void teamMemberCannotOpenAnotherProject() throws Exception {
        assertThat(status(get("/api/projects/google.com"), member)).isEqualTo(403);
        assertThat(status(get("/api/projects/google.com/plan"), member)).isEqualTo(403);
        assertThat(status(get("/api/projects/example.com"), member)).isEqualTo(200);
    }

    @Test
    void teamMemberCannotEditThePlan() throws Exception {
        assertThat(status(patch("/api/projects/example.com/plan/items")
                .content("{\"specPath\":\"a.spec.ts\",\"grep\":\"x\",\"assignee\":\"나\"}"), member)).isEqualTo(403);
        assertThat(status(put("/api/projects/example.com").content("{}"), member)).isEqualTo(403);
    }

    @Test
    void teamMemberCannotManageUsersOrRunners() throws Exception {
        assertThat(status(post("/api/users").content("{\"username\":\"x\",\"password\":\"password123\"}"), member)).isEqualTo(403);
        assertThat(status(get("/api/users"), member)).isEqualTo(403);
        assertThat(status(get("/api/projects/docker/runners"), member)).isEqualTo(403);
        assertThat(status(delete("/api/projects/example.com"), member)).isEqualTo(403);
    }

    @Test
    void pmCanEditThePlanButNotDeleteTheProject() throws Exception {
        call(patch("/api/projects/example.com/members/" + memberId).content("{\"role\":\"PM\"}"), admin, 200);

        assertThat(status(patch("/api/projects/example.com/plan/items")
                .content("{\"specPath\":\"a.spec.ts\",\"grep\":\"x\",\"assignee\":\"나\"}"), member)).isNotEqualTo(403);
        assertThat(status(delete("/api/projects/example.com"), member)).isEqualTo(403);
    }

    @Test
    void meReturnsGlobalAndProjectRoles() throws Exception {
        JsonNode me = call(get("/api/auth/me"), member, 200);

        assertThat(me.get("role").asText()).isEqualTo("USER");
        assertThat(me.get("projects").get(0).get("projectId").asText()).isEqualTo("example.com");
        assertThat(me.get("projects").get(0).get("role").asText()).isEqualTo("MEMBER");
    }

    @Test
    void pathParametersCannotSlipPastTheChecks() throws Exception {
        assertThat(status(get("/api;x/users"), member)).isEqualTo(400);
        assertThat(status(get("/api;x/projects/google.com/plan"), member)).isEqualTo(400);
        assertThat(status(get("/api/projects;x/google.com"), member)).isEqualTo(400);
    }

    @Test
    void teamMemberCannotAnalyzeAnotherProjectsExecution() throws Exception {
        com.playops.api.entity.Execution other = new com.playops.api.entity.Execution();
        other.setProjectId("google.com");
        other.setStatus(com.playops.api.entity.ExecutionStatus.FAILED);
        long id = executions.saveAndFlush(other).getId();

        assertThat(status(post("/api/ai/analyze").content("{\"executionId\":" + id + "}"), member)).isEqualTo(403);
    }

    @Test
    void runningAnalysesShowOnlyMyProjects() throws Exception {
        for (String projectId : new String[] {"example.com", "google.com"}) {
            com.playops.api.entity.SiteAnalysisRun run = new com.playops.api.entity.SiteAnalysisRun();
            run.setProjectId(projectId);
            analysisRuns.saveAndFlush(run);
        }
        List<String> ids = new ArrayList<>();
        call(get("/api/sitemap/running"), member, 200).forEach(r -> ids.add(r.get("projectId").asText()));

        assertThat(ids).contains("example.com").doesNotContain("google.com");
    }

    @Test
    void onlyAdminsWriteNoticesAndEveryoneIsNotified() throws Exception {
        assertThat(status(post("/api/notices").content("{\"title\":\"팀원 공지\",\"content\":\"x\"}"), member)).isEqualTo(403);

        JsonNode notice = call(post("/api/notices").content("{\"title\":\"점검 안내\",\"content\":\"11/20 점검\"}"), admin, 200);
        long id = notice.get("id").asLong();

        assertThat(status(put("/api/notices/" + id).content("{\"title\":\"x\",\"content\":\"y\"}"), member)).isEqualTo(403);
        assertThat(status(delete("/api/notices/" + id), member)).isEqualTo(403);
        List<String> titles = new ArrayList<>();
        call(get("/api/notices"), member, 200).forEach(n -> titles.add(n.get("title").asText()));
        assertThat(titles).contains("점검 안내");
        List<String> links = new ArrayList<>();
        call(get("/api/notifications"), member, 200).forEach(n -> links.add(n.get("link").asText()));
        assertThat(links).contains("/notices/" + id);
    }

    @Test
    void pmSetsProjectPeriodAndStatusButTeamMemberCannot() throws Exception {
        assertThat(call(get("/api/projects/example.com"), member, 200).get("status").asText()).isEqualTo("PLANNED");
        assertThat(status(put("/api/projects/example.com").content("{\"status\":\"RUNNING\"}"), member)).isEqualTo(403);

        call(patch("/api/projects/example.com/members/" + memberId).content("{\"role\":\"PM\"}"), admin, 200);
        JsonNode saved = call(put("/api/projects/example.com")
                .content("{\"status\":\"RUNNING\",\"startDate\":\"2026-11-01\",\"endDate\":\"2026-12-01\"}"), member, 200);
        assertThat(saved.get("status").asText()).isEqualTo("RUNNING");
        assertThat(saved.get("startDate").asText()).isEqualTo("2026-11-01");
        assertThat(saved.get("endDate").asText()).isEqualTo("2026-12-01");

        // 시작일만 바꿔도 남아 있는 종료일과 비교한다
        assertThat(status(put("/api/projects/example.com").content("{\"startDate\":\"2026-12-02\"}"), member)).isEqualTo(400);
        assertThat(status(put("/api/projects/example.com").content("{\"endDate\":\"12월\"}"), member)).isEqualTo(400);

        JsonNode cleared = call(put("/api/projects/example.com").content("{\"endDate\":\"\"}"), member, 200);
        assertThat(cleared.get("endDate").isNull()).isTrue();
        assertThat(cleared.get("startDate").asText()).isEqualTo("2026-11-01");
    }

    @Test
    void planRowAndProjectRememberWhoChangedThemLast() throws Exception {
        call(patch("/api/projects/example.com/members/" + memberId).content("{\"role\":\"PM\"}"), admin, 200);
        String row = "{\"specPath\":\"tests/audit.spec.ts\",\"grep\":\"감사\",\"assignee\":\"나\"}";
        assertThat(status(patch("/api/projects/example.com/plan/items").content(row), member)).isEqualTo(204);

        var saved = planRows.findByProjectIdAndNodeTypeAndSpecPathAndGrepFilter("example.com", "TEST", "tests/audit.spec.ts", "감사").orElseThrow();
        assertThat(saved.getCreatedBy()).isEqualTo(memberId);
        assertThat(saved.getUpdatedBy()).isEqualTo(memberId);

        long adminId = call(get("/api/auth/me"), admin, 200).get("id").asLong();
        assertThat(status(patch("/api/projects/example.com/plan/items").content(row.replace("나", "관리자")), admin)).isEqualTo(204);
        saved = planRows.findById(saved.getId()).orElseThrow();
        assertThat(saved.getCreatedBy()).isEqualTo(memberId);
        assertThat(saved.getUpdatedBy()).isEqualTo(adminId);

        JsonNode project = call(put("/api/projects/example.com").content("{\"description\":\"감사 확인\"}"), member, 200);
        assertThat(project.get("updatedBy").asLong()).isEqualTo(memberId);
        assertThat(project.get("updatedByName").asText()).isEqualTo("팀원");
    }
}
