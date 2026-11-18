package com.playops.api.service;

import com.playops.api.dto.ScenarioCaseNode;
import com.playops.api.dto.ScenarioSpecFile;
import com.playops.api.dto.ScenarioTreeResponse;
import com.playops.api.entity.ScenarioCaseSetting;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ScenarioCaseSettingRepository;
import com.playops.api.util.PlaywrightGrep;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Service
public class PlaywrightScenarioService {

    private static final Pattern DESCRIBE_PATTERN = Pattern.compile(
            "test\\.describe(?:\\.only|\\.skip)?\\s*\\(\\s*['\"`]([^'\"`]+)['\"`]"
    );
    private static final Pattern TEST_PATTERN = Pattern.compile(
            "test(?:\\.only|\\.skip)?\\s*\\(\\s*['\"`]([^'\"`]+)['\"`]"
    );
    private static final Pattern NAMED_FUNCTION_PATTERN = Pattern.compile(
            ",\\s*(?:async\\s+)?function\\s+([A-Za-z_$][\\w$]*)\\b"
    );
    private static final Pattern REFERENCED_CALLBACK_PATTERN = Pattern.compile(
            "^,\\s*(?!async\\b)([A-Za-z_$][\\w$]*)\\s*(?:[,)]|$)"
    );

    private final FileStorageService fileStorageService;
    private final ProjectService projectService;
    private final ScenarioCaseSettingRepository scenarioCaseSettingRepository;

    public PlaywrightScenarioService(
            FileStorageService fileStorageService,
            ProjectService projectService,
            ScenarioCaseSettingRepository scenarioCaseSettingRepository
    ) {
        this.fileStorageService = fileStorageService;
        this.projectService = projectService;
        this.scenarioCaseSettingRepository = scenarioCaseSettingRepository;
    }

    public ScenarioTreeResponse analyze(String projectId) {
        projectService.getProject(projectId);
        Map<String, ScenarioCaseSetting> settings = scenarioCaseSettingRepository.findByProjectId(projectId).stream()
                .collect(Collectors.toMap(
                        setting -> settingKey(setting.getNodeType(), setting.getSpecPath(), setting.getGrepFilter()),
                        Function.identity(),
                        (left, right) -> right
                ));
        List<String> files = fileStorageService.listFiles(projectId).stream()
                .filter(this::isSpecFile)
                .toList();

        List<ScenarioSpecFile> specs = new ArrayList<>();
        int totalCases = 0;

        for (String path : files) {
            try {
                String content = fileStorageService.readFile(projectId, path);
                List<ScenarioCaseNode> cases = parseSpec(content, path, settings);
                int count = countTests(cases);
                totalCases += count;
                specs.add(new ScenarioSpecFile(path, count, enabled(settings, "SPEC", path, ""), cases));
            } catch (Exception ignored) {
                specs.add(new ScenarioSpecFile(path, 0, enabled(settings, "SPEC", path, ""), List.of()));
            }
        }

        return new ScenarioTreeResponse(projectId, specs.size(), totalCases, specs);
    }

    public void updateUsage(String projectId, String nodeType, String specPath, String grep, Boolean enabled) {
        projectService.getProject(projectId);
        String normalizedType = normalizeNodeType(nodeType);
        String normalizedPath = normalizeSpecPath(specPath);
        String normalizedGrep = "SPEC".equals(normalizedType) ? "" : normalizeGrep(grep);

        ScenarioCaseSetting setting = scenarioCaseSettingRepository
                .findByProjectIdAndNodeTypeAndSpecPathAndGrepFilter(
                        projectId,
                        normalizedType,
                        normalizedPath,
                        normalizedGrep
                )
                .orElseGet(ScenarioCaseSetting::new);
        setting.setProjectId(projectId);
        setting.setNodeType(normalizedType);
        setting.setSpecPath(normalizedPath);
        setting.setGrepFilter(normalizedGrep);
        setting.setEnabled(enabled);
        scenarioCaseSettingRepository.save(setting);
    }

