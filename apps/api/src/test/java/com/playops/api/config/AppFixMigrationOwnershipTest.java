package com.playops.api.config;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 제품 코드 수정안 · 사용권 표가 프로젝트(· 멤버)와 함께 지워지는지 마이그레이션에서 확인한다.
 * 새 프로젝트 id 는 "가장 큰 번호 + 1" 이라 지운 프로젝트의 번호가 다시 쓰일 수 있다. 남은 행이 새 프로젝트에 보이면 안 된다.
 * (실제 삭제 연동은 Postgres 에 V1~ 을 적용해 확인한다 — 작업 보고 참고)
 */
class AppFixMigrationOwnershipTest {

    private static String read(String path) throws IOException {
        try (InputStream in = AppFixMigrationOwnershipTest.class.getResourceAsStream(path)) {
            assertThat(in).as(path).isNotNull();
            return new String(in.readAllBytes(), StandardCharsets.UTF_8).replaceAll("--[^\\n]*", "");
        }
    }

    @Test
    void proposalsAreDeletedWithTheirProject() throws IOException {
        assertThat(read("/db/migration/V25__app_fix_proposals.sql")).containsPattern(Pattern.compile(
                "project_id\\s+VARCHAR\\(100\\)\\s+NOT NULL\\s+REFERENCES\\s+projects\\s*\\(project_id\\)\\s+ON DELETE CASCADE"));
    }

    @Test
    void grantsAreDeletedWithTheirMembership() throws IOException {
        assertThat(read("/db/migration/V26__code_auto_fix_grants.sql")).containsPattern(Pattern.compile(
                "FOREIGN KEY\\s*\\(project_id,\\s*user_id\\)\\s+REFERENCES\\s+project_members\\s*\\(project_id,\\s*user_id\\)\\s+ON DELETE CASCADE"));
    }
}
