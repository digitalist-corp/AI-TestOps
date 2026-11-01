package com.playops.api.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.entity.ScenarioOrigin;
import com.playops.api.entity.SiteNode;
import com.playops.api.repository.SiteNodeRepository;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 녹화한 테스트를 구조 지도에 반영한다. 계약: docs/design/structure-coverage-contract.md "녹화도 반영한다".
 *
 * - scenario_origin 에 지나간 화면(routeKeys, 순서대로)과 쓴 셀렉터(selectorKeys)를 적는다. 그래야 실행 결과가 지도에 반영된다.
 * - 녹화 중 다룬 요소가 그 화면에 없으면 OBSERVED 요소로 더한다. 화면 자체가 없으면 origin=RECORDED 로 화면을 만든다.
 */
@Service
public class RecordedFlowService {

    /** 녹화 단계 하나. url 은 동작 직후 주소, selector 는 코드에 쓸 수 있는(검사를 통과한) 셀렉터 식이거나 null. */
    public record RecordedAction(String url, String selector, boolean fragile) {}

    private final SiteNodeRepository nodeRepository;
    private final SiteMapPromptService siteMapPromptService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public RecordedFlowService(SiteNodeRepository nodeRepository, SiteMapPromptService siteMapPromptService) {
        this.nodeRepository = nodeRepository;
        this.siteMapPromptService = siteMapPromptService;
    }

    public void record(String projectId, String specPath, String baseUrl, List<RecordedAction> actions) {
        Map<String, SiteNode> nodes = new LinkedHashMap<>();
        for (SiteNode node : nodeRepository.findByProjectIdOrderByRouteKey(projectId)) {
            nodes.put(node.getRouteKey(), node);
        }
        Set<SiteNode> changed = new LinkedHashSet<>();
        Map<String, List<Map<String, Object>>> elementsByRoute = new LinkedHashMap<>();

        // 지나간 화면: 경로마다 지도의 화면에 맞추고(경로 변수 화면 포함), 없으면 새로 만든다.
        List<String> routes = new ArrayList<>();
        for (String path : routeKeysOf(actions.stream().map(RecordedAction::url).toList(), baseUrl)) {
            String route = routeFor(path, urlOf(actions, path, baseUrl), baseUrl, nodes, changed, projectId);
            if (route != null && (routes.isEmpty() || !routes.get(routes.size() - 1).equals(route))) {
                routes.add(route);
            }
        }
        List<String> selectorKeys = selectorKeysOf(actions.stream().map(RecordedAction::selector).toList());

        // 다룬 요소: 동작 직전 화면(앞 단계의 주소)에 속한다. 클릭으로 화면이 바뀌어도 누른 버튼은 앞 화면에 있다.
        for (int i = 0; i < actions.size(); i++) {
            RecordedAction action = actions.get(i);
            if (action.selector() == null) {
                continue;
            }
            String beforeUrl = i > 0 ? actions.get(i - 1).url() : action.url();
            String route = routeFor(routeKeyOf(beforeUrl, baseUrl), beforeUrl, baseUrl, nodes, changed, projectId);
            if (route == null) {
                continue;
            }
            SiteNode node = nodes.get(route);
            List<Map<String, Object>> elements = elementsByRoute.computeIfAbsent(route, r -> readElements(node.getElements()));
            if (mergeElement(elements, elementFor(action.selector(), action.fragile()))) {
                changed.add(node);
            }
        }
        for (Map.Entry<String, List<Map<String, Object>>> entry : elementsByRoute.entrySet()) {
            SiteNode node = nodes.get(entry.getKey());
            if (changed.contains(node)) {
                try {
                    node.setElements(objectMapper.writeValueAsString(entry.getValue()));
                } catch (IOException e) {
                    throw new IllegalStateException(e);
                }
            }
        }
        if (!changed.isEmpty()) {
            nodeRepository.saveAll(changed);
        }
        siteMapPromptService.recordOrigin(projectId, specPath, routes, selectorKeys, ScenarioOrigin.SOURCE_RECORDED);
    }

    /** 그 경로를 처음 지난 단계의 주소. 새 화면의 url 로 쓴다. */
    private static String urlOf(List<RecordedAction> actions, String path, String baseUrl) {
        return actions.stream().map(RecordedAction::url)
                .filter(url -> path.equals(routeKeyOf(url, baseUrl))).findFirst().orElse(path);
    }

