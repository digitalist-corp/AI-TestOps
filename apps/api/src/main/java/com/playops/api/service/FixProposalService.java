package com.playops.api.service;

import com.playops.api.entity.AiJob;
import com.playops.api.entity.AiJobStatus;
import com.playops.api.entity.AiJobType;
import com.playops.api.entity.Execution;
import com.playops.api.entity.ExecutionCaseResult;
import com.playops.api.entity.ExecutionStatus;
import com.playops.api.entity.Project;
import com.playops.api.repository.AiJobRepository;
import com.playops.api.repository.ExecutionCaseResultRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 실패한 실행에서 "이렇게 고칠까요?" 제안을 만든다. (FR-25)
 *
 * 제안은 PROPOSED 상태의 CODE_FIX 작업이고, 사람이 진행을 눌러야 AI 수정이 돈다(AiJobService.proceed).
 * 문장은 AI 없이 규칙으로 쓰고, AI 키가 등록된 서버에서만 고칠 방법 문장을 뒤에서 다듬는다.
 * 제안을 만들다 실패해도 실행 종료 처리에는 영향이 없어야 한다.
 */
@Service
public class FixProposalService {

    private static final Logger log = LoggerFactory.getLogger(FixProposalService.class);

    static final int MAX_PER_EXECUTION = 3;
    static final int DAILY_LIMIT = 20;
    static final int POLISH_MAX_LENGTH = 300;
    static final String FEATURE = "FIX_PROPOSAL";
    /** AiBootstrapService.runOnce 가 붙이는 케이스 제목. 그 흐름은 스스로 고치므로 제안하지 않는다. */
    static final String BOOTSTRAP_TITLE_PREFIX = "AI 초기 케이스";
    static final Set<AiJobStatus> OPEN = EnumSet.of(
            AiJobStatus.PROPOSED, AiJobStatus.PENDING, AiJobStatus.RUNNING, AiJobStatus.DIFF_READY, AiJobStatus.NEEDS_REVIEW);

    private static final String POLISH_SYSTEM = """
            너는 웹 테스트 도구의 안내 문구를 다듬는다. 코드를 모르는 사람이 읽는다.
            실패한 테스트를 어떻게 고칠지 한 문장으로, "~할게요."로 끝나는 존댓말로, 120자 이내로 써라.
            주어진 고칠 방법의 뜻을 바꾸지 말고, 오류에 나온 버튼·화면 이름이 있으면 넣어라. 문장 하나만 답하라.
            """;

    private final AiJobRepository aiJobRepository;
    private final ExecutionCaseResultRepository caseResultRepository;
    private final NotificationService notificationService;
    private final AiProviderSettingsService aiProviderSettingsService;
    private final LlmGatewayService llmGatewayService;
    private final FixProposalService self;

    public FixProposalService(
            AiJobRepository aiJobRepository,
            ExecutionCaseResultRepository caseResultRepository,
            NotificationService notificationService,
            AiProviderSettingsService aiProviderSettingsService,
            LlmGatewayService llmGatewayService,
            @Lazy FixProposalService self
    ) {
        this.aiJobRepository = aiJobRepository;
        this.caseResultRepository = caseResultRepository;
        this.notificationService = notificationService;
        this.aiProviderSettingsService = aiProviderSettingsService;
        this.llmGatewayService = llmGatewayService;
        this.self = self;
    }

    /** 테스트 실행이 끝났을 때. FAILED 인 일반 실행만 본다. ERROR 는 러너·환경 문제라 코드 수정 대상이 아니다. */
    public void onExecutionFinished(Execution execution, Project project) {
        if (execution.getStatus() != ExecutionStatus.FAILED
                || "AI_POST_APPLY".equals(execution.getSource())
                || (execution.getCaseTitle() != null && execution.getCaseTitle().startsWith(BOOTSTRAP_TITLE_PREFIX))) {
            return;
        }
        try {
            List<AiJob> created = create(execution, project);
            if (created.isEmpty()) return;
            notificationService.fixProposed(project, execution.getId(), created.size());
            if (aiProviderSettingsService.hasKey(llmGatewayService.defaultProvider())) {
                self.polishAsync(created.stream().map(AiJob::getId).toList());
            }
        } catch (RuntimeException e) {
            log.warn("수정 제안을 만들지 못했습니다 (execution {}): {}", execution.getId(), e.getMessage());
        }
    }

