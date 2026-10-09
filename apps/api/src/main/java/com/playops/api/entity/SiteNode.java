package com.playops.api.entity;

import jakarta.persistence.*;

/**
 * 화면 하나 (저장 구조 2단계). 라우트 하나가 화면 하나다.
 *
 * routeKey(예: /products/:id)로 구분하므로 다시 분석해도 같은 화면은 같은 행에 남는다.
 * 화면 안의 요소(3단계)는 항상 화면 단위로 읽고 쓰므로 elements 에 JSON 배열로 넣는다.
 */
@Entity
@Table(name = "site_node", uniqueConstraints =
        @UniqueConstraint(name = "uk_site_node_route", columnNames = {"project_id", "route_key"}))
public class SiteNode {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false, length = 100)
    private String projectId;

    @Column(name = "route_key", nullable = false, length = 500)
    private String routeKey;

    @Column(length = 300)
    private String title;

    /** 저장소 기준 상대 경로 */
    @Column(name = "source_file", length = 700)
    private String sourceFile;

    /** 이 정보를 어디서 얻었는지. 지금은 모두 CODE 이고, 사이트 탐색이 붙으면 SITE 가 더해진다. */
    @Column(nullable = false, length = 20)
    private String origin = "CODE";

    @Column(name = "auth_required")
    private Boolean authRequired;

    /** 요소 목록 (JSON 배열). 요소 추출이 붙기 전에는 빈 배열이다. */
    @Column(nullable = false, columnDefinition = "TEXT")
    private String elements = "[]";

    /** 이 화면에서 다른 화면으로 가는 링크 (JSON 배열). 전환(site_edge)은 분석할 때마다 여기서 다시 만든다. */
    @Column(columnDefinition = "TEXT")
    private String links;

    /** 요소를 뽑을 때 읽은 파일 묶음의 해시. 같으면 LLM 을 다시 부르지 않는다. */
    @Column(name = "content_hash", length = 64)
    private String contentHash;

    @Column(name = "first_seen_commit", length = 64)
    private String firstSeenCommit;

    @Column(name = "last_seen_commit", length = 64)
    private String lastSeenCommit;

    /** 마지막 분석에서 코드에 없던 화면. 메모와 테스트 연결을 지키려고 지우지 않고 표시만 한다. */
    @Column(nullable = false)
    private boolean stale = false;

    public Long getId() { return id; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public String getRouteKey() { return routeKey; }
    public void setRouteKey(String routeKey) { this.routeKey = routeKey; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getSourceFile() { return sourceFile; }
    public void setSourceFile(String sourceFile) { this.sourceFile = sourceFile; }
    public String getOrigin() { return origin; }
    public void setOrigin(String origin) { this.origin = origin; }
    public Boolean getAuthRequired() { return authRequired; }
    public void setAuthRequired(Boolean authRequired) { this.authRequired = authRequired; }
    public String getElements() { return elements; }
    public void setElements(String elements) { this.elements = elements; }
    public String getLinks() { return links; }
    public void setLinks(String links) { this.links = links; }
    public String getContentHash() { return contentHash; }
    public void setContentHash(String contentHash) { this.contentHash = contentHash; }
    public String getFirstSeenCommit() { return firstSeenCommit; }
    public void setFirstSeenCommit(String firstSeenCommit) { this.firstSeenCommit = firstSeenCommit; }
    public String getLastSeenCommit() { return lastSeenCommit; }
    public void setLastSeenCommit(String lastSeenCommit) { this.lastSeenCommit = lastSeenCommit; }
    public boolean isStale() { return stale; }
    public void setStale(boolean stale) { this.stale = stale; }
}
