package com.playops.api.chat.tools;

import com.playops.api.chat.ChatTool;
import com.playops.api.chat.ChatToolContext;
import com.playops.api.chat.ChatToolOutput;
import com.playops.api.chat.ToolTier;
import com.playops.api.entity.AiJob;
import com.playops.api.llm.LlmToolCall;
import com.playops.api.llm.LlmToolSpec;
import com.playops.api.service.AiJobService;
import org.springframework.stereotype.Component;

import java.util.Map;

/** 앞서 만든 AI 작업의 상태. */
@Component
public class GetJobStatusTool implements ChatTool {

    private final AiJobService aiJobService;

    public GetJobStatusTool(AiJobService aiJobService) {
        this.aiJobService = aiJobService;
    }

    @Override
    public LlmToolSpec spec() {
        return new LlmToolSpec(
                "get_job_status",
                "앞서 만든 AI 작업이 지금 어떤 상태인지 확인한다. 사용자가 '아까 그거 됐어?' 라고 물을 때 쓴다. "
                        + "승인 대기 중이면 사용자가 아직 승인하지 않았다는 뜻이다.",
                LlmToolSpec.schema(
                        Map.of("jobId", LlmToolSpec.integer("확인할 AI 작업 ID")),
                        "jobId"));
    }

    @Override
    public ToolTier tier() {
        return ToolTier.READ;
    }

    @Override
    public ChatToolOutput execute(LlmToolCall call, ChatToolContext context) {
        long jobId = call.argLong("jobId", -1);
        if (jobId < 0) {
            return ChatToolOutput.failed("jobId 인자가 필요합니다.");
        }
        AiJob job = aiJobService.getJob(jobId);
        StringBuilder sb = new StringBuilder();
        sb.append("AI 작업 #").append(job.getId())
          .append(" | 종류 ").append(job.getJobType())
          .append(" | 상태 ").append(job.getStatus()).append('\n');
        sb.append("대상: ").append(job.getTargetSpecPath()).append('\n');
        if (job.getSummary() != null && !job.getSummary().isBlank()) {
            sb.append("요약: ").append(job.getSummary()).append('\n');
        }
        if (job.getErrorMessage() != null && !job.getErrorMessage().isBlank()) {
            sb.append("오류: ").append(job.getErrorMessage()).append('\n');
        }
        sb.append(switch (job.getStatus()) {
            case NEEDS_REVIEW, DIFF_READY -> "→ 사용자의 승인을 기다리는 중입니다. 아직 파일은 바뀌지 않았습니다.";
            case PENDING, RUNNING -> "→ 아직 작업 중입니다.";
            case APPLIED -> "→ 승인되어 파일에 반영되었습니다.";
            case REJECTED -> "→ 사용자가 거부했습니다. 반영되지 않았습니다.";
            default -> "→ 종료된 작업입니다.";
        });
        return ChatToolOutput.ok(sb.toString(), "#" + job.getId() + " " + job.getStatus(), JobDisplay.of(job));
    }
}
