package com.playops.api.entity;

import com.playops.api.service.AiJobChanged;
import jakarta.persistence.PostPersist;
import jakarta.persistence.PostUpdate;
import org.springframework.context.ApplicationEventPublisher;

/**
 * AI 작업이 어느 서비스에서 저장되든 한 곳에서 변경 이벤트를 낸다. (D-02)
 * Hibernate 가 스프링 빈 컨테이너로 만들어 주므로 생성자 주입이 된다.
 */
public class AiJobEvents {

    private final ApplicationEventPublisher publisher;

    public AiJobEvents(ApplicationEventPublisher publisher) {
        this.publisher = publisher;
    }

    @PostPersist
    @PostUpdate
    void changed(AiJob job) {
        publisher.publishEvent(new AiJobChanged(job.getId(), job.getProjectId(), job.getStatus().name()));
    }
}
