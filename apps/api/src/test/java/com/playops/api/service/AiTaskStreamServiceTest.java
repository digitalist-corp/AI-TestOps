package com.playops.api.service;

import com.playops.api.controller.AiTaskStreamController;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup;

/** 붙은 화면에 작업 변경이 바로 흘러간다. (D-02) */
class AiTaskStreamServiceTest {

    private final AiTaskStreamService service = new AiTaskStreamService();

    @AfterEach
    void close() {
        service.shutdown();
    }

    @Test
    void subscriberGetsReadyThenJobEvents() throws Exception {
        MockMvc mvc = standaloneSetup(new AiTaskStreamController(service, null)).build();
        MvcResult result = mvc.perform(get("/api/ai-tasks/stream"))
                .andExpect(request().asyncStarted())
                .andReturn();

        service.onJobChanged(new AiJobChanged(7L, "p1", "NEEDS_REVIEW"));

        String body = result.getResponse().getContentAsString();
        assertThat(body).contains("event:ready");
        assertThat(body).contains("event:job");
        assertThat(body).contains("\"id\":7").contains("\"projectId\":\"p1\"").contains("\"status\":\"NEEDS_REVIEW\"");
        assertThat(service.subscriberCount()).isEqualTo(1);
    }

    @Test
    void subscriberOnlyGetsJobsOfProjectsTheyAreMemberOf() throws Exception {
        ProjectMemberService members = org.mockito.Mockito.mock(ProjectMemberService.class);
        com.playops.api.entity.User user = new com.playops.api.entity.User();
        user.setId(3L);
        user.setRole(com.playops.api.entity.UserRole.USER);
        org.mockito.Mockito.when(members.roleOf(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any()))
                .thenReturn(java.util.Optional.empty());
        org.mockito.Mockito.when(members.roleOf(org.mockito.ArgumentMatchers.eq("p1"), org.mockito.ArgumentMatchers.any()))
                .thenReturn(java.util.Optional.of(com.playops.api.entity.ProjectRole.MEMBER));
        MockMvc mvc = standaloneSetup(new AiTaskStreamController(service, members)).build();
        MvcResult result = mvc.perform(get("/api/ai-tasks/stream").requestAttr("currentUser", user))
                .andExpect(request().asyncStarted())
                .andReturn();

        service.onJobChanged(new AiJobChanged(8L, "p2", "NEEDS_REVIEW"));
        service.onJobChanged(new AiJobChanged(7L, "p1", "NEEDS_REVIEW"));

        String body = result.getResponse().getContentAsString();
        assertThat(body).contains("\"projectId\":\"p1\"").doesNotContain("\"projectId\":\"p2\"");
    }
}
