package com.playops.api.service;

import com.playops.api.dto.FailureDtos.Cluster;
import com.playops.api.dto.FailureDtos.PastFix;
import com.playops.api.entity.AiClassifyFeedback;
import com.playops.api.entity.AiFixMemory;
import com.playops.api.entity.AiJob;
import com.playops.api.entity.AiJobType;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.exception.ApiException;
import com.playops.api.repository.AiClassifyFeedbackRepository;
import com.playops.api.repository.AiFixMemoryRepository;
import com.playops.api.repository.AiJobRepository;
import com.playops.api.repository.ExecutionCaseResultRepository;
import com.playops.api.repository.ExecutionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 학습 루프 E-04 · E-05 · V22. 실패를 서명으로 묶고 원인을 붙이며, 사람이 승인한 수정을 기억했다가 같은 · 비슷한 실패에 돌려준다.
 * 원인은 사람이 고친 값(ai_classify_feedback)이 규칙(FailureRules.classify)보다 앞선다.
 */
@Service
public class FailureService {

    private static final Logger log = LoggerFactory.getLogger(FailureService.class);
    static final int RECALL_LIMIT = 3;
    private static final int HISTORY = 5;
    private static final int DIFF_LINES = 40;

    private final ExecutionRepository executions;
    private final ExecutionCaseResultRepository results;
    private final AiFixMemoryRepository fixes;
    private final AiClassifyFeedbackRepository feedbacks;
    private final AiJobRepository aiJobs;
    private final AiRunnerDockerService runnerDocker;

    public FailureService(ExecutionRepository executions, ExecutionCaseResultRepository results, AiFixMemoryRepository fixes,
                          AiClassifyFeedbackRepository feedbacks, AiJobRepository aiJobs, AiRunnerDockerService runnerDocker) {
        this.executions = executions;
        this.results = results;
        this.fixes = fixes;
        this.feedbacks = feedbacks;
        this.aiJobs = aiJobs;
        this.runnerDocker = runnerDocker;
    }

    public List<Cluster> clusters(String projectId, Long executionId) {
        executions.findById(executionId).filter(e -> projectId.equals(e.getProjectId()))
                .orElseThrow(() -> new ApiException(404, "실행을 찾을 수 없습니다."));
        List<ExecutionCaseResult> failed = results.findByExecutionIdOrderByIdAsc(executionId).stream()
                .filter(r -> "FAILED".equals(r.getStatus())).toList();
        if (failed.isEmpty()) return List.of();

        Map<String, List<ExecutionCaseResult>> groups = FailureRules.cluster(failed, FailureService::signatureOf);
        Map<String, String> human = feedbacks.findByProjectIdAndSignatureIn(projectId, groups.keySet()).stream()
                .collect(Collectors.toMap(AiClassifyFeedback::getSignature, AiClassifyFeedback::getCause));
        Map<String, List<String>> history = history(projectId, executionId);
        List<AiFixMemory> memory = fixes.findByProjectIdOrderByIdDesc(projectId);

        List<Cluster> clusters = new ArrayList<>();
        for (List<ExecutionCaseResult> group : groups.values()) {
            ExecutionCaseResult first = group.get(0);
            FailureRules.Signature sig = signatureOf(first);
            String cause = human.get(sig.key());
            String source = cause == null ? "RULE" : "HUMAN";
            if (cause == null) {
                cause = FailureRules.classify(first.getErrorMessage(), history.getOrDefault(caseKey(first), List.of())).name();
            }
            List<PastFix> recalled = recall(memory, sig);
            clusters.add(new Cluster(sig.key(), sig.head(), sig.locator(), first.getSpecPath(), cause, source,
                    CoverageRules.explain(first.getErrorMessage()).message(), group.size(),
                    group.stream().map(ExecutionCaseResult::getCaseTitle).toList(), first.getErrorMessage(),
                    recalled.size(), recalled));
        }
        return clusters;
    }

    /** 사람이 원인을 고친다. 같은 서명은 프로젝트마다 하나, 마지막 값. */
    @Transactional
    public void setCause(String projectId, String signature, String cause, Long userId) {
        if (signature == null || !signature.matches("[0-9a-f]{12}")) throw new ApiException(400, "서명이 올바르지 않습니다.");
        try {
            FailureRules.Cause.valueOf(cause);
        } catch (IllegalArgumentException | NullPointerException e) {
            throw new ApiException(400, "원인은 PRODUCT_DEFECT · SCRIPT_ERROR · ENVIRONMENT · FLAKY · UNCLASSIFIED 중 하나입니다.");
        }
        AiClassifyFeedback feedback = feedbacks.findByProjectIdAndSignature(projectId, signature).orElseGet(AiClassifyFeedback::new);
        feedback.setProjectId(projectId);
        feedback.setSignature(signature);
        feedback.setCause(cause);
        feedback.setUserId(userId);
        feedback.setCreatedAt(Instant.now());
        feedbacks.save(feedback);
    }

