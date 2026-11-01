package com.playops.api.chat.tools;

import com.playops.api.chat.ToolDisplay;
import com.playops.api.entity.AiJob;

import java.util.LinkedHashMap;
import java.util.Map;

/** AI 작업 카드(display kind=job). 화면은 이 jobId 로 기존 AI 작업 카드를 그린다. */
final class JobDisplay {

    private JobDisplay() {
    }

    static ToolDisplay of(AiJob job) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("jobId", job.getId());
        data.put("jobType", String.valueOf(job.getJobType()));
        data.put("status", String.valueOf(job.getStatus()));
        if (job.getTargetSpecPath() != null) {
            data.put("specPath", job.getTargetSpecPath());
        }
        return ToolDisplay.of("job", data);
    }
}
