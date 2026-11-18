package com.playops.api.util;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 가입 · 로그인 횟수 제한의 접속 IP (#121). 배포 서버 확인(11/18): 터널 → web(vite) → api 라 원격 주소는 web 컨테이너(사설),
 * X-Forwarded-For 는 Cloudflare 가 붙인 실제 접속 주소 하나(공인). 사용자가 보낸 X-Forwarded-For 는 그 왼쪽에 남는다.
 * → 원격 주소가 믿을 프록시(사설 · 루프백)일 때만 헤더를 보고, 오른쪽부터 첫 비신뢰 주소를 쓴다.
 */
class ClientIpTest {

    private static String ip(String remote, String xff) {
        MockHttpServletRequest r = new MockHttpServletRequest();
        r.setRemoteAddr(remote);
        if (xff != null) r.addHeader("X-Forwarded-For", xff);
        return ClientIp.of(r);
    }

    @Test
    void directConnectionFromTheInternetIgnoresTheHeader() {
        assertThat(ip("198.51.100.9", "1.2.3.4")).isEqualTo("198.51.100.9"); // 헤더 위조로 횟수 제한을 피하지 못함
    }

    @Test
    void behindTheTunnelUsesTheAddressCloudflareAppended() {
        assertThat(ip("172.18.0.2", "203.0.113.7")).isEqualTo("203.0.113.7");
        // 사용자가 X-Forwarded-For 를 보내도 Cloudflare 가 실제 주소를 오른쪽에 붙인다
        assertThat(ip("172.18.0.2", "1.2.3.4, 203.0.113.7")).isEqualTo("203.0.113.7");
    }

    @Test
    void trustedHopsOnTheRightAreSkipped() {
        assertThat(ip("172.18.0.2", "203.0.113.7, 172.18.0.4")).isEqualTo("203.0.113.7");
        assertThat(ip("127.0.0.1", "203.0.113.7, ::1")).isEqualTo("203.0.113.7");
    }

    @Test
    void noHeaderOrOnlyPrivateHops() {
        assertThat(ip("172.18.0.2", null)).isEqualTo("172.18.0.2");
        assertThat(ip("172.18.0.2", " ")).isEqualTo("172.18.0.2");
        assertThat(ip("172.18.0.2", "10.0.0.2, 192.168.1.4")).isEqualTo("10.0.0.2"); // 사내망만 거친 요청은 맨 왼쪽
    }

    @Test
    void garbageEntriesAreNotTrustedAsAddresses() {
        assertThat(ip("172.18.0.2", "unknown, 203.0.113.7")).isEqualTo("203.0.113.7");
        assertThat(ip("172.18.0.2", "not-an-ip")).isEqualTo("172.18.0.2");
        assertThat(ip("172.18.0.2", "cafe")).isEqualTo("172.18.0.2"); // 헥사 글자뿐인 이름도 주소로 보지 않는다 (DNS 조회 없음)
    }
}
