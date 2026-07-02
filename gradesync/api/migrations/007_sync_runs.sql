-- Migration: Add GradeSync run tracking
-- Description: Records manual and maintainer sync attempts for observability.

CREATE TABLE IF NOT EXISTS sync_runs (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    trigger VARCHAR(50) NOT NULL DEFAULT 'manual',
    status VARCHAR(50) NOT NULL DEFAULT 'running',
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    summary JSONB,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_course_started
    ON sync_runs(course_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_runs_status_started
    ON sync_runs(status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_runs_trigger_started
    ON sync_runs(trigger, started_at DESC);

COMMENT ON TABLE sync_runs IS
    'Manual and scheduled GradeSync attempts, including status, summary, and errors';