    /** 꺼 둔 묶음 · 케이스를 빼는 --grep-invert 패턴들 (JS 정규식, #135). 묶음은 그 아래 전부, 케이스는 그 제목만. */
    public List<String> disabledGrepPatterns(String projectId, List<String> specPaths) {
        Set<String> selectedSpecs = specPaths == null || specPaths.isEmpty()
                ? Set.of()
                : specPaths.stream().map(this::normalizeSpecPath).collect(Collectors.toSet());

        return scenarioCaseSettingRepository.findByProjectId(projectId).stream()
                .filter(setting -> !setting.getEnabled())
                .filter(setting -> !"SPEC".equals(setting.getNodeType()))
                .filter(setting -> setting.getGrepFilter() != null && !setting.getGrepFilter().isBlank())
                .filter(setting -> selectedSpecs.isEmpty() || selectedSpecs.contains(normalizeSpecPath(setting.getSpecPath())))
                .map(setting -> "DESCRIBE".equals(setting.getNodeType())
                        ? PlaywrightGrep.describeTitle(setting.getGrepFilter())
                        : PlaywrightGrep.testTitle(setting.getGrepFilter()))
                .distinct()
                .toList();
    }

    public List<String> enabledSpecPaths(String projectId) {
        projectService.getProject(projectId);
        Set<String> disabledSpecs = scenarioCaseSettingRepository.findByProjectId(projectId).stream()
                .filter(setting -> !setting.getEnabled())
                .filter(setting -> "SPEC".equals(setting.getNodeType()))
                .map(setting -> normalizeSpecPath(setting.getSpecPath()))
                .collect(Collectors.toSet());

        return fileStorageService.listFiles(projectId).stream()
                .filter(this::isSpecFile)
                .map(this::normalizeSpecPath)
                .filter(path -> !disabledSpecs.contains(path))
                .toList();
    }

    private boolean isSpecFile(String path) {
        return path.endsWith(".spec.ts") || path.endsWith(".spec.js")
                || path.endsWith(".spec.tsx") || path.endsWith(".spec.jsx");
    }

    private List<ScenarioCaseNode> parseSpec(String content, String filePath, Map<String, ScenarioCaseSetting> settings) {
        String[] lines = content.split("\n", -1);
        List<MutableNode> roots = new ArrayList<>();
        List<MutableFrame> stack = new ArrayList<>();
        int braceDepth = 0;

        for (int i = 0; i < lines.length; i++) {
            String line = lines[i].trim();
            int lineNum = i + 1;

            Matcher describeMatcher = DESCRIBE_PATTERN.matcher(line);
            if (describeMatcher.find()) {
                String title = describeMatcher.group(1);
                MutableNode node = new MutableNode("DESCRIBE", title, null, lineNum, buildGrep(stack, title));
                if (stack.isEmpty()) {
                    roots.add(node);
                } else {
                    stack.get(stack.size() - 1).node.children.add(node);
                }
                stack.add(new MutableFrame(node, title, braceDepth));
                braceDepth += braceDelta(line);
                continue;
            }

            Matcher testMatcher = TEST_PATTERN.matcher(line);
            if (testMatcher.find() && !line.contains("test.describe")) {
                String title = testMatcher.group(1);
                String sourceName = extractSourceName(line, testMatcher.end());
                MutableNode node = new MutableNode("TEST", title, sourceName, lineNum, buildGrep(stack, title));
                if (stack.isEmpty()) {
                    roots.add(node);
                } else {
                    stack.get(stack.size() - 1).node.children.add(node);
                }
            }

            braceDepth += braceDelta(line);
            while (!stack.isEmpty() && braceDepth <= stack.get(stack.size() - 1).closeDepth) {
                stack.remove(stack.size() - 1);
            }
        }

        return roots.stream().map(node -> toDto(node, filePath, settings)).toList();
    }

