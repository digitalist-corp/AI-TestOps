package com.playops.api.chat.tools;

import com.playops.api.chat.ChatTool;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolDisplay;
import com.playops.api.chat.ToolTier;
import com.playops.api.exception.ApiException;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolSpec;
import com.playops.api.service.FileStorageService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.PathMatcher;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * 프로젝트 파일에서 글을 찾는다. (READ)
 *
 * 파일 접근은 FileStorageService 를 그대로 거친다. 그래서 .git · node_modules 같은 폴더는 목록에 없고,
 * .env 같은 비밀 파일은 읽기가 거절돼 건너뛴다.
 */
@Component
public class GrepFilesTool implements ChatTool {

    static final String NAME = "grep_files";

    static final int MAX_LINES = 100;
    private static final int MAX_FILES_SCANNED = 5000;
    private static final long MAX_FILE_BYTES = 1_000_000;
    /** 이보다 긴 줄은 앞부분만 검사한다. 한 줄짜리 번들 파일 때문에 시간이 늘어지지 않게. */
    private static final int MAX_MATCH_LINE_CHARS = 2000;
    private static final int MAX_SHOWN_LINE_CHARS = 300;
    private static final long DEFAULT_TIMEOUT_MILLIS = 3000;

    private final FileStorageService fileStorageService;
    private final long timeoutMillis;
    private final LlmToolSpec spec;

    @Autowired
    public GrepFilesTool(FileStorageService fileStorageService) {
        this(fileStorageService, DEFAULT_TIMEOUT_MILLIS);
    }

    GrepFilesTool(FileStorageService fileStorageService, long timeoutMillis) {
        this.fileStorageService = fileStorageService;
        this.timeoutMillis = timeoutMillis;

        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("pattern", LlmToolSpec.string(
                "찾을 글. 정규식으로 해석하고, 정규식이 아니면 그냥 글자로 찾는다. 예: getByRole\\('button'"));
        properties.put("glob", LlmToolSpec.string(
                "찾을 파일을 좁히는 글롭. 예: tests/**/*.ts. 비우면 프로젝트 전체"));
        this.spec = new LlmToolSpec(
                NAME,
                "프로젝트 파일 안에서 글이나 정규식을 찾아 '경로:줄번호: 내용' 으로 보여준다(최대 " + MAX_LINES + "줄). "
                        + "어느 파일에서 어떤 셀렉터나 함수를 쓰는지 찾을 때 쓴다. 파일 전체가 필요하면 찾은 뒤 read_file 로 읽는다.",
                LlmToolSpec.schema(ToolSupport.withProjectId(properties), "pattern"));
    }

    @Override
    public LlmToolSpec spec() {
        return spec;
    }

    @Override
    public ToolTier tier() {
        return ToolTier.READ;
    }

    @Override
    public ChatToolOutput execute(LlmToolCall call, ChatToolContext context) {
        String patternText = call.arg("pattern");
        if (patternText == null) {
            return ChatToolOutput.failed("pattern 인자가 필요합니다.");
        }

        PathFilter filter;
        try {
            filter = PathFilter.of(call.arg("glob"));
        } catch (PatternSyntaxException e) {
            return ChatToolOutput.failed("glob 형식이 올바르지 않습니다: " + e.getDescription());
        }

        try {
            String projectId = ToolSupport.requireProject(call, context);
            return search(projectId, compile(patternText), filter);
        } catch (ApiException e) {
            return ToolSupport.failed(e);
        }
    }

    /** 정규식으로 컴파일하고, 정규식이 아니면 글자 그대로 찾는다. */
    private static Pattern compile(String text) {
        try {
            return Pattern.compile(text);
        } catch (PatternSyntaxException e) {
            return Pattern.compile(Pattern.quote(text));
        }
    }

