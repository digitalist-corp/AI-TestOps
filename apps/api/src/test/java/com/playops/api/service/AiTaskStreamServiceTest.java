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
        MockMvc mvc = standaloneSetup(new AiTaskStreamController(service)).build();
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
}
