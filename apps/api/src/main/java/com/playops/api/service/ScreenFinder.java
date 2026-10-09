package com.playops.api.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * 저장소 코드에서 화면(라우트)과 그 화면의 파일을 찾는다.
 *
 * LLM 을 쓰지 않는다. 폴더 구조와 라우트 정의는 규칙으로 읽을 수 있고, 규칙으로 읽으면
 * 같은 커밋에서 항상 같은 결과가 나온다. 파일은 읽기만 하고 저장소의 코드를 실행하지 않는다.
 */
@Component
public class ScreenFinder {

    public static final String NEXT = "NEXT";
    public static final String REACT_ROUTER = "REACT_ROUTER";

    static final int MAX_SCREENS = 60;
    private static final int MAX_FILE_BYTES = 512 * 1024;
    private static final Set<String> SKIP_DIRS = Set.of(
            "node_modules", "dist", "build", "out", "coverage", ".next", ".git", "__tests__", "test-results");
    private static final List<String> EXTENSIONS = List.of(".tsx", ".ts", ".jsx", ".js");

    private static final Pattern PATH_ATTR = Pattern.compile(
            "\\bpath\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|\\{\\s*[\"'`]([^\"'`]*)[\"'`]\\s*\\})");
    private static final Pattern INDEX_ATTR = Pattern.compile("(?<![\\w-])index(?![\\w-])(?!\\s*=\\s*\\{\\s*false)");
    private static final Pattern COMPONENT_TAG = Pattern.compile("<([A-Z][A-Za-z0-9_]*)");
    private static final Pattern DEFAULT_IMPORT = Pattern.compile(
            "import\\s+([A-Za-z_$][\\w$]*)\\s*(?:,\\s*\\{[^}]*\\})?\\s*from\\s*['\"]([^'\"]+)['\"]");
    private static final Pattern NAMED_IMPORT = Pattern.compile(
            "import\\s+(?:[A-Za-z_$][\\w$]*\\s*,\\s*)?\\{([^}]*)\\}\\s*from\\s*['\"]([^'\"]+)['\"]");
    private static final Pattern LAZY_IMPORT = Pattern.compile(
            "(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:React\\.)?lazy\\(\\s*\\(\\s*\\)\\s*=>\\s*import\\(\\s*['\"]([^'\"]+)['\"]");

    private final ObjectMapper objectMapper = new ObjectMapper();

    /** 화면 하나. routeKey 는 재분석해도 같은 화면을 가리키는 키다 (예: /products/:id). */
    public record Screen(String routeKey, String sourceFile) {}

    public record Result(String framework, String appRoot, List<Screen> screens, boolean partial, List<String> warnings) {}

    public Result find(Path repoRoot) {
        List<String> warnings = new ArrayList<>();
        AppRoot app = findAppRoot(repoRoot, warnings);
        if (app == null) {
            warnings.add("Next.js 나 React Router 를 쓰는 package.json 을 찾지 못했습니다. 지금은 이 둘만 지원합니다.");
            return new Result(null, null, List.of(), false, warnings);
        }

        Map<String, Screen> screens = new LinkedHashMap<>();
        if (NEXT.equals(app.framework())) {
            findNextScreens(repoRoot, app.dir(), screens);
        } else {
            findReactRouterScreens(repoRoot, app.dir(), screens, warnings);
        }

        List<Screen> sorted = new ArrayList<>(screens.values());
        sorted.sort(Comparator.comparing(Screen::routeKey));
        boolean partial = sorted.size() > MAX_SCREENS;
        if (partial) {
            // 상한을 넘으면 경로가 짧은 화면(상위 화면)부터 남긴다.
            sorted.sort(Comparator.comparingInt((Screen s) -> s.routeKey().length()).thenComparing(Screen::routeKey));
            warnings.add("화면이 " + sorted.size() + "개라 상한(" + MAX_SCREENS + ")까지만 분석합니다.");
            sorted = new ArrayList<>(sorted.subList(0, MAX_SCREENS));
            sorted.sort(Comparator.comparing(Screen::routeKey));
        }
        return new Result(app.framework(), relative(repoRoot, app.dir()), sorted, partial, warnings);
    }

