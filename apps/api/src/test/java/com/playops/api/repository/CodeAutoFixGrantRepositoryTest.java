package com.playops.api.repository;

import com.playops.api.entity.CodeAutoFixGrant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** 사용권 상태 전이는 조건부 갱신 하나로: 동시에 와도 한 요청만 바꾼다 (H2 실제 쿼리). */
@DataJpaTest(properties = {
        "spring.flyway.enabled=false",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect"
})
class CodeAutoFixGrantRepositoryTest {

    @Autowired
    CodeAutoFixGrantRepository grants;

    private static final Instant SINCE = Instant.parse("2026-11-02T00:00:00Z");

    private Long row(String status) {
        CodeAutoFixGrant g = new CodeAutoFixGrant();
        g.setProjectId("shop");
        g.setUserId(3L);
        g.setStatus(status);
        g.setMemberSince(SINCE);
        return grants.saveAndFlush(g).getId();
    }

    @Test
    void onlyOneReRequestReopensARejectedRow() {
        Long id = row("REJECTED");

        assertThat(grants.reopen(id, SINCE, "다시", Instant.now())).isEqualTo(1);
        assertThat(grants.reopen(id, SINCE, "다시", Instant.now())).isZero();
        assertThat(grants.findById(id).orElseThrow().getStatus()).isEqualTo("PENDING");
    }

    @Test
    void aRowFromAnEarlierMembershipIsReopenedEvenIfItWasGranted() {
        Long id = row("GRANTED");
        Instant rejoined = Instant.parse("2026-11-20T00:00:00Z");

        assertThat(grants.reopen(id, SINCE, null, Instant.now())).isZero();
        assertThat(grants.reopen(id, rejoined, null, Instant.now())).isEqualTo(1);
        CodeAutoFixGrant g = grants.findById(id).orElseThrow();
        assertThat(g.getStatus()).isEqualTo("PENDING");
        assertThat(g.getScopes()).isNull();
        assertThat(g.getMemberSince()).isEqualTo(rejoined);
    }

    @Test
    void decisionsOnTheSameRequestDoNotOverwriteEachOther() {
        Long id = row("PENDING");

        assertThat(grants.transition(id, List.of("PENDING", "GRANTED"), "GRANTED", "AUTO_FIX", 2L, Instant.now())).isEqualTo(1);
        // 다른 PM 의 늦은 거절은 대기 상태가 아니라 적용되지 않는다
        assertThat(grants.transition(id, List.of("PENDING"), "REJECTED", null, 4L, Instant.now())).isZero();
        assertThat(grants.transition(id, List.of("GRANTED"), "REVOKED", null, 4L, Instant.now())).isEqualTo(1);
        // 회수된 것을 늦은 부여가 되살리지 못한다
        assertThat(grants.transition(id, List.of("PENDING", "GRANTED"), "GRANTED", "AUTO_FIX", 2L, Instant.now())).isZero();
        CodeAutoFixGrant g = grants.findById(id).orElseThrow();
        assertThat(g.getStatus()).isEqualTo("REVOKED");
        assertThat(g.getScopes()).isNull();
        assertThat(g.getDecidedBy()).isEqualTo(4L);
    }
}
