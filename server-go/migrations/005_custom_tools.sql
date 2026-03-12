-- Custom tools and skills tables
-- Run: psql -d pathmind -f migrations/005_custom_tools.sql

CREATE TABLE IF NOT EXISTS custom_tools (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) UNIQUE NOT NULL,
    description     TEXT NOT NULL,
    category        VARCHAR(50) DEFAULT 'custom',
    code            TEXT NOT NULL,
    input_schema    JSONB NOT NULL DEFAULT '{}',
    created_by      UUID NOT NULL REFERENCES users(id),
    is_public       BOOLEAN DEFAULT FALSE,
    is_approved     BOOLEAN DEFAULT FALSE,
    allowed_roles   VARCHAR(100) DEFAULT 'student,teacher,admin',
    version         VARCHAR(20) DEFAULT '1.0.0',
    usage_count     INTEGER DEFAULT 0,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_custom_tools_created_by ON custom_tools(created_by);
CREATE INDEX idx_custom_tools_active_approved ON custom_tools(is_active, is_approved);

CREATE TABLE IF NOT EXISTS custom_skills (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) UNIQUE NOT NULL,
    description     TEXT NOT NULL,
    category        VARCHAR(50) DEFAULT 'custom',
    definition      TEXT NOT NULL,
    created_by      UUID NOT NULL REFERENCES users(id),
    is_public       BOOLEAN DEFAULT FALSE,
    is_approved     BOOLEAN DEFAULT FALSE,
    allowed_roles   VARCHAR(100) DEFAULT 'student,teacher,admin',
    version         VARCHAR(20) DEFAULT '1.0.0',
    usage_count     INTEGER DEFAULT 0,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_custom_skills_created_by ON custom_skills(created_by);
CREATE INDEX idx_custom_skills_active_approved ON custom_skills(is_active, is_approved);