    private String extractSourceName(String line, int titleEndIndex) {
        String tail = line.substring(titleEndIndex);
        Matcher namedFunctionMatcher = NAMED_FUNCTION_PATTERN.matcher(tail);
        if (namedFunctionMatcher.find()) {
            return namedFunctionMatcher.group(1);
        }

        Matcher referencedCallbackMatcher = REFERENCED_CALLBACK_PATTERN.matcher(tail);
        if (referencedCallbackMatcher.find()) {
            return referencedCallbackMatcher.group(1);
        }

        return null;
    }

    private int braceDelta(String line) {
        int delta = 0;
        boolean inSingleQuote = false;
        boolean inDoubleQuote = false;
        boolean inTemplate = false;
        boolean escaped = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (escaped) {
                escaped = false;
                continue;
            }
            if (c == '\\') {
                escaped = true;
                continue;
            }
            if (c == '\'' && !inDoubleQuote && !inTemplate) {
                inSingleQuote = !inSingleQuote;
                continue;
            }
            if (c == '"' && !inSingleQuote && !inTemplate) {
                inDoubleQuote = !inDoubleQuote;
                continue;
            }
            if (c == '`' && !inSingleQuote && !inDoubleQuote) {
                inTemplate = !inTemplate;
                continue;
            }
            if (inSingleQuote || inDoubleQuote || inTemplate) {
                continue;
            }
            if (c == '{') {
                delta++;
            } else if (c == '}') {
                delta--;
            }
        }
        return delta;
    }

    private ScenarioCaseNode toDto(MutableNode n, String specPath, Map<String, ScenarioCaseSetting> settings) {
        return new ScenarioCaseNode(
                n.type,
                n.title,
                n.sourceName,
                n.line,
                n.grep,
                enabled(settings, n.type, specPath, n.grep),
                n.children.stream().map(child -> toDto(child, specPath, settings)).toList()
        );
    }

    private boolean enabled(Map<String, ScenarioCaseSetting> settings, String nodeType, String specPath, String grep) {
        ScenarioCaseSetting setting = settings.get(settingKey(nodeType, specPath, grep));
        return setting == null || setting.getEnabled();
    }

    private String settingKey(String nodeType, String specPath, String grep) {
        return normalizeNodeType(nodeType) + "\u0000" + normalizeSpecPath(specPath) + "\u0000" + (grep != null ? grep : "");
    }

    private String normalizeNodeType(String nodeType) {
        String value = nodeType != null ? nodeType.trim().toUpperCase() : "";
        if (!Set.of("SPEC", "DESCRIBE", "TEST").contains(value)) {
            throw new ApiException(400, "Invalid scenario node type");
        }
        return value;
    }

    private String normalizeSpecPath(String specPath) {
        if (specPath == null || specPath.isBlank()) {
            throw new ApiException(400, "Invalid spec path");
        }
        String normalized = specPath.replace('\\', '/').trim();
        if (normalized.startsWith("/") || normalized.contains("../") || normalized.equals("..") || normalized.startsWith("-")) {
            throw new ApiException(400, "Invalid spec path");
        }
        return normalized;
    }

    private String normalizeGrep(String grep) {
        if (grep == null || grep.isBlank()) {
            throw new ApiException(400, "Invalid scenario grep");
        }
        return grep;
    }

    private String buildGrep(List<MutableFrame> stack, String title) {
        List<String> parts = new ArrayList<>();
        for (MutableFrame frame : stack) {
            parts.add(frame.title);
        }
        parts.add(title);
        return String.join(" ", parts);
    }

    private int countTests(List<ScenarioCaseNode> nodes) {
        int count = 0;
        for (ScenarioCaseNode node : nodes) {
            if ("TEST".equals(node.type())) {
                count++;
            }
            count += countTests(node.children());
        }
        return count;
    }

    private static class MutableNode {
        final String type;
        final String title;
        final String sourceName;
        final int line;
        final String grep;
        final List<MutableNode> children = new ArrayList<>();

        MutableNode(String type, String title, String sourceName, int line, String grep) {
            this.type = type;
            this.title = title;
            this.sourceName = sourceName;
            this.line = line;
            this.grep = grep;
        }
    }

    private record MutableFrame(MutableNode node, String title, int closeDepth) {}
}
