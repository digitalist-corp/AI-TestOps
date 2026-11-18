package com.playops.api.service;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** 셀프 회귀 계정 비밀번호는 playops-self 실행에만, docker exec 인자가 아니라 프로세스 환경으로 넘긴다 (3-1 보안, #157). */
class SelfTestCredentialsTest {

    @Test
    void passesPasswordOnlyThroughProcessEnvironmentForSelfTest() {
        List<String> command = new ArrayList<>(List.of("docker", "exec"));
        Map<String, String> env = new HashMap<>();

        TestExecutionService.addSelfTestCredentials("playops-self", command, env, "selftest", "self-pass-1234");

        assertThat(command).containsSubsequence("-e", "SELFTEST_USERNAME=selftest");
        assertThat(command).containsSubsequence("-e", "SELFTEST_PASSWORD");
        assertThat(String.join(" ", command)).doesNotContain("self-pass-1234");
        assertThat(env).containsEntry("SELFTEST_PASSWORD", "self-pass-1234");
    }

    @Test
    void otherProjectsGetNothing() {
        List<String> command = new ArrayList<>(List.of("docker", "exec"));
        Map<String, String> env = new HashMap<>();

        TestExecutionService.addSelfTestCredentials("example.com", command, env, "selftest", "self-pass-1234");

        assertThat(command).containsExactly("docker", "exec");
        assertThat(env).isEmpty();
    }

    @Test
    void blankPasswordAddsNothing() {
        List<String> command = new ArrayList<>(List.of("docker", "exec"));
        Map<String, String> env = new HashMap<>();

        TestExecutionService.addSelfTestCredentials("playops-self", command, env, "selftest", "");

        assertThat(command).containsExactly("docker", "exec");
        assertThat(env).isEmpty();
    }
}