    // ---------------------------------------------------------------- 앱 위치 찾기

    private record AppRoot(Path dir, String framework) {}

    /** 모노레포에서도 동작하도록 깊이 3까지 package.json 을 찾고, 가장 얕은 것을 고른다. */
    private AppRoot findAppRoot(Path repoRoot, List<String> warnings) {
        List<AppRoot> found = new ArrayList<>();
        for (Path file : walk(repoRoot, 4)) {
            if (!file.getFileName().toString().equals("package.json")) {
                continue;
            }
            String framework = frameworkOf(file);
            if (framework != null) {
                found.add(new AppRoot(file.getParent(), framework));
            }
        }
        if (found.isEmpty()) {
            return null;
        }
        found.sort(Comparator.comparingInt((AppRoot a) -> a.dir().getNameCount()).thenComparing(a -> a.dir().toString()));
        if (found.size() > 1) {
            // ponytail: 앱이 여러 개인 저장소는 첫 번째만 분석한다. 필요해지면 프로젝트 설정에 하위 폴더를 받는다.
            warnings.add("분석할 수 있는 앱이 " + found.size() + "개 있어 " + relative(repoRoot, found.get(0).dir())
                    + " 만 분석합니다.");
        }
        return found.get(0);
    }

    private String frameworkOf(Path packageJson) {
        try {
            JsonNode root = objectMapper.readTree(read(packageJson));
            for (String section : List.of("dependencies", "devDependencies")) {
                JsonNode deps = root.path(section);
                if (deps.has("next")) {
                    return NEXT;
                }
            }
            for (String section : List.of("dependencies", "devDependencies")) {
                JsonNode deps = root.path(section);
                if (deps.has("react-router-dom") || deps.has("react-router")) {
                    return REACT_ROUTER;
                }
            }
        } catch (IOException | RuntimeException ignored) {
            // 읽을 수 없는 package.json 은 후보에서 뺀다.
        }
        return null;
    }

    // ---------------------------------------------------------------- Next.js

    private void findNextScreens(Path repoRoot, Path appDir, Map<String, Screen> screens) {
        for (String base : List.of("app", "src/app")) {
            Path dir = appDir.resolve(base);
            for (Path file : walk(dir, 20)) {
                String name = file.getFileName().toString();
                if (!name.matches("page\\.(tsx|jsx|ts|js)")) {
                    continue;
                }
                String route = nextRoute(dir.relativize(file.getParent()), true);
                if (route != null) {
                    screens.put(route, new Screen(route, relative(repoRoot, file)));
                }
            }
        }
        for (String base : List.of("pages", "src/pages")) {
            Path dir = appDir.resolve(base);
            for (Path file : walk(dir, 20)) {
                String name = file.getFileName().toString();
                if (!name.matches("[^_].*\\.(tsx|jsx|ts|js)") || name.contains(".test.") || name.contains(".spec.")) {
                    continue;
                }
                Path rel = dir.relativize(file);
                if (rel.getNameCount() > 0 && rel.getName(0).toString().equals("api")) {
                    continue;
                }
                String stem = name.substring(0, name.lastIndexOf('.'));
                Path routePath = stem.equals("index")
                        ? (rel.getParent() == null ? Path.of("") : rel.getParent())
                        : (rel.getParent() == null ? Path.of(stem) : rel.getParent().resolve(stem));
                String route = nextRoute(routePath, false);
                if (route != null) {
                    screens.putIfAbsent(route, new Screen(route, relative(repoRoot, file)));
                }
            }
        }
    }

