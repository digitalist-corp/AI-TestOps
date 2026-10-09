package com.playops.api.entity;

import jakarta.persistence.*;

import java.time.Instant;

/**
 * AI 가 만든 테스트 파일이 어느 화면의 어느 셀렉터를 썼는지.
 * 테스트가 실패했을 때 어느 화면의 문제인지, 통과했을 때 어느 셀렉터가 확인됐는지 알려면 필요하다.
 */
@Entity
@Table(name = "scenario_origin", uniqueConstraints =
        @UniqueConstraint(name = "uk_scenario_origin_spec", columnNames = {"project_id", "spec_path"}))
public class ScenarioOrigin {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false, length = 100)
    private String projectId;

    @Column(name = "spec_path", nullable = false, length = 500)
    private String specPath;

    /** 생성할 때 고른 화면의 routeKey (JSON 배열). 고르지 않았으면 빈 배열. */
    @Column(name = "route_keys", columnDefinition = "TEXT")
    private String routeKeys;

    /** spec 이 쓴 셀렉터의 키 (JSON 배열). 형식은 SiteMapPromptService 의 selectorKey 참고. */
    @Column(name = "selector_keys", columnDefinition = "TEXT")
    private String selectorKeys;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    public Long getId() { return id; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public String getSpecPath() { return specPath; }
    public void setSpecPath(String specPath) { this.specPath = specPath; }
    public String getRouteKeys() { return routeKeys; }
    public void setRouteKeys(String routeKeys) { this.routeKeys = routeKeys; }
    public String getSelectorKeys() { return selectorKeys; }
    public void setSelectorKeys(String selectorKeys) { this.selectorKeys = selectorKeys; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
