package com.playops.api.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.playops.api.entity.Execution;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.ExecutionRepository;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * 케이스별 단계 목록 (#84). 실행마다 리포트 폴더에 남는 steps.json(runner/steps-reporter.cjs)을 읽어 한국어 문장으로 바꾼다.
 * 따로 저장하지 않는다. 리포터를 붙이기 전 실행에는 기록이 없다(recorded=false).
 */
@Service
public class StepRecordService {

    public static final String FILE = "steps.json";
    private static final Pattern ANSI = Pattern.compile("\u001B\\[[0-9;]*m");

    /** status: PASSED | FAILED. error: 오류 첫 줄 */
    public record Step(String text, String category, String status, String error) {}

    /** title: 결과 표와 같은 "파일 > 묶음 > 케이스". status: PASSED | FAILED | SKIPPED. failedStep: 실패한 단계 번호(0부터), 없으면 null */
    public record CaseSteps(String specPath, String title, String status, Integer failedStep, List<Step> steps) {}

    public record StepsResponse(boolean recorded, List<CaseSteps> cases) {}

    private final ExecutionRepository executionRepository;
    private final ExecutionLogService logService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public StepRecordService(ExecutionRepository executionRepository, ExecutionLogService logService) {
        this.executionRepository = executionRepository;
        this.logService = logService;
    }

    public StepsResponse steps(String projectId, Long executionId) {
        Execution execution = executionRepository.findById(executionId)
                .filter(e -> projectId.equals(e.getProjectId()))
                .orElseThrow(() -> new ApiException(404, "실행을 찾을 수 없습니다."));
        Path file = logService.resolveReportDir(execution).resolve(FILE);
        if (!Files.isRegularFile(file)) return new StepsResponse(false, List.of());
        try {
            return new StepsResponse(true, parse(objectMapper.readTree(file.toFile())));
        } catch (IOException e) {
            throw new ApiException(500, "단계 기록을 읽지 못했습니다.");
        }
    }

    static List<CaseSteps> parse(JsonNode root) {
        List<CaseSteps> out = new ArrayList<>();
        for (JsonNode c : root) {
            String file = c.path("file").asText("");
            List<String> titles = new ArrayList<>();
            c.path("titlePath").forEach(t -> titles.add(t.asText()));
            // titlePath 앞의 프로젝트 이름(chromium 등)은 빼고 파일 이름부터 쓴다 — 결과 표의 케이스 제목과 같게
            String base = file.substring(file.lastIndexOf('/') + 1);
            int from = titles.indexOf(base);
            String title = String.join(" > ", from < 0 ? titles : titles.subList(from, titles.size()));

            List<Step> steps = new ArrayList<>();
            Integer lastError = null;
            for (JsonNode s : c.path("steps")) {
                String error = firstLine(s.path("error").asText(null));
                if (error != null) lastError = steps.size();
                steps.add(new Step(StepSentences.sentence(s.path("category").asText(), s.path("title").asText(null),
                        s.path("code").asText(null)), s.path("category").asText(), error == null ? "PASSED" : "FAILED", error));
            }
            String status = switch (c.path("status").asText("")) {
                case "passed" -> "PASSED";
                case "skipped" -> "SKIPPED";
                default -> "FAILED"; // failed · timedOut · interrupted
            };
            out.add(new CaseSteps(file, title, status, "FAILED".equals(status) ? lastError : null, steps));
        }
        return out;
    }

    private static String firstLine(String s) {
        if (s == null || s.isBlank()) return null;
        String clean = ANSI.matcher(s).replaceAll("").strip();
        int nl = clean.indexOf('\n');
        return nl < 0 ? clean : clean.substring(0, nl);
    }
}
