package com.playops.api.config;

import org.junit.jupiter.api.Test;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/** 개발 프록시는 Origin 을 그대로 넘겨 같은 화면의 요청도 CORS 검사를 받는다. 쓰는 메서드는 모두 허용해야 한다. */
class WebConfigCorsTest {

    static class ExposedRegistry extends CorsRegistry {
        Map<String, CorsConfiguration> configs() {
            return getCorsConfigurations();
        }
    }

    @Test
    void apiAllowsEveryMethodTheControllersUse() {
        ExposedRegistry registry = new ExposedRegistry();
        new WebConfig(mock(AuthInterceptor.class)).addCorsMappings(registry);

        assertThat(registry.configs().get("/api/**").getAllowedMethods())
                .contains("GET", "POST", "PUT", "PATCH", "DELETE");
    }
}