    private ChatToolOutput search(String projectId, Pattern pattern, PathFilter filter) {
        long deadline = System.nanoTime() + timeoutMillis * 1_000_000;
        List<String> hits = new ArrayList<>();
        List<Map<String, String>> items = new ArrayList<>();
        boolean reachedLimit = false;
        boolean timedOut = false;
        int scanned = 0;

        scan:
        for (String path : fileStorageService.listFiles(projectId)) {
            if (!filter.matches(path)) {
                continue;
            }
            if (++scanned > MAX_FILES_SCANNED) {
                break;
            }
            String text = readSearchable(projectId, path);
            if (text == null) {
                continue;
            }
            String[] lines = text.split("\n", -1);
            for (int i = 0; i < lines.length; i++) {
                String line = lines[i];
                if (line.endsWith("\r")) {
                    line = line.substring(0, line.length() - 1);
                }
                if (line.length() > MAX_MATCH_LINE_CHARS) {
                    line = line.substring(0, MAX_MATCH_LINE_CHARS);
                }
                try {
                    if (!pattern.matcher(new DeadlineSequence(line, deadline)).find()) {
                        continue;
                    }
                } catch (RegexTimeoutException e) {
                    timedOut = true;
                    break scan;
                }
                String shown = ToolSupport.oneLine(line, MAX_SHOWN_LINE_CHARS);
                hits.add(path + ":" + (i + 1) + ": " + shown);
                Map<String, String> item = new LinkedHashMap<>();
                item.put("label", path + ":" + (i + 1));
                item.put("detail", shown);
                items.add(item);
                if (hits.size() >= MAX_LINES) {
                    reachedLimit = true;
                    break scan;
                }
            }
        }

        StringBuilder content = new StringBuilder();
        if (hits.isEmpty()) {
            content.append("맞는 줄이 없습니다.");
        } else {
            content.append(String.join("\n", hits));
        }
        if (reachedLimit) {
            content.append("\n... ").append(MAX_LINES).append("줄에서 멈췄습니다. pattern 이나 glob 을 더 좁혀 보세요.");
        }
        if (timedOut) {
            content.append("\n... 정규식이 너무 오래 걸려 중간에 멈췄습니다. 더 단순한 pattern 을 쓰거나 glob 으로 파일을 좁혀 보세요.");
        }

        String summary = hits.isEmpty() ? "0건" : hits.size() + "건";
        ToolDisplay display = items.isEmpty() ? null : ToolDisplay.of("list", Map.of("items", items));
        return ChatToolOutput.ok(ToolSupport.truncate(content.toString()), summary, display);
    }

    /** 검색할 수 있는 파일이면 내용을, 아니면(너무 크다 · 읽기 제한 · 글이 아님) null 을 돌려준다. */
    private String readSearchable(String projectId, String path) {
        try {
            if (Files.size(fileStorageService.resolveFile(projectId, path)) > MAX_FILE_BYTES) {
                return null;
            }
            String text = fileStorageService.readFile(projectId, path);
            return text.indexOf('\0') >= 0 ? null : text;
        } catch (ApiException | IOException e) {
            // .env 같은 읽기 제한 파일, 심볼릭 링크로 밖을 가리키는 파일, 글자 인코딩이 맞지 않는 바이너리 등
            return null;
        }
    }

    /** glob 으로 파일 경로를 거른다. tests/**&#47;*.ts 는 tests/a.ts 도 맞춘다. */
    private record PathFilter(List<PathMatcher> matchers, boolean matchFileName) {

        static PathFilter of(String glob) {
            if (glob == null) {
                return new PathFilter(List.of(), false);
            }
            String normalized = glob.replace('\\', '/').trim();
            while (normalized.startsWith("./")) {
                normalized = normalized.substring(2);
            }
            List<String> variants = new ArrayList<>();
            variants.add(normalized);
            // 자바 글롭의 **/ 는 폴더가 하나 이상 있어야 맞는다. 사람이 흔히 기대하는 "없어도 됨" 도 맞춘다.
            if (normalized.contains("/**/")) {
                variants.add(normalized.replace("/**/", "/"));
            }
            if (normalized.startsWith("**/")) {
                variants.add(normalized.substring(3));
            }
            List<PathMatcher> matchers = new ArrayList<>();
            for (String variant : variants) {
                matchers.add(FileSystems.getDefault().getPathMatcher("glob:" + variant));
            }
            // 슬래시 없는 글롭(*.ts)은 어느 폴더에 있든 파일 이름으로 맞춘다.
            return new PathFilter(matchers, !normalized.contains("/"));
        }

        boolean matches(String relativePath) {
            if (matchers.isEmpty()) {
                return true;
            }
            try {
                Path path = Path.of(relativePath);
                Path name = path.getFileName();
                for (PathMatcher matcher : matchers) {
                    if (matcher.matches(path) || (matchFileName && name != null && matcher.matches(name))) {
                        return true;
                    }
                }
            } catch (InvalidPathException e) {
                return false;
            }
            return false;
        }
    }

    /** 정규식이 시간 제한을 넘겼을 때. */
    private static final class RegexTimeoutException extends RuntimeException {
        RegexTimeoutException() {
            super("regex timeout", null, false, false);
        }
    }

    /**
     * 모델이 쓴 정규식은 (a+)+b 처럼 끝나지 않는 꼴일 수 있다. 정규식 엔진은 글자를 charAt 으로 읽으므로
     * 여기서 시간을 재 제한을 넘기면 끊는다.
     */
    private static final class DeadlineSequence implements CharSequence {
        private final CharSequence inner;
        private final long deadlineNanos;
        private int reads;

        DeadlineSequence(CharSequence inner, long deadlineNanos) {
            this.inner = inner;
            this.deadlineNanos = deadlineNanos;
        }

        @Override
        public int length() {
            return inner.length();
        }

        @Override
        public char charAt(int index) {
            if ((++reads & 0xFFF) == 0 && System.nanoTime() > deadlineNanos) {
                throw new RegexTimeoutException();
            }
            return inner.charAt(index);
        }

        @Override
        public CharSequence subSequence(int start, int end) {
            return new DeadlineSequence(inner.subSequence(start, end), deadlineNanos);
        }

        @Override
        public String toString() {
            return inner.toString();
        }
    }
}
