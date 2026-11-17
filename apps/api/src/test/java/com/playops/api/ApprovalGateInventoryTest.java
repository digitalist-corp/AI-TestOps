package com.playops.api;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 프로젝트 파일을 바꾸는 길의 목록. (D-03 승인 게이트 일원화)
 *
 * AI 가 만든 변경은 AiJobService.applyDiff 로만 반영되고, 그 호출은 사람의 승인(approve)이거나
 * canAutoApply 를 통과한 자동 적용뿐이다. 프로젝트 파일을 직접 쓰는 다른 호출자는 사람이 하는 작업이다.
 * 새 호출자가 생기면 이 테스트가 깨진다. 승인 게이트를 거치는지 확인한 뒤 목록에 넣는다.
 * 전체 근거는 docs/approval-gate-audit.md.
 */
class ApprovalGateInventoryTest {

    private static final Path MAIN = Path.of("src/main/java/com/playops/api");

    @Test
    void onlyAiJobServiceAppliesAiChanges() throws IOException {
        assertThat(filesCalling("applyDiff\\(")).containsExactly("service/AiJobService.java");

        String aiJobService = Files.readString(MAIN.resolve("service/AiJobService.java"));
        assertThat(count(aiJobService, "applyDiff\\(job, project\\);")).isEqualTo(3); // approve + 자동 적용 2곳
        assertThat(count(aiJobService, "if \\(canAutoApply\\(job, project, assessment\\)\\)")).isEqualTo(2);
    }

    @Test
    void projectFilesAreWrittenOnlyByKnownCallers() throws IOException {
        assertThat(filesCalling("fileStorageService\\.(writeFile|uploadZip|uploadFiles)\\(")).containsExactlyInAnyOrder(
                "controller/ProjectWorkspaceController.java", // 사람이 에디터에서 저장
                "controller/ProjectFileController.java",      // 사람이 업로드
                "recorder/RecorderService.java",              // 사람이 녹화한 테스트 저장
                "service/AiBootstrapService.java"             // 등록 직후 AI 첫 테스트 (문서화된 예외)
        );
    }

    private static Set<String> filesCalling(String regex) throws IOException {
        Pattern pattern = Pattern.compile(regex);
        Set<String> found = new TreeSet<>();
        try (Stream<Path> files = Files.walk(MAIN)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                String source = Files.readString(file).replaceAll("private void applyDiff\\(", "");
                if (pattern.matcher(source).find()) found.add(MAIN.relativize(file).toString().replace('\\', '/'));
            }
        }
        return found;
    }

    private static int count(String source, String regex) {
        Matcher m = Pattern.compile(regex).matcher(source);
        int n = 0;
        while (m.find()) n++;
        return n;
    }
}