    /** 폴더 경로를 라우트로 바꾼다. (group) 은 빼고 [id] 는 :id 로 쓴다. 화면이 아닌 폴더면 null. */
    private String nextRoute(Path relativeDir, boolean appRouter) {
        StringBuilder route = new StringBuilder();
        for (Path part : relativeDir) {
            String segment = part.toString();
            if (segment.isEmpty()) {
                continue;
            }
            if (appRouter && segment.startsWith("(") && segment.endsWith(")")) {
                continue;
            }
            if (segment.startsWith("@") || segment.startsWith("_")) {
                return null;
            }
            if (segment.startsWith("[[...") && segment.endsWith("]]")) {
                segment = ":" + segment.substring(5, segment.length() - 2) + "*";
            } else if (segment.startsWith("[...") && segment.endsWith("]")) {
                segment = ":" + segment.substring(4, segment.length() - 1) + "*";
            } else if (segment.startsWith("[") && segment.endsWith("]")) {
                segment = ":" + segment.substring(1, segment.length() - 1);
            }
            route.append('/').append(segment);
        }
        return route.isEmpty() ? "/" : route.toString();
    }

    // ---------------------------------------------------------------- React Router

    private void findReactRouterScreens(Path repoRoot, Path appDir, Map<String, Screen> screens, List<String> warnings) {
        Path srcDir = Files.isDirectory(appDir.resolve("src")) ? appDir.resolve("src") : appDir;
        boolean sawObjectRoutes = false;
        for (Path file : walk(srcDir, 20)) {
            String name = file.getFileName().toString();
            if (EXTENSIONS.stream().noneMatch(name::endsWith) || name.contains(".test.") || name.contains(".spec.")) {
                continue;
            }
            String source;
            try {
                source = read(file);
            } catch (IOException e) {
                continue;
            }
            if (source.contains("createBrowserRouter") || source.contains("useRoutes(")) {
                sawObjectRoutes = true;
            }
            if (!source.contains("<Route")) {
                continue;
            }
            Map<String, String> imports = importsOf(source);
            // 한 파일 안에서는 뒤에 나온 정의가 이긴다 (레이아웃 라우트 안의 index 라우트가 실제 화면이다).
            Map<String, Path> inThisFile = new LinkedHashMap<>();
            for (RouteTag route : parseRoutes(source)) {
                String resolved = resolveImport(appDir, file, imports.get(route.component()));
                inThisFile.put(route.path(), resolved != null ? Path.of(resolved) : file);
            }
            for (Map.Entry<String, Path> entry : inThisFile.entrySet()) {
                Screen existing = screens.get(entry.getKey());
                // 같은 경로가 다른 파일에도 있으면, 라우트를 다시 품은 껍데기(<App> 등)가 아닌 쪽이 화면이다.
                if (existing == null || (isRouterShell(repoRoot.resolve(existing.sourceFile()))
                        && !isRouterShell(entry.getValue()))) {
                    screens.put(entry.getKey(), new Screen(entry.getKey(), relative(repoRoot, entry.getValue())));
                }
            }
        }
        if (screens.isEmpty() && sawObjectRoutes) {
            // ponytail: 객체로 쓴 라우트(createBrowserRouter([...]))는 아직 읽지 않는다. 요소 추출에 LLM 이 붙을 때 함께 넣는다.
            warnings.add("라우트를 객체로 정의한 프로젝트는 아직 지원하지 않습니다 (<Route> 로 쓴 정의만 읽습니다).");
        }
    }

    private static boolean isRouterShell(Path file) {
        try {
            return read(file).contains("<Route");
        } catch (IOException e) {
            return false;
        }
    }

    record RouteTag(String path, String component) {}

