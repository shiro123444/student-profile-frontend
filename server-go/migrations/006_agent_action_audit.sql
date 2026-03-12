CREATE TABLE IF NOT EXISTS agent_action_audit (
    id BIGSERIAL PRIMARY KEY,
    request_id VARCHAR(128) NOT NULL,
    session_id VARCHAR(128),
    student_id VARCHAR(128),
    agent VARCHAR(128),
    engine VARCHAR(64),
    mode VARCHAR(64),
    tool VARCHAR(128),
    risk VARCHAR(32),
    approved BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(64),
    args JSONB,
    result JSONB,
    error TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_action_audit_request_id ON agent_action_audit(request_id);
CREATE INDEX IF NOT EXISTS idx_agent_action_audit_student_id ON agent_action_audit(student_id);
CREATE INDEX IF NOT EXISTS idx_agent_action_audit_agent ON agent_action_audit(agent);
CREATE INDEX IF NOT EXISTS idx_agent_action_audit_tool ON agent_action_audit(tool);
CREATE INDEX IF NOT EXISTS idx_agent_action_audit_status ON agent_action_audit(status);
