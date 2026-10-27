-- 우상단 알림 창. 사용자마다 한 줄씩 만들고, 사용자가 확인한 뒤 지운다.
CREATE TABLE IF NOT EXISTS notifications (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT       NOT NULL,
    kind        VARCHAR(40)  NOT NULL,
    level       VARCHAR(10)  NOT NULL,
    title       VARCHAR(200) NOT NULL,
    message     VARCHAR(1000),
    link        VARCHAR(500),
    project_id  VARCHAR(100),
    created_at  TIMESTAMP    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);