    private List<AiJob> create(Execution execution, Project project) {
        String projectId = project.getProjectId();
        long today = aiJobRepository.countByProjectIdAndRequestedByIsNullAndCreatedAtAfter(
                projectId, LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant());
        int room = (int) Math.min(MAX_PER_EXECUTION, DAILY_LIMIT - today);
        List<AiJob> created = new ArrayList<>();
        for (ExecutionCaseResult failed : firstFailurePerSpec(execution.getId()).values()) {
            if (created.size() >= room) break;
            if (aiJobRepository.existsByProjectIdAndTargetSpecPathAndStatusIn(projectId, failed.getSpecPath(), OPEN)) continue;
            FixProposalRules.Proposal proposal = FixProposalRules.of(failed.getCaseTitle(), failed.getErrorMessage());
            AiJob job = new AiJob();
            job.setProjectId(projectId);
            job.setJobType(AiJobType.CODE_FIX);
            job.setStatus(AiJobStatus.PROPOSED);
            job.setAiModelProvider(llmGatewayService.defaultProvider());
            job.setFailedExecutionId(execution.getId());
            job.setTargetSpecPath(failed.getSpecPath());
            job.setSummary(proposal.problem());
            job.setInstruction(proposal.plan());
            created.add(aiJobRepository.save(job));
        }
        return created;
    }

    private Map<String, ExecutionCaseResult> firstFailurePerSpec(Long executionId) {
        Map<String, ExecutionCaseResult> bySpec = new LinkedHashMap<>();
        for (ExecutionCaseResult r : caseResultRepository.findByExecutionIdOrderByIdAsc(executionId)) {
            if ("FAILED".equals(r.getStatus()) && r.getSpecPath() != null) bySpec.putIfAbsent(r.getSpecPath(), r);
        }
        return bySpec;
    }

    /** 고칠 방법 문장을 AI로 다듬는다. 답이 비었거나 너무 길거나 그 사이 진행·닫기가 됐으면 규칙 문장을 그대로 둔다. */
    @Async("aiJobExecutor")
    public void polishAsync(List<Long> jobIds) {
        for (Long id : jobIds) {
            try {
                aiJobRepository.findById(id).ifPresent(this::polish);
            } catch (RuntimeException e) {
                log.warn("수정 제안 {} 문장을 다듬지 못했습니다: {}", id, e.getMessage());
            }
        }
    }

    private void polish(AiJob job) {
        if (job.getStatus() != AiJobStatus.PROPOSED) return;
        ExecutionCaseResult failed = firstFailurePerSpec(job.getFailedExecutionId()).get(job.getTargetSpecPath());
        String error = failed == null || failed.getErrorMessage() == null ? "" : failed.getErrorMessage();
        String prompt = "고칠 방법: " + job.getInstruction()
                + "\n케이스: " + (failed == null ? "" : failed.getCaseTitle())
                + "\n오류:\n" + error.substring(0, Math.min(error.length(), 1500));
        String answer = llmGatewayService.chat(job.getAiModelProvider(), POLISH_SYSTEM, prompt, FEATURE, job.getProjectId());
        String text = answer == null ? "" : answer.trim();
        if (text.isEmpty() || text.length() > POLISH_MAX_LENGTH || job.getStatus() != AiJobStatus.PROPOSED) return;
        job.setInstruction(text);
        aiJobRepository.save(job); // @Version 이 있어 그 사이 진행된 작업은 덮어쓰지 않는다
    }
}
