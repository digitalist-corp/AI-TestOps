package com.playops.api.dto;

import com.playops.api.entity.AiJob;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** 실행 상세가 원래 자동 제안을 다시 찾을 수 있도록 autoCreated 를 응답에 싣는다. */
class AiJobResponseTest {

    @Test
    void exposesAutoCreated() {
        AiJob job = new AiJob();
        job.setAutoCreated(true);

        assertThat(AiJobResponse.from(job).autoCreated()).isTrue();
    }
}
