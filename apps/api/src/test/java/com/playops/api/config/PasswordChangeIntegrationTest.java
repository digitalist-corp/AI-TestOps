package com.playops.api.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/**
 * .env 관리자 비밀번호가 비어 있으면 관리자는 admin 으로 만들어지고, 비밀번호를 바꾸기 전에는 다른 API 를 못 쓴다 (3-1 보안).
 * 테스트마다 새 DB (비밀번호를 바꾸는 테스트가 있어서).
 */
@SpringBootTest(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:pwchange;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "playops.docker-enabled=false",
        "playops.projects-root=build/tmp/pwchange-projects",
        "playops.storage-root=build/tmp/pwchange-storage",
        "LOGIN_USERNAME=admin",
        "LOGIN_PASSWORD="
})
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class PasswordChangeIntegrationTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper json;

    private JsonNode call(MockHttpServletRequestBuilder req, String token, int expectStatus) throws Exception {
        if (token != null) req.header("Authorization", "Bearer " + token);
        var res = mvc.perform(req.contentType(MediaType.APPLICATION_JSON)).andReturn().getResponse();
        String body = res.getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(res.getStatus()).as(body).isEqualTo(expectStatus);
        return body.isBlank() ? null : json.readTree(body);
    }

    private JsonNode login(String password, int expectStatus) throws Exception {
        return call(post("/api/auth/login").content("{\"username\":\"admin\",\"password\":\"" + password + "\"}"), null, expectStatus);
    }

    private JsonNode changePassword(String token, String current, String next, int expectStatus) throws Exception {
        return call(post("/api/auth/password")
                .content("{\"currentPassword\":\"" + current + "\",\"newPassword\":\"" + next + "\"}"), token, expectStatus);
    }

    @Test
    void defaultAdminMustChangePasswordBeforeAnythingElse() throws Exception {
        JsonNode res = login("admin", 200);
        assertThat(res.get("passwordChangeRequired").asBoolean()).isTrue();
        String token = res.get("token").asText();

        JsonNode blocked = call(get("/api/projects"), token, 403);
        assertThat(blocked.get("error").get("code").asText()).isEqualTo("PASSWORD_CHANGE_REQUIRED");
        assertThat(call(get("/api/auth/me"), token, 200).get("passwordChangeRequired").asBoolean()).isTrue();
    }

    @Test
    void changingPasswordRevokesOldTokensAndClearsFlag() throws Exception {
        String old = login("admin", 200).get("token").asText();

        JsonNode changed = changePassword(old, "admin", "new-pass-1234", 200);
        assertThat(changed.get("passwordChangeRequired").asBoolean()).isFalse();
        String fresh = changed.get("token").asText();

        call(get("/api/auth/me"), old, 401);
        call(get("/api/projects"), fresh, 200);
        login("admin", 401);
        assertThat(login("new-pass-1234", 200).get("passwordChangeRequired").asBoolean()).isFalse();
    }

    @Test
    void rejectsWrongCurrentOrWeakNewPassword() throws Exception {
        String token = login("admin", 200).get("token").asText();

        changePassword(token, "wrong-current", "new-pass-1234", 400);
        changePassword(token, "admin", "admin", 400);
        changePassword(token, "admin", "short", 400);

        assertThat(call(get("/api/auth/me"), token, 200).get("passwordChangeRequired").asBoolean()).isTrue();
    }
}