    /** 사람이 승인해 반영한 CODE_FIX 를 기억하고, 되돌려지면 잊는다. 실패해도 승인 흐름은 막지 않는다. */
    @TransactionalEventListener(fallbackExecution = true)
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void onJobChanged(AiJobChanged change) {
        if (!"APPLIED".equals(change.status())) return;
        try {
            remember(change.id());
        } catch (RuntimeException e) {
            log.warn("승인된 수정을 기억하지 못했습니다 (job {}): {}", change.id(), e.getMessage());
        }
    }

    private void remember(Long jobId) {
        AiJob job = aiJobs.findById(jobId).orElse(null);
        if (job == null || job.getJobType() != AiJobType.CODE_FIX || job.getReviewedBy() == null) return;
        if (job.getRevertedAt() != null) {
            fixes.deleteByAiJobId(jobId);
            return;
        }
        if (fixes.existsByAiJobId(jobId) || job.getFailedExecutionId() == null || job.getTargetSpecPath() == null) return;
        String target = job.getTargetSpecPath();
        ExecutionCaseResult failed = results.findByExecutionIdOrderByIdAsc(job.getFailedExecutionId()).stream()
                .filter(r -> "FAILED".equals(r.getStatus()) && r.getSpecPath() != null)
                .filter(r -> target.equals(r.getSpecPath()) || target.endsWith("/" + r.getSpecPath()))
                .findFirst().orElse(null);
        if (failed == null) return;

        FailureRules.Signature sig = signatureOf(failed);
        AiFixMemory memory = new AiFixMemory();
        memory.setProjectId(job.getProjectId());
        memory.setSignature(sig.key());
        memory.setHead(sig.head());
        memory.setLocator(sig.locator());
        memory.setSpecPath(target);
        memory.setCause(feedbacks.findByProjectIdAndSignature(job.getProjectId(), sig.key())
                .map(AiClassifyFeedback::getCause)
                .orElse(FailureRules.classify(failed.getErrorMessage(), List.of()).name()));
        memory.setAiJobId(jobId);
        String file = target.replace("/", "__").replace("\\", "__");
        memory.setDiff(lineDiff(read(runnerDocker.aiJobDir(jobId).resolve("pre-apply-snapshot").resolve(file)),
                job.getDiffPath() == null ? "" : read(Path.of(job.getDiffPath(), file))));
        fixes.save(memory);
    }

    /** 같은 서명 3점 · 같은 로케이터 2점. 0점은 빼고 점수 → 최신 순, 상위 RECALL_LIMIT 건 */
    // ponytail: 프로젝트 기억을 전부 읽어 점수를 매긴다. 수천 건이 되면 서명 · 로케이터 색인 조회로 바꾼다.
    private static List<PastFix> recall(List<AiFixMemory> memory, FailureRules.Signature sig) {
        return memory.stream()
                .filter(m -> score(m, sig) > 0)
                .sorted(Comparator.comparingInt((AiFixMemory m) -> score(m, sig)).reversed())
                .limit(RECALL_LIMIT)
                .map(m -> new PastFix(m.getAiJobId(), m.getSpecPath(), m.getCause(), m.getHead(), m.getLocator(), m.getDiff(), m.getCreatedAt()))
                .toList();
    }

    private static int score(AiFixMemory m, FailureRules.Signature sig) {
        if (m.getSignature().equals(sig.key())) return 3;
        return sig.locator() != null && sig.locator().equals(m.getLocator()) ? 2 : 0;
    }

    /** 바뀐 줄만: 이전에만 있는 줄은 -, 이후에만 있는 줄은 + (최대 DIFF_LINES 줄) */
    static String lineDiff(String before, String after) {
        Set<String> was = new HashSet<>(before.lines().toList());
        Set<String> now = new HashSet<>(after.lines().toList());
        return Stream.concat(
                        before.lines().filter(line -> !now.contains(line)).map(line -> "-" + line),
                        after.lines().filter(line -> !was.contains(line)).map(line -> "+" + line))
                .limit(DIFF_LINES)
                .collect(Collectors.joining("\n"));
    }

    /** 같은 케이스의 이전 상태, 최신 먼저 최대 HISTORY 개 */
    private Map<String, List<String>> history(String projectId, Long executionId) {
        Map<String, List<String>> history = new HashMap<>();
        for (ExecutionCaseResult r : results.findEarlierInProject(projectId, executionId)) {
            List<String> statuses = history.computeIfAbsent(caseKey(r), k -> new ArrayList<>());
            if (statuses.size() < HISTORY) statuses.add(r.getStatus());
        }
        return history;
    }

    private static FailureRules.Signature signatureOf(ExecutionCaseResult r) {
        return FailureRules.signature(r.getSpecPath(), r.getErrorMessage());
    }

    private static String caseKey(ExecutionCaseResult r) {
        return Objects.toString(r.getSpecPath(), "") + "\n" + Objects.toString(r.getCaseTitle(), "");
    }

    private static String read(Path file) {
        try {
            return Files.exists(file) ? Files.readString(file) : "";
        } catch (IOException e) {
            return "";
        }
    }
}
