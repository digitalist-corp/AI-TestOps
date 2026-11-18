package com.playops.api.migration;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.init.ScriptUtils;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V18(#119) 이관: 계획 담당자 글자가 그 프로젝트 멤버의 아이디나 표시 이름과 같은 사람이 꼭 한 명이면 계정으로 잇는다.
 * 못 찾거나 여럿이면 비워 두고, 글자는 그대로 남긴다. (H2 PostgreSQL 모드에서 같은 SQL 을 돌린다.)
 */
class PlanAssigneeMigrationTest {

    @Test
    void linksTextAssigneesThatMatchExactlyOneMember() throws Exception {
        try (Connection c = DriverManager.getConnection("jdbc:h2:mem:v18;MODE=PostgreSQL;DB_CLOSE_DELAY=-1");
             Statement st = c.createStatement()) {
            st.execute("CREATE TABLE users (id BIGINT PRIMARY KEY, username VARCHAR(100), display_name VARCHAR(100))");
            st.execute("CREATE TABLE project_members (project_id VARCHAR(100), user_id BIGINT, role VARCHAR(10))");
            st.execute("CREATE TABLE scenario_case_settings (id BIGINT PRIMARY KEY, project_id VARCHAR(100), assignee VARCHAR(100))");
            st.execute("INSERT INTO users VALUES (1, 'kim', '김윤재'), (2, 'lee', '이민지'), (3, 'park', NULL),"
                    + " (4, 'twin1', '동명'), (5, 'twin2', '동명')");
            st.execute("INSERT INTO project_members VALUES ('shop', 1, 'PM'), ('shop', 2, 'MEMBER'), ('shop', 4, 'MEMBER'),"
                    + " ('shop', 5, 'MEMBER'), ('other', 3, 'PM')");
            st.execute("INSERT INTO scenario_case_settings VALUES (10, 'shop', '김윤재'), (11, 'shop', 'lee'),"
                    + " (12, 'shop', 'park'), (13, 'shop', '홍길동'), (14, 'shop', '동명'), (15, 'shop', ' kim '), (16, 'shop', NULL)");

            ScriptUtils.executeSqlScript(c, new ClassPathResource("db/migration/V18__plan_assignee_user.sql"));

            Map<Long, Long> linked = new HashMap<>();
            Map<Long, String> text = new HashMap<>();
            try (ResultSet rs = st.executeQuery("SELECT id, assignee_user_id, assignee FROM scenario_case_settings")) {
                while (rs.next()) {
                    linked.put(rs.getLong(1), (Long) rs.getObject(2, Long.class));
                    text.put(rs.getLong(1), rs.getString(3));
                }
            }
            assertThat(linked.get(10L)).isEqualTo(1L);  // 표시 이름
            assertThat(linked.get(11L)).isEqualTo(2L);  // 아이디
            assertThat(linked.get(12L)).isNull();       // 다른 프로젝트 사람
            assertThat(linked.get(13L)).isNull();       // 계정 없음
            assertThat(linked.get(14L)).isNull();       // 같은 이름이 둘
            assertThat(linked.get(15L)).isEqualTo(1L);  // 앞뒤 공백
            assertThat(linked.get(16L)).isNull();
            assertThat(text.get(13L)).isEqualTo("홍길동");
            assertThat(text.get(10L)).isEqualTo("김윤재");
        }
    }
}