    /** 경로가 가리키는 지도의 화면 키. 없으면 RECORDED 화면을 만든다. path 가 null(다른 출처)이면 null. */
    private String routeFor(String path, String url, String baseUrl, Map<String, SiteNode> nodes, Set<SiteNode> changed,
                            String projectId) {
        if (path == null) {
            return null;
        }
        String route = matchRoute(path, nodes.keySet());
        if (route != null) {
            SiteNode node = nodes.get(route);
            if (node.isStale()) {
                node.setStale(false); // 녹화로 실제로 연 화면이다.
                changed.add(node);
            }
            return route;
        }
        SiteNode node = new SiteNode();
        node.setProjectId(projectId);
        node.setRouteKey(path);
        node.setOrigin(SiteAnalysisService.ORIGIN_RECORDED);
        node.setElements("[]");
        node.setLinks("[]");
        node.setForms("[]");
        node.setUrl(absoluteUrl(url, baseUrl));
        nodes.put(path, node);
        changed.add(node);
        return path;
    }

    // ---------------------------------------------------------------- 순수 변환 (단위 테스트 대상)

    /**
     * 단계 주소 → 화면 키(경로). 쿼리 · 해시는 버리고 끝의 / 를 뗀다.
     * baseUrl 과 출처(scheme · host · port)가 다르면 null — 외부 결제창 같은 다른 사이트는 지도에 넣지 않는다.
     */
    static String routeKeyOf(String url, String baseUrl) {
        if (url == null || url.isBlank()) {
            return null;
        }
        try {
            URI u = URI.create(url.trim());
            if (u.isAbsolute()) {
                String scheme = u.getScheme().toLowerCase();
                if (!scheme.equals("http") && !scheme.equals("https")) {
                    return null;
                }
                if (baseUrl != null && !baseUrl.isBlank() && !sameOrigin(u, URI.create(baseUrl.trim()))) {
                    return null;
                }
            }
            String path = u.getRawPath();
            if (path == null || path.isEmpty()) {
                path = "/";
            }
            path = (path.startsWith("/") ? path : "/" + path).replaceAll("/+$", "");
            path = path.isEmpty() ? "/" : path;
            return path.length() > 500 ? null : path;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** 단계 주소들 → 지나간 화면 순서. 다른 출처는 빼고, 같은 화면이 이어지면 하나로 줄인다. */
    static List<String> routeKeysOf(List<String> urls, String baseUrl) {
        List<String> routes = new ArrayList<>();
        for (String url : urls) {
            String route = routeKeyOf(url, baseUrl);
            if (route != null && (routes.isEmpty() || !routes.get(routes.size() - 1).equals(route))) {
                routes.add(route);
            }
        }
        return routes;
    }

    /** 단계 셀렉터들 → selectorKeys (keysOf 와 같은 형식, 나온 순서대로 중복 없이). */
    static List<String> selectorKeysOf(List<String> selectors) {
        Set<String> keys = new LinkedHashSet<>();
        for (String selector : selectors) {
            if (selector != null) {
                keys.addAll(SiteMapPromptService.selectorKeysIn(selector));
            }
        }
        return new ArrayList<>(keys);
    }

    /**
     * 녹화 경로를 지도의 화면 키에 맞춘다. 같은 키가 있으면 그것, 없으면 경로 변수 화면(/products/:id,
     * /products/[id], /docs/*)에 맞춰 본다. 변수가 적은 화면을 먼저 고른다. 없으면 null.
     */
    static String matchRoute(String path, Collection<String> routeKeys) {
        if (routeKeys.contains(path)) {
            return path;
        }
        String[] parts = segments(path);
        return routeKeys.stream()
                .filter(route -> route.startsWith("/") && matchesPattern(segments(route), parts))
                .min(Comparator.comparingInt(RecordedFlowService::dynamicCount).thenComparing(Comparator.naturalOrder()))
                .orElse(null);
    }

    private static boolean matchesPattern(String[] pattern, String[] parts) {
        for (int i = 0; i < pattern.length; i++) {
            String seg = pattern[i];
            if (seg.equals("*") || seg.startsWith("[...") || seg.startsWith("[[...")) {
                return parts.length >= i + (seg.startsWith("[[") ? 0 : 1);
            }
            if (i >= parts.length) {
                return false;
            }
            if (!(isParam(seg) || seg.equals(parts[i]))) {
                return false;
            }
        }
        return pattern.length == parts.length;
    }

    private static boolean isParam(String seg) {
        return seg.startsWith(":") || (seg.startsWith("[") && seg.endsWith("]"));
    }

    private static int dynamicCount(String route) {
        int n = 0;
        for (String seg : segments(route)) {
            if (isParam(seg) || seg.equals("*")) {
                n++;
            }
        }
        return n;
    }

    private static String[] segments(String path) {
        String trimmed = path.replaceAll("^/+|/+$", "");
        int q = trimmed.indexOf('?');
        if (q >= 0) {
            trimmed = trimmed.substring(0, q);
        }
        return trimmed.isEmpty() ? new String[0] : trimmed.split("/+");
    }

    /**
     * 셀렉터 식 → 화면 요소 (사이트 탐색 요소와 같은 모양). 이어진 식은 마지막 호출이 대상이고, 앞의 getByRole 은
     * 범위(scope)로 둔다. 순번(.nth · .first)에 기대는 셀렉터는 정확히 하나를 가리킨다고 볼 수 없어 UNVERIFIED 로 둔다.
     */
    static Map<String, Object> elementFor(String selector, boolean fragile) {
        List<SiteMapPromptService.SelectorCall> calls = SiteMapPromptService.selectorCallsIn(selector);
        Map<String, Object> element = new LinkedHashMap<>();
        if (!calls.isEmpty()) {
            SiteMapPromptService.SelectorCall target = calls.get(calls.size() - 1);
            switch (target.method()) {
                case "getByRole" -> {
                    element.put("kind", target.value());
                    element.put("role", target.value());
                    if (target.name() != null) {
                        element.put("name", target.name());
                    }
                }
                case "getByTestId" -> element.put("testId", target.value());
                case "getByLabel" -> element.put("label", target.value());
                case "getByPlaceholder" -> element.put("placeholder", target.value());
                case "getByText" -> element.put("text", target.value());
                default -> { }
            }
            if (calls.size() > 1 && "getByRole".equals(calls.get(0).method())) {
                Map<String, Object> scope = new LinkedHashMap<>();
                scope.put("role", calls.get(0).value());
                if (calls.get(0).name() != null) {
                    scope.put("name", calls.get(0).name());
                }
                element.put("scope", scope);
            }
        }
        element.putIfAbsent("kind", "요소");
        element.put("selector", selector);
        if (fragile) {
            element.put("duplicate", true);
        }
        element.put("verification", fragile ? "UNVERIFIED" : "OBSERVED");
        element.put("recorded", true);
        return element;
    }

    /**
     * 화면 요소 목록에 녹화 요소를 맞춘다. 같은 요소(키나 셀렉터가 같음)가 있으면 더하지 않고, 아직 안 본(UNVERIFIED)
     * 요소였으면 녹화로 실제 화면에서 봤으므로 OBSERVED 로 올린다. 테스트 결과(PASSED · FAILED)는 건드리지 않는다.
     *
     * @return 목록을 바꿨는지
     */
    static boolean mergeElement(List<Map<String, Object>> elements, Map<String, Object> recorded) {
        // 녹화 요소의 범위(scope) 키는 같은 랜드마크 안의 다른 요소와도 겹치므로 대상 키만 비교한다.
        Map<String, Object> withoutScope = new LinkedHashMap<>(recorded);
        withoutScope.remove("scope");
        List<String> keys = SiteMapPromptService.keysOf(withoutScope);
        for (Map<String, Object> element : elements) {
            boolean same = recorded.get("selector").equals(element.get("selector"))
                    || SiteMapPromptService.keysOf(element).stream().anyMatch(keys::contains);
            if (!same) {
                continue;
            }
            Object v = element.get("verification");
            if ("OBSERVED".equals(recorded.get("verification")) && (v == null || "UNVERIFIED".equals(v))) {
                element.put("verification", "OBSERVED");
                return true;
            }
            return false;
        }
        elements.add(recorded);
        return true;
    }

    private static boolean sameOrigin(URI a, URI b) {
        return a.getScheme() != null && a.getScheme().equalsIgnoreCase(b.getScheme())
                && a.getHost() != null && a.getHost().equalsIgnoreCase(b.getHost())
                && port(a) == port(b);
    }

    private static int port(URI u) {
        if (u.getPort() != -1) {
            return u.getPort();
        }
        return "https".equalsIgnoreCase(u.getScheme()) ? 443 : 80;
    }

    private static String absoluteUrl(String url, String baseUrl) {
        try {
            URI u = URI.create(url.trim());
            if (u.isAbsolute() || baseUrl == null || baseUrl.isBlank()) {
                return url.length() > 1000 ? null : url;
            }
            String resolved = URI.create(baseUrl.trim()).resolve(u).toString();
            return resolved.length() > 1000 ? null : resolved;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private List<Map<String, Object>> readElements(String json) {
        try {
            return json == null || json.isBlank() ? new ArrayList<>()
                    : new ArrayList<>(objectMapper.readValue(json, new TypeReference<List<Map<String, Object>>>() {}));
        } catch (IOException e) {
            return new ArrayList<>();
        }
    }
}
