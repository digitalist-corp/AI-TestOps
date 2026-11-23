package com.playops.api.repository;

import com.playops.api.entity.AppFixProposal;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 제품 코드 수정안의 중복 · 재시도 · 재시작 정리를 실제 쿼리(H2)로 확인한다. */
@DataJpaTest(properties = {
        "spring.flyway.enabled=false",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect"
})
class AppFixProposalRepositoryTest {

    @Autowired
    AppFixProposalRepository proposals;

    private AppFixProposal row(String key, String status, Instant updatedAt) {
        AppFixProposal p = new AppFixProposal();
        p.setProjectId("shop");
        p.setSpecPath("tests/cart.spec.ts");
        p.setGrep("합계");
        p.setExecutionId(41L);
        p.setIdentityKey(key);
        p.setCategory("APP_CODE");
        p.setStatus(status);
        ReflectionTestUtils.setField(p, "updatedAt", updatedAt);
        return proposals.saveAndFlush(p);
    }

    @Test
    void sameIdentityCannotBeStoredTwice() {
        row("k1", AppFixProposal.ANALYZING, Instant.now());
        assertThatThrownBy(() -> row("k1", AppFixProposal.ANALYZING, Instant.now()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void onlyOneRetryOfAFailedRowWins() {
        Long id = row("k2", AppFixProposal.FAILED, Instant.now()).getId();

        assertThat(proposals.retry(id, 7L, null, Instant.now())).isEqualTo(1);
        assertThat(proposals.retry(id, 8L, null, Instant.now())).isZero();
        assertThat(proposals.findById(id).orElseThrow().getRequestedBy()).isEqualTo(7L);
    }

    @Test
    void onlyADiagnosisThatNeverRanAiCanBeAnalyzedAgain() {
        AppFixProposal noAi = proposals.findById(row("k6", AppFixProposal.DIAGNOSIS_ONLY, Instant.now()).getId()).orElseThrow();
        noAi.setLimitation("웹주소만\nAI 설정(키)이 없어 원인 분석 없이 실행 증거만 보여 줘요.");
        proposals.saveAndFlush(noAi);
        AppFixProposal analyzed = row("k7", AppFixProposal.DIAGNOSIS_ONLY, Instant.now());
        analyzed.setSummary("모델이 진단함");
        proposals.saveAndFlush(analyzed);

        assertThat(proposals.retry(noAi.getId(), 7L, "웹주소만", Instant.now())).isEqualTo(1);
        assertThat(proposals.retry(noAi.getId(), 7L, "웹주소만", Instant.now())).isZero();
        assertThat(proposals.retry(analyzed.getId(), 7L, null, Instant.now())).isZero();
        AppFixProposal reopened = proposals.findById(noAi.getId()).orElseThrow();
        assertThat(reopened.getStatus()).isEqualTo(AppFixProposal.ANALYZING);
        assertThat(reopened.getLimitation()).isEqualTo("웹주소만");
    }

    @Test
    void restartFailsOnlyAnalysesStartedBeforeBoot() {
        Instant boot = Instant.now();
        Long old = row("k3", AppFixProposal.ANALYZING, boot.minusSeconds(60)).getId();
        Long fresh = row("k4", AppFixProposal.ANALYZING, boot.plusSeconds(1)).getId();
        Long done = row("k5", AppFixProposal.DIFF_READY, boot.minusSeconds(60)).getId();

        assertThat(proposals.failInterrupted(boot, "재시작", Instant.now())).isEqualTo(1);

        assertThat(proposals.findById(old).orElseThrow().getStatus()).isEqualTo(AppFixProposal.FAILED);
        assertThat(proposals.findById(fresh).orElseThrow().getStatus()).isEqualTo(AppFixProposal.ANALYZING);
        assertThat(proposals.findById(done).orElseThrow().getStatus()).isEqualTo(AppFixProposal.DIFF_READY);
        // 정리된 행은 다시 요청하면 한 번만 분석에 들어간다
        assertThat(proposals.retry(old, 7L, null, Instant.now())).isEqualTo(1);
    }
}
