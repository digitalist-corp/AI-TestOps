package com.playops.api.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.entity.ScenarioOrigin;
import com.playops.api.entity.SiteNode;
import com.playops.api.entity.SiteNodeEdit;
import com.playops.api.repository.ScenarioOriginRepository;
import com.playops.api.repository.SiteNodeEditRepository;
import com.playops.api.repository.SiteNodeRepository;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 저장된 화면 정보를 테스트 생성에 쓴다.
 *
 * 하는 일은 셋이다. 프롬프트에 넣을 화면 정보 만들기, 만들어진 테스트가 그 정보 밖의 셀렉터를
 * 썼는지 대조하기, 어느 테스트가 어느 화면의 셀렉터를 썼는지 기록하기.
 */
@Service
public class SiteMapPromptService {

    /** 프롬프트에 넣는 화면 정보의 상한. 넘으면 남은 화면은 경로만 적는다. */
    static final int MAX_CONTEXT_CHARS = 12_000;

    // 메서드 이름이 1번 그룹이라 따옴표는 2번, 값은 3번이다.
    private static final String Q = "(['\"`])((?:\\\\.|(?!\\2).)*)\\2";
    private static final Pattern SELECTOR_CALL = Pattern.compile(
            "\\b(getByTestId|getByRole|getByLabel|getByPlaceholder|getByText|locator)\\(\\s*" + Q
                    + "(?:\\s*,\\s*\\{[^}]*?\\bname\\s*:\\s*(['\"`])((?:\\\\.|(?!\\4).)*)\\4)?");

    private final SiteNodeRepository nodeRepository;
    private final SiteNodeEditRepository editRepository;
    private final ScenarioOriginRepository originRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public SiteMapPromptService(SiteNodeRepository nodeRepository, SiteNodeEditRepository editRepository,
                                ScenarioOriginRepository originRepository) {
        this.nodeRepository = nodeRepository;
        this.editRepository = editRepository;
        this.originRepository = originRepository;
    }

    // ---------------------------------------------------------------- 프롬프트에 넣을 화면 정보

    /**
     * @param routeKeys 고른 화면. 비어 있으면 제외하지 않은 모든 화면을 상한까지 넣는다.
     * @return 분석 결과가 없으면 빈 문자열
     */
    public String context(String projectId, List<String> routeKeys) {
        List<SiteNode> nodes = usableNodes(projectId);
        if (nodes.isEmpty()) {
            return "";
        }
        boolean picked = routeKeys != null && !routeKeys.isEmpty();
        StringBuilder sb = new StringBuilder();
        List<String> pathOnly = new ArrayList<>();
        for (SiteNode node : nodes) {
            if (picked && !routeKeys.contains(node.getRouteKey())) {
                pathOnly.add(node.getRouteKey());
                continue;
            }
            String block = describe(node);
            if (sb.length() + block.length() > MAX_CONTEXT_CHARS) {
                pathOnly.add(node.getRouteKey());
                continue;
            }
            sb.append(block);
        }
        if (!pathOnly.isEmpty()) {
            sb.append("그 밖의 화면(경로만): ").append(String.join(", ", pathOnly)).append('\n');
        }
        return sb.toString();
    }

    /** 채팅 도구용: 화면 목록 한 줄씩. */
    public String overview(String projectId) {
        List<SiteNode> nodes = usableNodes(projectId);
        if (nodes.isEmpty()) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (SiteNode node : nodes) {
            sb.append(node.getRouteKey());
            if (node.getTitle() != null) {
                sb.append(" (").append(node.getTitle()).append(')');
            }
            sb.append(" — 요소 ").append(read(node.getElements()).size()).append("개\n");
        }
        return sb.toString();
    }

    private List<SiteNode> usableNodes(String projectId) {
        Set<String> excluded = new HashSet<>();
        for (SiteNodeEdit edit : editRepository.findByProjectId(projectId)) {
            if (edit.isExcluded()) {
                excluded.add(edit.getRouteKey());
            }
        }
        return nodeRepository.findByProjectIdOrderByRouteKey(projectId).stream()
                .filter(node -> !node.isStale() && !excluded.contains(node.getRouteKey()))
                .toList();
    }

