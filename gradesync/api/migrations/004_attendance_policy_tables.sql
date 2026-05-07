-- Migration: Add attendance policy tables
-- Date: 2026-05-05
-- Description: Per-session attendance tracking and policy-aware effective scores
--
-- Hardcoded CS10 policy:
--   * lecture: required Mon/Wed only, drop lowest 5, makeup = "Lecture Quiz N"
--   * lab:     required (except Lab 1), drop lowest 5, makeup = full credit on "Lab N"
--   * discussion: required, drop lowest 1, makeup = "Discussion N" worksheet

CREATE TABLE IF NOT EXISTS student_attendance_effective_scores (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    kind VARCHAR(32) NOT NULL,                     -- 'lecture' | 'lab' | 'discussion'
    iclicker_assignment_id INTEGER REFERENCES assignments(id) ON DELETE SET NULL,
    total_required_sessions INTEGER NOT NULL,
    attended_sessions INTEGER NOT NULL,
    drops_applied INTEGER NOT NULL,
    effective_attended INTEGER NOT NULL,           -- attended after drops added
    effective_total INTEGER NOT NULL,              -- total - drops
    raw_percentage NUMERIC,                        -- attended / total * 100
    final_percentage NUMERIC,                      -- effective_attended / effective_total * 100
    details JSONB,                                  -- per-session breakdown
    computed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_attendance_effective UNIQUE (course_id, student_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_attendance_effective_course
    ON student_attendance_effective_scores(course_id);
CREATE INDEX IF NOT EXISTS idx_attendance_effective_student
    ON student_attendance_effective_scores(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_effective_kind
    ON student_attendance_effective_scores(kind);
CREATE INDEX IF NOT EXISTS idx_attendance_effective_final_pct
    ON student_attendance_effective_scores(final_percentage);

COMMENT ON TABLE student_attendance_effective_scores IS
    'Computed attendance scores per (student, kind) after iClicker + makeup + drop policy';
