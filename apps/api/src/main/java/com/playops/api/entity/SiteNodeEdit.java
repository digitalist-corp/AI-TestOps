package com.playops.api.entity;

import jakarta.persistence.*;

/**
 * 사용자가 화면에 남긴 것 (제외 표시, 메모).
 * 분석 결과와 따로 두어 다시 분석해도 지워지지 않게 한다. 화면의 id 가 아니라 routeKey 로 잇는다.
 */
@Entity
@Table(name = "site_node_edit", uniqueConstraints =
        @UniqueConstraint(name = "uk_site_node_edit_route", columnNames = {"project_id", "route_key"}))
public class SiteNodeEdit {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false, length = 100)
    private String projectId;

    @Column(name = "route_key", nullable = false, length = 500)
    private String routeKey;

    @Column(nullable = false)
    private boolean excluded = false;

    @Column(length = 500)
    private String note;

    public Long getId() { return id; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public String getRouteKey() { return routeKey; }
    public void setRouteKey(String routeKey) { this.routeKey = routeKey; }
    public boolean isExcluded() { return excluded; }
    public void setExcluded(boolean excluded) { this.excluded = excluded; }
    public String getNote() { return note; }
    public void setNote(String note) { this.note = note; }
}
