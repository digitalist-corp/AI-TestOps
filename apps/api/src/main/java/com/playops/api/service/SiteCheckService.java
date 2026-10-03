package com.playops.api.service;

import com.playops.api.dto.SiteCheckResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 프로젝트 등록 화면에서 "이 주소가 실제로 열리는가"만 빠르게 확인한다.
 *
 * 오타나 서버에서 닿지 않는 주소를 등록 시점에 잡아주는 것이 목적이라,
 * 로그인 여부 판단이나 화면 관찰 같은 무거운 작업은 하지 않는다(그건 첫 AI 실행 몫).
 */
@Service
public class SiteCheckService {

    private static final Logger log = LoggerFactory.getLogger(SiteCheckService.class);
    private static final Duration TIMEOUT = Duration.ofSeconds(8);
    private static final Pattern TITLE = Pattern.compile("<title[^>]*>(.*?)</title>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    /** 제목만 필요하므로 응답 앞부분만 훑는다. */
    private static final int TITLE_SCAN_LIMIT = 64 * 1024;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(TIMEOUT)
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    public SiteCheckResponse check(String rawUrl) {
        URI uri;
        try {
            uri = URI.create(rawUrl.trim());
        } catch (IllegalArgumentException e) {
            return SiteCheckResponse.failed("주소 형식이 올바르지 않습니다.");
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) {
            return SiteCheckResponse.failed("http 또는 https 주소만 확인할 수 있습니다.");
        }
        if (uri.getHost() == null || uri.getHost().isBlank()) {
            return SiteCheckResponse.failed("주소에 호스트가 없습니다.");
        }

        HttpRequest request = HttpRequest.newBuilder(uri)
                .timeout(TIMEOUT)
                .header("User-Agent", "AI-TestOps site check")
                .GET()
                .build();

        try {
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            String title = extractTitle(response.body());
            return new SiteCheckResponse(
                    response.statusCode() < 400,
                    response.statusCode(),
                    title,
                    response.uri().toString(),
                    null
            );
        } catch (java.net.http.HttpTimeoutException e) {
            return SiteCheckResponse.failed("응답이 없습니다. 주소가 맞는지, 서버에서 접근할 수 있는 주소인지 확인해주세요.");
        } catch (java.io.IOException e) {
            log.debug("site check failed: {}", rawUrl, e);
            return SiteCheckResponse.failed("접속하지 못했습니다. 사내망 주소라면 테스트 서버에서도 닿을 수 있어야 합니다.");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return SiteCheckResponse.failed("확인이 중단되었습니다.");
        }
    }

    private String extractTitle(String body) {
        if (body == null || body.isBlank()) return null;
        String head = body.length() > TITLE_SCAN_LIMIT ? body.substring(0, TITLE_SCAN_LIMIT) : body;
        Matcher matcher = TITLE.matcher(head);
        if (!matcher.find()) return null;
        String title = matcher.group(1).replaceAll("\\s+", " ").trim();
        if (title.isEmpty()) return null;
        return title.length() > 120 ? title.substring(0, 120) + "..." : title;
    }
}
