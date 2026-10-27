package com.playops.api.dto;

public class CreateTemplateGenerateJobRequest {
    private String targetSpecPath;
    private String instruction;
    /** 구조 탭에서 고른 화면. 비우면 분석된 모든 화면 정보를 참고한다. */
    private java.util.List<String> routeKeys;

    public String getTargetSpecPath() { return targetSpecPath; }
    public void setTargetSpecPath(String targetSpecPath) { this.targetSpecPath = targetSpecPath; }

    public String getInstruction() { return instruction; }
    public void setInstruction(String instruction) { this.instruction = instruction; }
    public java.util.List<String> getRouteKeys() { return routeKeys; }
    public void setRouteKeys(java.util.List<String> routeKeys) { this.routeKeys = routeKeys; }
}