    /**
     * 소스에서 &lt;Route&gt; 태그를 순서대로 읽어 중첩된 경로를 합친다.
     * element={...} 안에 &gt; 와 중괄호가 섞여 있어 정규식으로는 태그 끝을 찾을 수 없으므로 한 글자씩 읽는다.
     */
    List<RouteTag> parseRoutes(String source) {
        List<RouteTag> routes = new ArrayList<>();
        Deque<String> parents = new ArrayDeque<>();
        int i = 0;
        while (i < source.length()) {
            int open = source.indexOf("<Route", i);
            int close = source.indexOf("</Route>", i);
            if (close >= 0 && (open < 0 || close < open)) {
                if (!parents.isEmpty()) {
                    parents.pop();
                }
                i = close + "</Route>".length();
                continue;
            }
            if (open < 0) {
                break;
            }
            int afterName = open + "<Route".length();
            if (afterName >= source.length() || !isTagBoundary(source.charAt(afterName))) {
                i = afterName; // <Routes>, <RouterProvider> 등
                continue;
            }
            int end = tagEnd(source, afterName);
            if (end < 0) {
                break;
            }
            String attrs = source.substring(afterName, end);
            boolean selfClosing = attrs.stripTrailing().endsWith("/");
            String element = braceValue(attrs, "element");
            for (String name : List.of("Component", "component")) { // component 는 React Router v5 이하
                if (element == null) {
                    element = braceValue(attrs, name);
                }
            }
            String plain = element == null ? attrs : attrs.replace(element, "");
            Matcher pathMatcher = PATH_ATTR.matcher(plain);
            String path = pathMatcher.find() ? firstGroup(pathMatcher) : null;
            boolean index = INDEX_ATTR.matcher(plain).find();
            String parentPath = parents.isEmpty() ? "" : parents.peek();
            String fullPath = index ? joinPath(parentPath, "") : path == null ? parentPath : joinPath(parentPath, path);

            String component = componentOf(element);
            boolean hasPath = path != null || index;
            if (hasPath && component != null && !fullPath.contains("*")) {
                routes.add(new RouteTag(fullPath.isEmpty() ? "/" : fullPath, component));
            }
            if (!selfClosing) {
                parents.push(fullPath);
            }
            i = end + 1;
        }
        return routes;
    }

    private static boolean isTagBoundary(char c) {
        return Character.isWhitespace(c) || c == '>' || c == '/';
    }

    /** 중괄호와 따옴표 밖에서 처음 만나는 &gt; 의 위치. */
    private static int tagEnd(String source, int from) {
        int depth = 0;
        char quote = 0;
        for (int j = from; j < source.length(); j++) {
            char c = source.charAt(j);
            if (quote != 0) {
                if (c == quote && source.charAt(j - 1) != '\\') {
                    quote = 0;
                }
            } else if (c == '"' || c == '\'' || c == '`') {
                quote = c;
            } else if (c == '{') {
                depth++;
            } else if (c == '}') {
                depth--;
            } else if (c == '>' && depth == 0) {
                return j;
            }
        }
        return -1;
    }

    /** name={...} 의 중괄호 안쪽 전체(중괄호 포함). 없으면 null. */
    private static String braceValue(String attrs, String name) {
        Matcher m = Pattern.compile("(?<![\\w-])" + name + "\\s*=\\s*\\{").matcher(attrs);
        if (!m.find()) {
            return null;
        }
        int start = m.end() - 1;
        int depth = 0;
        for (int j = start; j < attrs.length(); j++) {
            char c = attrs.charAt(j);
            if (c == '{') {
                depth++;
            } else if (c == '}' && --depth == 0) {
                return attrs.substring(start, j + 1);
            }
        }
        return null;
    }

    /**
     * element 안에서 화면 컴포넌트 이름을 고른다. 감싸는 컴포넌트(&lt;Guard&gt;&lt;Page/&gt;&lt;/Guard&gt;)가 있으면
     * 가장 안쪽이 화면이므로 마지막 태그를 쓴다. 다른 곳으로 보내기만 하는 라우트(Navigate)는 화면이 아니다.
     */
    private static String componentOf(String element) {
        if (element == null) {
            return null;
        }
        String body = element.substring(1, element.length() - 1).trim();
        if (!body.startsWith("<")) {
            return body.matches("[A-Z][A-Za-z0-9_]*") ? body : null; // Component={Page}
        }
        String last = null;
        Matcher m = COMPONENT_TAG.matcher(body);
        while (m.find()) {
            last = m.group(1);
        }
        return "Navigate".equals(last) ? null : last;
    }

