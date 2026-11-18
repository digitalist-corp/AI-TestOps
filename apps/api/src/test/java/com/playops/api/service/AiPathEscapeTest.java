package com.playops.api.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** AI 가 바꾸는 파일 경로는 프로젝트 폴더 안이어야 한다. 반영(applyDiff)과 러너 결과 검사가 같이 쓴다 (자체 리뷰 2위). */
class AiPathEscapeTest {

    @Test
    void pathsOutsideTheProjectEscape() {
        assertThat(AiJobService.escapesProject("/etc/passwd")).isTrue();
        assertThat(AiJobService.escapesProject("../other/x.spec.ts")).isTrue();
        assertThat(AiJobService.escapesProject("tests/../../x.spec.ts")).isTrue();
        assertThat(AiJobService.escapesProject("")).isTrue();
        assertThat(AiJobService.escapesProject(null)).isTrue();
        assertThat(AiJobService.escapesProject("a/b/../../..")).isTrue();
        // 프로젝트 폴더 자체는 파일이 아니다 (덮어쓰려다 500)
        assertThat(AiJobService.escapesProject(".")).isTrue();
        assertThat(AiJobService.escapesProject("tests/..")).isTrue();
    }

    @Test
    void pathsInsideTheProjectDoNot() {
        assertThat(AiJobService.escapesProject("tests/demo.spec.ts")).isFalse();
        assertThat(AiJobService.escapesProject("tests/sub/../a.spec.ts")).isFalse();
        assertThat(AiJobService.escapesProject("playwright.config.ts")).isFalse();
    }
}
