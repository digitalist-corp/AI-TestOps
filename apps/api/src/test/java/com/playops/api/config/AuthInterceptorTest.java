package com.playops.api.config;

import com.playops.api.service.AuthService;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/** 로그인 전에 부르는 가입 · 게스트 입장은 토큰 없이 통과한다. */
class AuthInterceptorTest {

    private final AuthInterceptor interceptor = new AuthInterceptor(mock(AuthService.class));

    private boolean passes(String method, String path) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest(method, path);
        return interceptor.preHandle(request, new MockHttpServletResponse(), new Object());
    }

    @Test
    void signupAndGuestNeedNoToken() throws Exception {
        assertThat(passes("POST", "/api/auth/signup")).isTrue();
        assertThat(passes("POST", "/api/auth/guest")).isTrue();
    }

    @Test
    void otherApisStillNeedAToken() throws Exception {
        assertThat(passes("GET", "/api/projects")).isFalse();
    }
}