    private String describe(SiteNode node) {
        StringBuilder sb = new StringBuilder("화면 ").append(node.getRouteKey());
        if (node.getTitle() != null) {
            sb.append(" (").append(node.getTitle()).append(')');
        }
        if (Boolean.TRUE.equals(node.getAuthRequired())) {
            sb.append(" · 로그인 필요");
        }
        sb.append('\n');
        for (Map<String, Object> element : read(node.getElements())) {
            if (!(element.get("selector") instanceof String selector)) {
                continue;
            }
            sb.append("- ").append(element.get("kind") == null ? "요소" : element.get("kind")).append(": ").append(selector);
            if (Boolean.TRUE.equals(element.get("duplicate"))) {
                sb.append("  (같은 셀렉터가 화면에 여러 개 있다)");
            }
            if (Boolean.TRUE.equals(element.get("conditional"))) {
                sb.append("  (조건에 따라 보이거나 목록에서 반복된다)");
            }
            sb.append('\n');
        }
        List<String> targets = new ArrayList<>();
        for (Map<String, Object> link : read(node.getLinks())) {
            if (link.get("to") instanceof String to && !targets.contains(to)) {
                targets.add(to);
            }
        }
        if (!targets.isEmpty()) {
            sb.append("이동: ").append(String.join(", ", targets)).append('\n');
        }
        return sb.append('\n').toString();
    }

    // ---------------------------------------------------------------- 만들어진 테스트 대조

    /** used 는 spec 이 쓴 셀렉터의 키, unknown 은 그중 화면 정보에 없는 것을 사람이 읽을 수 있게 적은 것. */
    public record SelectorCheck(List<String> used, List<String> unknown) {}

    public SelectorCheck check(String projectId, String specContent) {
        Set<String> known = new HashSet<>();
        for (SiteNode node : nodeRepository.findByProjectIdOrderByRouteKey(projectId)) {
            for (Map<String, Object> element : read(node.getElements())) {
                known.addAll(keysOf(element));
            }
        }
        Set<String> used = new LinkedHashSet<>();
        List<String> unknown = new ArrayList<>();
        Matcher m = SELECTOR_CALL.matcher(specContent);
        while (m.find()) {
            String key = selectorKey(m.group(1), unescape(m.group(3)), m.group(5) == null ? null : unescape(m.group(5)));
            if (used.add(key) && !known.contains(key)) {
                unknown.add(m.group().trim() + (m.group().contains("{") ? " })" : ")"));
            }
        }
        return new SelectorCheck(new ArrayList<>(used), unknown);
    }

    /**
     * 셀렉터를 비교할 수 있는 키로 바꾼다. 따옴표 종류나 exact 옵션이 달라도 같은 요소면 같은 키가 된다.
     * locator('css') 는 화면 정보에 없는 방식이라 어떤 요소와도 맞지 않는다.
     */
    static String selectorKey(String method, String value, String name) {
        return switch (method) {
            case "getByTestId" -> "testid|" + value;
            case "getByRole" -> "role|" + value + "|" + (name == null ? "" : name);
            case "getByLabel" -> "label|" + value;
            case "getByPlaceholder" -> "placeholder|" + value;
            case "getByText" -> "text|" + value;
            default -> "css|" + value;
        };
    }

    /** 요소 하나를 가리킬 수 있는 모든 키. 저장된 셀렉터가 testid 여도 label 로 찾은 테스트는 같은 요소를 쓴 것이다. */
    static List<String> keysOf(Map<String, Object> element) {
        List<String> keys = new ArrayList<>();
        if (element.get("testId") instanceof String v) keys.add("testid|" + v);
        if (element.get("role") instanceof String role && element.get("name") instanceof String name) {
            keys.add("role|" + role + "|" + name);
        }
        if (element.get("label") instanceof String v) keys.add("label|" + v);
        if (element.get("placeholder") instanceof String v) keys.add("placeholder|" + v);
        if (element.get("text") instanceof String v) keys.add("text|" + v);
        return keys;
    }

    private static String unescape(String value) {
        return value.replaceAll("\\\\(.)", "$1");
    }

    // ---------------------------------------------------------------- 기록

    public void recordOrigin(String projectId, String specPath, List<String> routeKeys, List<String> selectorKeys) {
        try {
            ScenarioOrigin origin = originRepository.findByProjectIdAndSpecPath(projectId, specPath)
                    .orElseGet(ScenarioOrigin::new);
            origin.setProjectId(projectId);
            origin.setSpecPath(specPath);
            origin.setRouteKeys(objectMapper.writeValueAsString(routeKeys == null ? List.of() : routeKeys));
            origin.setSelectorKeys(objectMapper.writeValueAsString(selectorKeys));
            origin.setUpdatedAt(Instant.now());
            originRepository.save(origin);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private List<Map<String, Object>> read(String json) {
        try {
            return json == null || json.isBlank() ? List.of() : objectMapper.readValue(json, new TypeReference<>() {});
        } catch (IOException e) {
            return List.of();
        }
    }
}
