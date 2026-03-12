CREATE TABLE IF NOT EXISTS agent_request_metrics (
    id BIGSERIAL PRIMARY KEY,
    scope VARCHAR(32) NOT NULL,
    route VARCHAR(255) NOT NULL,
    agent_name VARCHAR(128) NOT NULL DEFAULT 'unknown',
    workspace_id VARCHAR(128) NOT NULL DEFAULT 'default',
    status_code INTEGER NOT NULL,
    latency_ms BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_request_metrics_created_at
    ON agent_request_metrics (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_request_metrics_scope_created_at
    ON agent_request_metrics (scope, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_request_metrics_agent_workspace_created_at
    ON agent_request_metrics (agent_name, workspace_id, created_at DESC);
