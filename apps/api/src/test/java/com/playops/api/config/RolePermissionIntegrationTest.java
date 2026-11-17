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

    private String admin;
    private String member;
    private long memberId;

    private JsonNode call(MockHttpServletRequestBuilder req, String token, int expectStatus) throws Exception {
        if (token != null) req.header("Authorization", "Bearer " + token);
        var res = mvc.perform(req.contentType(MediaType.APPLICATION_JSON)).andReturn().getResponse();
        assertThat(res.getStatus()).as(res.getContentAsString()).isEqualTo(expectStatus);
        String body = res.getContentAsString();
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
        JsonNode signup = call(post("/api/auth/signup")
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
}
