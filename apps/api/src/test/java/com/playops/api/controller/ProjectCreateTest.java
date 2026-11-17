package com.playops.api.controller;

import com.playops.api.dto.ProjectRequest;
import com.playops.api.dto.ProjectResponse;
import com.playops.api.entity.ProjectRole;
import com.playops.api.entity.User;
import com.playops.api.entity.UserRole;
import com.playops.api.exception.ApiException;
import com.playops.api.service.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** 프로젝트 생성은 관리자만 하고, 생성하면서 고른 PM(없으면 만든 관리자)을 PM으로 넣는다. */
class ProjectCreateTest {

    private ProjectService projectService;
    private ProjectMemberService memberService;
    private ProjectController controller;

    @BeforeEach
    void setUp() {
        projectService = mock(ProjectService.class);
        memberService = mock(ProjectMemberService.class);
        ProjectResponse created = mock(ProjectResponse.class);
        when(created.projectId()).thenReturn("shop");
        when(projectService.create(any(), any())).thenReturn(created);
        controller = new ProjectController(projectService, mock(PlaywrightTemplateService.class),
                mock(RunnerCapacityService.class), mock(DockerRunnerService.class), mock(LoginSessionService.class),
                mock(SiteCheckService.class), mock(SiteAnalysisService.class), memberService);
    }

    private static MockHttpServletRequest as(Long id, UserRole role) {
        User u = new User();
        u.setId(id);
        u.setRole(role);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setAttribute("currentUser", u);
        return request;
    }

    private static ProjectRequest request(Long pmUserId) {
        return new ProjectRequest("shop", "쇼핑몰", null, null, null, null, null, null, null, null, null, null, null,
                null, null, null, null, null, null, null, null, null, null, null, false, null, null, null,
                null, null, null, null, pmUserId, null, null, null);
    }

    @Test
    void teamMemberCannotCreateProject() {
        assertThatThrownBy(() -> controller.create(request(null), as(3L, UserRole.USER)))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(403));
        verify(projectService, never()).create(any(), any());
    }

    @Test
    void adminCreatesProjectWithChosenPm() {
        MockHttpServletRequest admin = as(1L, UserRole.ADMIN);
        controller.create(request(7L), admin);

        verify(memberService).add(eq("shop"), eq(7L), eq(ProjectRole.PM), any(User.class));
    }

    @Test
    void adminBecomesPmWhenNoneChosen() {
        controller.create(request(null), as(1L, UserRole.ADMIN));

        verify(memberService).add(eq("shop"), eq(1L), eq(ProjectRole.PM), any(User.class));
    }
}
