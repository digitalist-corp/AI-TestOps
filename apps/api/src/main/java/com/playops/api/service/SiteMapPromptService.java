package com.playops.api.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.entity.ScenarioOrigin;
import com.playops.api.entity.SiteLayout;
import com.playops.api.entity.SiteNode;
import com.playops.api.entity.SiteNodeEdit;
import com.playops.api.repository.ScenarioOriginRepository;
import com.playops.api.repository.SiteLayoutRepository;
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
    private final SiteLayoutRepository layoutRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public SiteMapPromptService(SiteNodeRepository nodeRepository, SiteNodeEditRepository editRepository,
                                ScenarioOriginRepository originRepository, SiteLayoutRepository layoutRepository) {
        this.layoutRepository = layoutRepository;
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
        List<String> described = new ArrayList<>();
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
            described.add(node.getRouteKey());
        }
        sb.append(describeLayouts(projectId, described, MAX_CONTEXT_CHARS - sb.length()));
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

    /** 자세히 적은 화면을 감싸는 공용 영역. 메뉴로 다른 화면에 가는 테스트를 만들 때 쓴다. */
    private String describeLayouts(String projectId, List<String> describedRoutes, int budget) {
        StringBuilder sb = new StringBuilder();
        for (SiteLayout layout : layoutRepository.findByProjectId(projectId)) {
            List<String> routes = readStrings(layout.getRouteKeys());
            if (routes.stream().noneMatch(describedRoutes::contains)) {
                continue;
            }
            StringBuilder block = new StringBuilder("공용 영역 — 다음 화면에서 항상 보인다: ")
                    .append(String.join(", ", routes)).append('\n');
            for (Map<String, Object> element : read(layout.getElements())) {
                if (element.get("selector") instanceof String selector) {
                    block.append("- ").append(element.get("kind") == null ? "요소" : element.get("kind"))
                            .append(": ").append(selector).append('\n');
                }
            }
            for (Map<String, Object> link : read(layout.getLinks())) {
                if (link.get("to") instanceof String to && link.get("selector") instanceof String selector) {
                    block.append("이동: ").append(selector).append(" → ").append(to).append('\n');
                }
            }
            block.append('\n');
            if (sb.length() + block.length() <= budget) {
                sb.append(block);
            }
        }
        return sb.toString();
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
        for (SiteLayout layout : layoutRepository.findByProjectId(projectId)) {
            for (Map<String, Object> element : read(layout.getElements())) {
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

    // ---------------------------------------------------------------- 실행 결과로 확인

    /** 테스트 케이스 하나의 결과. file 은 Playwright 리포트에 적힌 spec 경로다. */
    public record CaseOutcome(String file, String status, String errorMessage) {}

    /**
     * 실행 결과로 요소의 확인 상태를 바꾼다. 코드에서 뽑은 셀렉터는 실제 화면에서 본 적이 없으므로
     * 여기서 처음으로 맞는지 틀린지가 가려진다.
     *
     * - spec 의 케이스가 모두 통과했으면 그 spec 이 쓴 셀렉터는 전부 PASSED.
     * - 실패한 케이스가 있으면, 오류 메시지에 적힌 셀렉터만 FAILED 로 바꾼다. 나머지는 통과했는지
     *   알 수 없으므로 건드리지 않는다.
     */
    public void applyResults(String projectId, List<CaseOutcome> outcomes) {
        List<SiteNode> nodes = null;
        Set<SiteNode> changed = new LinkedHashSet<>();
        for (ScenarioOrigin origin : originRepository.findByProjectId(projectId)) {
            List<CaseOutcome> mine = outcomes.stream()
                    .filter(o -> o.file() != null
                            && (origin.getSpecPath().equals(o.file()) || origin.getSpecPath().endsWith("/" + o.file())))
                    .filter(o -> !"SKIPPED".equals(o.status()))
                    .toList();
            if (mine.isEmpty()) {
                continue;
            }
            Set<String> used = new HashSet<>(readStrings(origin.getSelectorKeys()));
            Set<String> failed = new HashSet<>();
            boolean anyFailed = false;
            for (CaseOutcome outcome : mine) {
                if ("FAILED".equals(outcome.status())) {
                    anyFailed = true;
                    failed.addAll(keysIn(outcome.errorMessage()));
                }
            }
            failed.retainAll(used);
            Set<String> target = anyFailed ? failed : used;
            String status = anyFailed ? "FAILED" : "PASSED";
            if (target.isEmpty()) {
                continue;
            }
            if (nodes == null) {
                nodes = nodeRepository.findByProjectIdOrderByRouteKey(projectId);
            }
            List<String> routes = readStrings(origin.getRouteKeys());
            for (SiteNode node : nodes) {
                if (!routes.isEmpty() && !routes.contains(node.getRouteKey())) {
                    continue; // 화면을 골라 만든 테스트면 그 화면의 요소만 바꾼다.
                }
                List<Map<String, Object>> elements = read(node.getElements());
                boolean touched = false;
                for (Map<String, Object> element : elements) {
                    if (keysOf(element).stream().anyMatch(target::contains) && !status.equals(element.get("verification"))) {
                        element.put("verification", status);
                        touched = true;
                    }
                }
                if (touched) {
                    try {
                        node.setElements(objectMapper.writeValueAsString(elements));
                        changed.add(node);
                    } catch (IOException e) {
                        throw new IllegalStateException(e);
                    }
                }
            }
        }
        if (!changed.isEmpty()) {
            nodeRepository.saveAll(changed);
        }
    }

    /** 글 안에 적힌 셀렉터 호출을 키로 바꾼다 (Playwright 오류 메시지의 "waiting for getByRole(...)" 등). */
    private static Set<String> keysIn(String text) {
        Set<String> keys = new HashSet<>();
        if (text == null) {
            return keys;
        }
        Matcher m = SELECTOR_CALL.matcher(text);
        while (m.find()) {
            keys.add(selectorKey(m.group(1), unescape(m.group(3)), m.group(5) == null ? null : unescape(m.group(5))));
        }
        return keys;
    }

    private List<String> readStrings(String json) {
        try {
            return json == null || json.isBlank() ? List.of() : objectMapper.readValue(json, new TypeReference<>() {});
        } catch (IOException e) {
            return List.of();
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
