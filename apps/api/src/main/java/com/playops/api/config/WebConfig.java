package com.playops.api.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
@EnableConfigurationProperties(PlayOpsProperties.class)
public class WebConfig implements WebMvcConfigurer {

    private final AuthInterceptor authInterceptor;
    private final ProjectAccessInterceptor projectAccessInterceptor;

    public WebConfig(AuthInterceptor authInterceptor, ProjectAccessInterceptor projectAccessInterceptor) {
        this.authInterceptor = authInterceptor;
        this.projectAccessInterceptor = projectAccessInterceptor;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins("*")
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*");
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(authInterceptor)
                .addPathPatterns("/api/**");
        // 인증 다음에 관리자 · PM · 팀원 권한을 본다
        registry.addInterceptor(projectAccessInterceptor)
                .addPathPatterns("/api/**");
    }
}
