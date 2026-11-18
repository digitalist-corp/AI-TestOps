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

/** .env 관리자 비밀번호는 최초 생성에만 쓴다. 바꾼 뒤에는 .env 값으로 들어올 수 없다 (3-1 보안). */
@SpringBootTest(properties = {
        "spring.flyway.enabled=false",
        "spring.datasource.url=jdbc:h2:mem:envbypass;MODE=PostgreSQL;DB_CLOSE_DELAY=-1",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "playops.docker-enabled=false",
        "playops.projects-root=build/tmp/envbypass-projects",
        "playops.storage-root=build/tmp/envbypass-storage",
        "LOGIN_USERNAME=admin",
        "LOGIN_PASSWORD=env-pass-1234"
})
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class EnvPasswordBypassIntegrationTest {

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
    void envPasswordNoLongerBypassesDb() throws Exception {
        JsonNode first = login("env-pass-1234", 200);
        assertThat(first.get("passwordChangeRequired").asBoolean()).isFalse();

        changePassword(first.get("token").asText(), "env-pass-1234", "changed-pass-1234", 200);

        login("env-pass-1234", 401);
        login("changed-pass-1234", 200);
    }
}
