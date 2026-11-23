package com.playops.api.service;

import com.playops.api.config.PlayOpsProperties;
import com.playops.api.dto.RunnerCleanupRequest;
import com.playops.api.dto.RunnerCleanupResponse;
import com.playops.api.dto.RunnerContainerResponse;
import com.playops.api.entity.DockerStatus;
import com.playops.api.entity.Project;
import com.playops.api.entity.RunnerLifecycle;
import com.playops.api.repository.ExecutionRepository;
import com.playops.api.repository.ProjectRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Runner 컨테이너 관리 — 실행 중인 상주 Runner 도 고르고 지울 수 있고, 어느 프로젝트 것인지 보인다. */
class ProjectServiceRunnerTest {

    private final ProjectRepository projects = mock(ProjectRepository.class);
    private final ExecutionRepository executions = mock(ExecutionRepository.class);
    private final DockerRunnerService docker = mock(DockerRunnerService.class);
    private ProjectService service;
    private Project shop;

    @BeforeEach
    void setUp() {
        service = new ProjectService(projects, executions, mock(PlayOpsProperties.class), docker,
                mock(PlaywrightTemplateService.class), mock(GitRepositoryService.class),
                mock(SecretCipherService.class), mock(ProjectMemberService.class));
        shop = new Project();
        shop.setProjectId("shop");
        shop.setProjectName("쇼핑몰");
        shop.setDockerEnabled(true);
        shop.setRunnerLifecycle(RunnerLifecycle.PERSISTENT);
        when(projects.findAll()).thenReturn(List.of(shop));
        when(docker.listDockerContainers()).thenReturn(List.of(runner("playops-runner-shop", "shop")));
    }

    private static DockerRunnerService.RunnerContainer runner(String name, String projectId) {
        return new DockerRunnerService.RunnerContainer(name, "abcdef1234567890", "playops-runner", DockerStatus.RUNNING,
                projectId, "", "", "", "", "", "", "Up 2 hours");
    }

    @Test
    void 실행_중이어도_테스트가_돌지_않으면_삭제할_수_있고_프로젝트_이름이_보인다() {
        RunnerContainerResponse row = service.listDockerContainers().get(0);

        assertThat(row.removable()).isTrue();
        assertThat(row.projectName()).isEqualTo("쇼핑몰");
    }

    @Test
    void 고른_실행_중_Runner_는_지운다() {
        RunnerCleanupResponse result = service.cleanupRunnerContainers(new RunnerCleanupRequest(List.of("playops-runner-shop"), false));

        assertThat(result.removed()).containsExactly("playops-runner-shop");
        verify(docker).removeDockerContainer("playops-runner-shop");
    }

    @Test
    void 테스트가_도는_Runner_는_지우지_않는다() {
        when(executions.existsByProjectIdAndStatusIn(eq("shop"), any())).thenReturn(true);

        RunnerCleanupResponse result = service.cleanupRunnerContainers(new RunnerCleanupRequest(List.of("playops-runner-shop"), false));

        assertThat(result.removed()).isEmpty();
        assertThat(service.listDockerContainers().get(0).removable()).isFalse();
        verify(docker, never()).removeDockerContainer(anyString());
    }

    @Test
    void 지운_상주_Runner_는_다음_실행_때_다시_띄운다() {
        when(docker.getStatus(shop)).thenReturn(DockerStatus.STOPPED);

        service.ensureDockerRunnerRunning(shop);

        verify(docker).startRunner(shop);
    }
}