    private static String firstGroup(Matcher m) {
        for (int g = 1; g <= m.groupCount(); g++) {
            if (m.group(g) != null) {
                return m.group(g);
            }
        }
        return null;
    }

    static String joinPath(String parent, String child) {
        String joined = child.startsWith("/") ? child : parent + "/" + child;
        joined = joined.replaceAll("/{2,}", "/");
        if (joined.length() > 1 && joined.endsWith("/")) {
            joined = joined.substring(0, joined.length() - 1);
        }
        return joined.startsWith("/") ? joined : "/" + joined;
    }

    /** 컴포넌트 이름 → import 경로. */
    private static Map<String, String> importsOf(String source) {
        Map<String, String> imports = new LinkedHashMap<>();
        Matcher named = NAMED_IMPORT.matcher(source);
        while (named.find()) {
            for (String item : named.group(1).split(",")) {
                String[] parts = item.trim().replaceFirst("^type\\s+", "").split("\\s+as\\s+");
                String local = parts[parts.length - 1].trim();
                if (!local.isEmpty()) {
                    imports.put(local, named.group(2));
                }
            }
        }
        Matcher def = DEFAULT_IMPORT.matcher(source);
        while (def.find()) {
            imports.put(def.group(1), def.group(2));
        }
        Matcher lazy = LAZY_IMPORT.matcher(source);
        while (lazy.find()) {
            imports.put(lazy.group(1), lazy.group(2));
        }
        return imports;
    }

    /** import 경로를 실제 파일로 바꾼다. 패키지이거나 찾지 못하면 null. */
    private static String resolveImport(Path appDir, Path fromFile, String spec) {
        if (spec == null) {
            return null;
        }
        Path base;
        if (spec.startsWith(".")) {
            base = fromFile.getParent().resolve(spec);
        } else if (spec.startsWith("@/") || spec.startsWith("~/")) {
            base = appDir.resolve("src").resolve(spec.substring(2));
        } else {
            return null;
        }
        base = base.normalize();
        if (!base.startsWith(appDir)) {
            return null; // 앱 폴더 밖을 가리키는 경로는 따라가지 않는다.
        }
        List<Path> candidates = new ArrayList<>();
        candidates.add(base);
        for (String ext : EXTENSIONS) {
            candidates.add(base.resolveSibling(base.getFileName() + ext));
        }
        for (String ext : EXTENSIONS) {
            candidates.add(base.resolve("index" + ext));
        }
        for (Path candidate : candidates) {
            if (Files.isRegularFile(candidate) && !Files.isSymbolicLink(candidate)) {
                return candidate.toString();
            }
        }
        return null;
    }

    // ---------------------------------------------------------------- 파일 읽기

    /** 심볼릭 링크는 따라가지 않는다. 저장소 밖의 파일을 읽게 만드는 링크가 있을 수 있다. */
    private static List<Path> walk(Path dir, int maxDepth) {
        if (!Files.isDirectory(dir) || Files.isSymbolicLink(dir)) {
            return List.of();
        }
        try (Stream<Path> stream = Files.walk(dir, maxDepth)) {
            return stream
                    .filter(p -> Files.isRegularFile(p) && !Files.isSymbolicLink(p))
                    .filter(p -> {
                        for (Path part : dir.relativize(p)) {
                            String name = part.toString();
                            if (SKIP_DIRS.contains(name) || (name.startsWith(".") && name.length() > 1)) {
                                return false;
                            }
                        }
                        return true;
                    })
                    .sorted()
                    .toList();
        } catch (IOException e) {
            return List.of();
        }
    }

    private static String read(Path file) throws IOException {
        if (Files.size(file) > MAX_FILE_BYTES) {
            throw new IOException("파일이 너무 큽니다: " + file);
        }
        return Files.readString(file, StandardCharsets.UTF_8);
    }

    private static String relative(Path root, Path path) {
        return root.relativize(path).toString().replace('\\', '/');
    }
}
