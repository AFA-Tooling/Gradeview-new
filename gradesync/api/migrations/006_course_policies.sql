-- Migration: Add per-course grading policy configuration
-- Description: Stores syllabus-level buckets, grade bins, component caps, and
--              rollup rules so new courses do not require code changes.

CREATE TABLE IF NOT EXISTS course_policies (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL UNIQUE REFERENCES courses(id) ON DELETE CASCADE,
    policy_version TEXT NOT NULL DEFAULT 'v1',
    is_active BOOLEAN NOT NULL DEFAULT true,
    total_points_cap NUMERIC NOT NULL DEFAULT 400,
    rounding_policy TEXT,
    grade_bins JSONB NOT NULL DEFAULT '[]'::jsonb,
    component_percentages JSONB NOT NULL DEFAULT '[]'::jsonb,
    components JSONB NOT NULL DEFAULT '[]'::jsonb,
    assignment_points JSONB NOT NULL DEFAULT '{}'::jsonb,
    rules JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_course_policies_course_id
    ON course_policies(course_id);

CREATE INDEX IF NOT EXISTS idx_course_policies_active
    ON course_policies(course_id, is_active);

COMMENT ON TABLE course_policies IS
    'Per-course grading policy: syllabus buckets, grade bins, caps, and rollup rules';
