package com.playops.api.migration;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.init.ScriptUtils;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V24(계획 우선 흐름): plan_items 를 만들고, 프로젝트를 지우면 계획 행도 지워진다. 담당자 · AI 작업이 지워지면 비운다.
 * (H2 PostgreSQL 모드에서 같은 SQL 을 돌린다.)
 */
class PlanItemsMigrationTest {

    @Test
    void planItemsFollowTheirProject() throws Exception {
        try (Connection c = DriverManager.getConnection("jdbc:h2:mem:v24;MODE=PostgreSQL;DB_CLOSE_DELAY=-1");
             Statement st = c.createStatement()) {
            st.execute("CREATE TABLE projects (project_id VARCHAR(100) PRIMARY KEY)");
            st.execute("CREATE TABLE users (id BIGINT PRIMARY KEY)");
            st.execute("CREATE TABLE ai_jobs (id BIGINT PRIMARY KEY)");
            st.execute("INSERT INTO projects VALUES ('shop'), ('other')");
            st.execute("INSERT INTO users VALUES (1)");
            st.execute("INSERT INTO ai_jobs VALUES (9)");

            ScriptUtils.executeSqlScript(c, new ClassPathResource("db/migration/V24__plan_items.sql"));

            st.execute("INSERT INTO plan_items (project_id, title, assignee_user_id, ai_job_id) VALUES ('shop', '로그인', 1, 9)");
            st.execute("INSERT INTO plan_items (project_id, title) VALUES ('other', '검색')");
            try (ResultSet rs = st.executeQuery("SELECT enabled, auto_link, spec_path, created_at FROM plan_items WHERE title = '로그인'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getBoolean(1)).isTrue();
                assertThat(rs.getBoolean(2)).isTrue();
                assertThat(rs.getString(3)).isNull();
                assertThat(rs.getTimestamp(4)).isNotNull();
            }

            st.execute("DELETE FROM users WHERE id = 1");
            st.execute("DELETE FROM ai_jobs WHERE id = 9");
            try (ResultSet rs = st.executeQuery("SELECT assignee_user_id, ai_job_id FROM plan_items WHERE title = '로그인'")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getObject(1)).isNull();
                assertThat(rs.getObject(2)).isNull();
            }

            st.execute("DELETE FROM projects WHERE project_id = 'shop'");
            try (ResultSet rs = st.executeQuery("SELECT title FROM plan_items")) {
                assertThat(rs.next()).isTrue();
                assertThat(rs.getString(1)).isEqualTo("검색");
                assertThat(rs.next()).isFalse();
            }
        }
    }
}
