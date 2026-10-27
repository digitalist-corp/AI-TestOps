package com.playops.api.entity;

import jakarta.persistence.*;

/** 전환 하나: 어느 화면에서 어느 화면으로, 무엇을 눌러서 가는가. 분석할 때마다 전부 다시 만든다. */
@Entity
@Table(name = "site_edge", indexes = @Index(name = "idx_site_edge_project", columnList = "project_id"))
public class SiteEdge {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false, length = 100)
    private String projectId;

    @Column(name = "from_route_key", nullable = false, length = 500)
    private String fromRouteKey;

    @Column(name = "to_route_key", nullable = false, length = 500)
    private String toRouteKey;

    /** LINK / CLICK / FORM */
    @Column(nullable = false, length = 20)
    private String kind = "LINK";

    @Column(length = 300)
    private String label;

    @Column(length = 700)
    private String selector;

    @Column(name = "source_file", length = 700)
    private String sourceFile;

    @Column(name = "source_line")
    private Integer sourceLine;

    public Long getId() { return id; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public String getFromRouteKey() { return fromRouteKey; }
    public void setFromRouteKey(String fromRouteKey) { this.fromRouteKey = fromRouteKey; }
    public String getToRouteKey() { return toRouteKey; }
    public void setToRouteKey(String toRouteKey) { this.toRouteKey = toRouteKey; }
    public String getKind() { return kind; }
    public void setKind(String kind) { this.kind = kind; }
    public String getLabel() { return label; }
    public void setLabel(String label) { this.label = label; }
    public String getSelector() { return selector; }
    public void setSelector(String selector) { this.selector = selector; }
    public String getSourceFile() { return sourceFile; }
    public void setSourceFile(String sourceFile) { this.sourceFile = sourceFile; }
    public Integer getSourceLine() { return sourceLine; }
    public void setSourceLine(Integer sourceLine) { this.sourceLine = sourceLine; }
}
