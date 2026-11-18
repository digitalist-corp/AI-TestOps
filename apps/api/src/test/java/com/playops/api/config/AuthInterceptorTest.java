package com.playops.api.config;

import com.playops.api.service.AuthService;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/** 로그인 전에 부르는 가입 · 게스트 입장은 토큰 없이 통과한다. */
@org.junit.jupiter.api.extension.ExtendWith(org.springframework.boot.test.system.OutputCaptureExtension.class)
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

    @Test
    void signupIsLimitedToFivePerMinutePerIp() throws Exception {
        for (int i = 0; i < 5; i++) {
            assertThat(signupFrom("10.0.0.1").getStatus()).isEqualTo(200);
        }
        MockHttpServletResponse sixth = signupFrom("10.0.0.1");
        assertThat(sixth.getStatus()).isEqualTo(429);
        assertThat(signupFrom("10.0.0.2").getStatus()).isEqualTo(200);
    }

    private MockHttpServletResponse signupFrom(String ip) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/auth/signup");
        request.setRemoteAddr(ip);
        MockHttpServletResponse response = new MockHttpServletResponse();
        interceptor.preHandle(request, response, new Object());
        return response;
    }

    /**
     * #121 확인용 임시 로그 (다음 배포에서 지운다): X-Forwarded-For · X-Real-IP · 원격 주소만 남기고
     * Authorization · Cookie 같은 값은 절대 남기지 않는다.
     */
    @Test
    void ipProbeLogsOnlyAddressHeaders(org.springframework.boot.test.system.CapturedOutput output) throws Exception {
        org.springframework.mock.web.MockHttpServletRequest request =
                new org.springframework.mock.web.MockHttpServletRequest("GET", "/api/health/services");
        request.setParameter("ipProbe", "1");
        request.setRemoteAddr("172.18.0.5");
        request.addHeader("X-Forwarded-For", "203.0.113.7, 172.18.0.4");
        request.addHeader("X-Real-IP", "203.0.113.7");
        request.addHeader("Authorization", "Bearer secret-token-value");
        request.addHeader("Cookie", "session=secret-cookie-value");

        interceptor.preHandle(request, new org.springframework.mock.web.MockHttpServletResponse(), new Object());

        assertThat(output.getOut()).contains("[#121]", "remote=172.18.0.5", "xff=203.0.113.7, 172.18.0.4", "xreal=203.0.113.7")
                .doesNotContain("secret-token-value").doesNotContain("secret-cookie-value");
    }

    @Test
    void noProbeNoLog(org.springframework.boot.test.system.CapturedOutput output) throws Exception {
        org.springframework.mock.web.MockHttpServletRequest request =
                new org.springframework.mock.web.MockHttpServletRequest("GET", "/api/health/services");
        request.addHeader("X-Forwarded-For", "203.0.113.7");

        interceptor.preHandle(request, new org.springframework.mock.web.MockHttpServletResponse(), new Object());

        assertThat(output.getOut()).doesNotContain("[#121]");
    }
}
