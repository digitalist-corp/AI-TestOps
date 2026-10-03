package com.playops.api.dto;

import java.util.List;

public class AiChatRequest {
    private Long executionId;
    private String projectId;
    private String question;
    private String userLevel;
    private String provider; // CLAUDE, GPT (미지정 시 서버가 자동 선택)
    private List<ChatHistoryMessage> history;

    public AiChatRequest() {}

    public AiChatRequest(Long executionId, String question, String userLevel) {
        this.executionId = executionId;
        this.question = question;
        this.userLevel = userLevel;
    }

    public String getProjectId() {
        return projectId;
    }

    public void setProjectId(String projectId) {
        this.projectId = projectId;
    }

    public String getProvider() {
        return provider;
    }

    public void setProvider(String provider) {
        this.provider = provider;
    }

    public Long getExecutionId() {
        return executionId;
    }

    public void setExecutionId(Long executionId) {
        this.executionId = executionId;
    }

    public String getQuestion() {
        return question;
    }

    public void setQuestion(String question) {
        this.question = question;
    }

    public String getUserLevel() {
        return userLevel;
    }

    public void setUserLevel(String userLevel) {
        this.userLevel = userLevel;
    }

    public List<ChatHistoryMessage> getHistory() {
        return history;
    }

    public void setHistory(List<ChatHistoryMessage> history) {
        this.history = history;
    }

    /** 이전 대화 한 턴. role 은 "user" 또는 "assistant"이며, 그 외 값은 무시된다. */
    public static class ChatHistoryMessage {
        private String role;
        private String content;

        public ChatHistoryMessage() {}

        public ChatHistoryMessage(String role, String content) {
            this.role = role;
            this.content = content;
        }

        public String getRole() {
            return role;
        }

        public void setRole(String role) {
            this.role = role;
        }

        public String getContent() {
            return content;
        }

        public void setContent(String content) {
            this.content = content;
        }
    }
}
