-- AI 채팅 에이전트의 대화 세션. 사용자마다 따로 두고, 프로젝트 안에서 연 대화면 project_id 를 남긴다.
-- allowed_tools: 사용자가 "이 세션 동안 허락"(ALLOW_SESSION)한 RUN 도구 이름들 (쉼표 구분). 다음부터 묻지 않는다.
CREATE TABLE IF NOT EXISTS ai_chat_sessions (
    id             BIGSERIAL PRIMARY KEY,
    user_id        BIGINT       NOT NULL,
    project_id     VARCHAR(100),
    title          VARCHAR(200) NOT NULL,
    allowed_tools  TEXT,
    created_at     TIMESTAMP    NOT NULL,
    updated_at     TIMESTAMP    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_user_project_updated
    ON ai_chat_sessions (user_id, project_id, updated_at DESC);

-- 세션 안의 메시지. blocks 는 화면 계약(docs/design/ai-chat-agent-contract.md)의 ChatBlock[] JSON 이다.
-- stop_reason 은 assistant 메시지만 쓴다 (END · CANCELLED · MAX_TURNS · ERROR, 진행 중이면 NULL).
CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id           BIGSERIAL PRIMARY KEY,
    session_id   BIGINT      NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
    role         VARCHAR(20) NOT NULL,
    blocks       TEXT        NOT NULL,
    stop_reason  VARCHAR(20),
    created_at   TIMESTAMP   NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session ON ai_chat_messages (session_id, id);
