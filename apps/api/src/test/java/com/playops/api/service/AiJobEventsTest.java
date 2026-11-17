package com.playops.api.service;

import com.playops.api.entity.AiJob;
import com.playops.api.entity.AiJobStatus;
import com.playops.api.entity.AiJobType;
import com.playops.api.repository.AiJobRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;

import static org.assertj.core.api.Assertions.assertThat;

/** AI 작업이 어디서 저장되든 바뀔 때마다 이벤트가 하나 나간다. (D-02) */
@DataJpaTest(properties = {
        "spring.flyway.enabled=false",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect"
})
@RecordApplicationEvents
class AiJobEventsTest {

    @Autowired
    AiJobRepository jobs;

    @Autowired
    ApplicationEvents events;

    @Test
    void createAndStatusChangePublishEvents() {
        AiJob job = new AiJob();
        job.setProjectId("p1");
        job.setJobType(AiJobType.CODE_FIX);
        job.setStatus(AiJobStatus.PROPOSED);
        job.setInstruction("고쳐 줘");
        job.setTargetSpecPath("tests/a.spec.ts");
        AiJob saved = jobs.saveAndFlush(job);

        saved.setStatus(AiJobStatus.PENDING);
        jobs.saveAndFlush(saved);

        assertThat(events.stream(AiJobChanged.class))
                .extracting(AiJobChanged::status)
                .containsExactly("PROPOSED", "PENDING");
        assertThat(events.stream(AiJobChanged.class)).allMatch(e -> e.projectId().equals("p1") && e.id().equals(saved.getId()));
    }
}
