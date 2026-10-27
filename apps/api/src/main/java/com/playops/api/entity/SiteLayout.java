package com.playops.api.entity;

import jakarta.persistence.*;

/**
 * 여러 화면을 감싸는 공용 영역 (상단 메뉴, 사이드바 등).
 *
 * 메뉴의 링크를 화면마다 전환으로 복제하면 화면 수 × 메뉴 수만큼 선이 생겨 구조를 읽을 수 없게 된다.
 * 그래서 "어느 화면들에서 보이고 어디로 가는가"를 여기에 한 번만 적는다.
 */
@Entity
@Table(name = "site_layout", uniqueConstraints =
        @UniqueConstraint(name = "uk_site_layout_file", columnNames = {"project_id", "source_file"}))
public class SiteLayout {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false, length = 100)
    private String projectId;

    @Column(name = "source_file", nullable = false, length = 700)
    private String sourceFile;

    /** 이 영역이 보이는 화면의 routeKey (JSON 배열) */
    @Column(name = "route_keys", columnDefinition = "TEXT")
    private String routeKeys;

    /** 영역 안의 요소 (JSON 배열). 형식은 site_node.elements 와 같다. */
    @Column(columnDefinition = "TEXT")
    private String elements;

    /** 다른 화면으로 가는 링크 (JSON 배열) */
    @Column(columnDefinition = "TEXT")
    private String links;

    @Column(name = "content_hash", length = 64)
    private String contentHash;

    public Long getId() { return id; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public String getSourceFile() { return sourceFile; }
    public void setSourceFile(String sourceFile) { this.sourceFile = sourceFile; }
    public String getRouteKeys() { return routeKeys; }
    public void setRouteKeys(String routeKeys) { this.routeKeys = routeKeys; }
    public String getElements() { return elements; }
    public void setElements(String elements) { this.elements = elements; }
    public String getLinks() { return links; }
    public void setLinks(String links) { this.links = links; }
    public String getContentHash() { return contentHash; }
    public void setContentHash(String contentHash) { this.contentHash = contentHash; }
}
