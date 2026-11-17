package com.playops.api.config;

import com.playops.api.entity.Execution;
import com.playops.api.entity.ProjectRole;
import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.repository.AiJobRepository;
import com.playops.api.repository.ExecutionRepository;
import com.playops.api.service.ProjectMemberService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 팀원은 보기와 실행 · 재실행 · 취소만, 쓰기는 PM. 실행 id 경로도 그 실행의 프로젝트로 판단한다. */
class ProjectAccessInterceptorTest {

    private final User teamMember = new User();
    private ProjectAccessInterceptor interceptor;

    @BeforeEach
    void setUp() {
        teamMember.setId(3L);
        teamMember.setRole(UserRole.USER);
        ProjectMemberService members = mock(ProjectMemberService.class);
        when(members.roleOf(any(), any())).thenReturn(Optional.empty());
        when(members.roleOf(eq("shop"), any())).thenReturn(Optional.of(ProjectRole.MEMBER));
        ExecutionRepository executions = mock(ExecutionRepository.class);
        Execution other = new Execution();
        other.setProjectId("blog");
        when(executions.findById(9L)).thenReturn(Optional.of(other));
        Execution mine = new Execution();
        mine.setProjectId("shop");
        when(executions.findById(5L)).thenReturn(Optional.of(mine));
        com.playops.api.service.AiBootstrapService bootstraps = mock(com.playops.api.service.AiBootstrapService.class);
        when(bootstraps.projectIdOf(any())).thenReturn(Optional.empty());
        when(bootstraps.projectIdOf("b-shop")).thenReturn(Optional.of("shop"));
        when(bootstraps.projectIdOf("b-blog")).thenReturn(Optional.of("blog"));
        interceptor = new ProjectAccessInterceptor(members, executions, mock(AiJobRepository.class), bootstraps);
    }

    private boolean passes(String method, String path) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest(method, path);
        request.setAttribute("currentUser", teamMember);
        return interceptor.preHandle(request, new MockHttpServletResponse(), new Object());
    }

    @Test
    void teamMemberCanRunAndRerun() throws Exception {
        assertThat(passes("POST", "/api/projects/shop/executions")).isTrue();
        assertThat(passes("POST", "/api/projects/shop/test-suites/4/execute")).isTrue();
        assertThat(passes("POST", "/api/executions/5/cancel")).isTrue();
        assertThat(passes("GET", "/api/projects/shop/plan")).isTrue();
    }

    @Test
    void teamMemberCannotChangeTheProject() throws Exception {
        assertThat(passes("POST", "/api/projects/shop/schedules")).isFalse();
        assertThat(passes("PUT", "/api/projects/shop/scenarios/usage")).isFalse();
        assertThat(passes("POST", "/api/projects/shop/members")).isFalse();
        assertThat(passes("DELETE", "/api/executions/5")).isFalse();
    }

    @Test
    void executionOfAnotherProjectIsHidden() throws Exception {
        assertThat(passes("GET", "/api/executions/9")).isFalse();
        assertThat(passes("GET", "/api/executions/9/logs")).isFalse();
    }

    @Test
    void bootstrapShortPathsAreCheckedAgainstTheirProject() throws Exception {
        assertThat(passes("GET", "/api/ai/bootstrap/b-shop")).isTrue();
        assertThat(passes("GET", "/api/ai/bootstrap/b-blog")).isFalse();
        assertThat(passes("GET", "/api/ai/bootstrap/b-blog/screens/1.png")).isFalse();
        assertThat(passes("POST", "/api/ai/bootstrap/b-shop/credentials")).isFalse();
    }
}
