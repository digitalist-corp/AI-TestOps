package com.playops.api.service;

import com.playops.api.config.PlayOpsProperties;
import com.playops.api.entity.DockerStatus;
import com.playops.api.entity.Project;
import com.playops.api.entity.RunnerLifecycle;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class DockerRunnerServiceTest {

    private static final String RUNNER_IMAGE = "playops-runner:node22.16.0-pw1.53.0";
    private static final String CONTAINER_ID = "1234567890abcdef";

    @Test
    void stopRunnerStopsPersistentContainerWithoutRemovingIt() {
        List<List<String>> commands = new ArrayList<>();
        DockerRunnerService service = serviceWith(commands, command -> {
            if (command.contains("inspect")) {
                return CONTAINER_ID + "\ttrue\t" + RUNNER_IMAGE;
            }
            return "";
        });
        Project project = project(RunnerLifecycle.PERSISTENT);

        service.stopRunner(project);

        assertThat(commands).contains(
                List.of("docker", "stop", "playops-runner-demo")
        );
        assertThat(commands).doesNotContain(
                List.of("docker", "rm", "-f", "playops-runner-demo")
        );
        assertThat(project.getDockerContainerId()).isEqualTo("1234567890ab");
        assertThat(project.getDockerStatus()).isEqualTo(DockerStatus.STOPPED);
    }

    @Test
    void stopRunnerRemovesEphemeralContainer() {
        List<List<String>> commands = new ArrayList<>();
        DockerRunnerService service = serviceWith(commands, command -> "");
        Project project = project(RunnerLifecycle.EPHEMERAL);

        service.stopRunner(project);

        assertThat(commands).containsExactly(
                List.of("docker", "rm", "-f", "playops-runner-demo")
        );
        assertThat(project.getDockerContainerId()).isNull();
        assertThat(project.getDockerStatus()).isEqualTo(DockerStatus.STOPPED);
    }

    @Test
    void startRunnerRestartsReusablePersistentContainer() {
        List<List<String>> commands = new ArrayList<>();
        DockerRunnerService service = serviceWith(commands, command -> {
            if (command.contains("inspect")) {
                return CONTAINER_ID + "\tfalse\t" + RUNNER_IMAGE;
            }
            return "";
        });
        Project project = project(RunnerLifecycle.PERSISTENT);

        service.startRunner(project);

        assertThat(commands).containsExactly(
                List.of("docker", "inspect", "-f", "{{.Id}}\t{{.State.Running}}\t{{.Config.Image}}", "playops-runner-demo"),
                List.of("docker", "start", "playops-runner-demo")
        );
        assertThat(project.getDockerContainerId()).isEqualTo("1234567890ab");
        assertThat(project.getDockerStatus()).isEqualTo(DockerStatus.RUNNING);
    }

    @Test
    void startRunnerBuildsImageAndCreatesContainerWhenContainerDoesNotExist() {
        List<List<String>> commands = new ArrayList<>();
        DockerRunnerService service = serviceWith(commands, command -> {
            if (command.equals(List.of("docker", "inspect", "-f", "{{.Id}}\t{{.State.Running}}\t{{.Config.Image}}", "playops-runner-demo"))) {
                throw new RuntimeException("container not found");
            }
            if (command.equals(List.of("docker", "rm", "-f", "playops-runner-demo"))) {
                throw new RuntimeException("container not found");
            }
            if (command.equals(List.of("docker", "image", "inspect", RUNNER_IMAGE))) {
                throw new RuntimeException("image not found");
            }
            if (!command.isEmpty() && command.get(0).equals("docker") && command.get(1).equals("build")) {
                return "Step 1/2 : FROM node\nSuccessfully built runner";
            }
            if (!command.isEmpty() && command.get(0).equals("docker") && command.get(1).equals("run")) {
                return CONTAINER_ID;
            }
            return "";
        });
        Project project = project(RunnerLifecycle.PERSISTENT);

        service.startRunner(project);

        assertThat(commands).containsSubsequence(
                List.of("docker", "inspect", "-f", "{{.Id}}\t{{.State.Running}}\t{{.Config.Image}}", "playops-runner-demo"),
                List.of("docker", "rm", "-f", "playops-runner-demo"),
                List.of("docker", "image", "inspect", RUNNER_IMAGE)
        );
        assertThat(commands).anySatisfy(command -> assertThat(command).containsExactly(
                "docker", "build",
                "--no-cache",
                "--force-rm",
                "-f", "/app/runner.Dockerfile",
                "--build-arg", "NODE_VERSION=22.16.0",
                "--build-arg", "PLAYWRIGHT_VERSION=1.53.0",
                "-t", RUNNER_IMAGE,
                "/app"
        ));
        assertThat(commands).anySatisfy(command -> assertThat(command).containsExactly(
                "docker", "run",
                "-d",
                "--name", "playops-runner-demo",
                "--restart", "unless-stopped",
                "--volumes-from", "playops-api",
                "--user", "0",
                "-w", "/projects/demo",
                "-e", "NODE_VERSION=22",
                "--add-host", "host.docker.internal:host-gateway",
                RUNNER_IMAGE,
                "tail", "-f", "/dev/null"
        ));
        assertThat(project.getDockerContainerId()).isEqualTo("1234567890ab");
        assertThat(project.getDockerStatus()).isEqualTo(DockerStatus.RUNNING);
        assertThat(service.operationLog("demo").output())
                .contains("러너 이미지가 없어 먼저 빌드합니다")
                .contains("Step 1/2 : FROM node")
                .contains("컨테이너 시작 완료");
    }

    private DockerRunnerService serviceWith(
            List<List<String>> commands,
            TestCommandRunner commandRunner
    ) {
        return new DockerRunnerService(
                new PlayOpsProperties("/projects", "/storage", true, new PlayOpsProperties.Security("")),
                (command, timeoutSeconds, outputConsumer) -> {
                    commands.add(List.copyOf(command));
                    String output = commandRunner.run(command);
                    if (outputConsumer != null && output != null && !output.isBlank()) {
                        output.lines().forEach(outputConsumer);
                    }
                    return output;
                }
        );
    }

    private Project project(RunnerLifecycle lifecycle) {
        Project project = new Project();
        project.setProjectId("demo");
        project.setProjectName("Demo");
        project.setDockerEnabled(true);
        project.setRunnerLifecycle(lifecycle);
        return project;
    }

    @FunctionalInterface
    private interface TestCommandRunner {
        String run(List<String> command) throws Exception;
    }
}
