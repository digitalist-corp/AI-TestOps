package com.playops.api.util;

import jakarta.servlet.http.HttpServletRequest;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.regex.Pattern;

/**
 * 가입 · 로그인 횟수 제한에 쓰는 접속 IP (#121).
 * 배포 경로는 Cloudflare 터널 → web(vite, 같은 도커 네트워크) → api 라 원격 주소는 사설이고, 실제 접속 주소는 Cloudflare 가
 * X-Forwarded-For 오른쪽에 붙인다(11/18 배포 서버에서 확인). 그래서 원격 주소가 믿을 프록시(사설 · 루프백)일 때만 헤더를 보고,
 * 오른쪽부터 첫 비신뢰 주소를 쓴다. 인터넷에서 바로 들어온 요청은 헤더를 무시한다 — 헤더 위조로 횟수 제한을 피하지 못하게.
 */
public final class ClientIp {

    private ClientIp() {}

    /** IP 문자만 — 이름이면 InetAddress 가 DNS 를 찾지 않게 걸러 낸다 */
    private static final Pattern IP_LITERAL = Pattern.compile("(\\d{1,3}\\.){3}\\d{1,3}|[0-9a-fA-F]*:[0-9a-fA-F:.]*");

    public static String of(HttpServletRequest request) {
        String remote = request.getRemoteAddr();
        String forwarded = request.getHeader("X-Forwarded-For");
        if (!trusted(remote) || forwarded == null || forwarded.isBlank()) return remote;
        String[] hops = forwarded.split(",");
        String leftmost = null;
        for (int i = hops.length - 1; i >= 0; i--) {
            String hop = hops[i].trim();
            if (!IP_LITERAL.matcher(hop).matches()) continue;
            if (!trusted(hop)) return hop;
            leftmost = hop;
        }
        return leftmost != null ? leftmost : remote;
    }

    /** 사설 · 루프백 · IPv6 고유 로컬(fc00::/7) — 같은 도커 네트워크나 서버 안의 프록시 */
    static boolean trusted(String address) {
        if (address == null || !IP_LITERAL.matcher(address).matches()) return false;
        try {
            InetAddress a = InetAddress.getByName(address);
            return a.isLoopbackAddress() || a.isSiteLocalAddress() || a.isLinkLocalAddress()
                    || (a.getAddress().length == 16 && (a.getAddress()[0] & 0xfe) == 0xfc);
        } catch (UnknownHostException e) {
            return false;
        }
    }
}
