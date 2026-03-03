-- Migration: Add exam policy mapping and effective score tables
-- Date: 2026-03-02
-- Description: Adds tables for clobber/question-best policy computation

CREATE TABLE IF NOT EXISTS exam_attempt_map (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    assignment_id INTEGER NOT NULL UNIQUE REFERENCES assignments(id) ON DELETE CASCADE,
    exam_type VARCHAR(32) NOT NULL,
    attempt_no INTEGER NOT NULL,
    is_mandatory BOOLEAN DEFAULT false,
    is_practice BOOLEAN DEFAULT false,
    release_at TIMESTAMP WITH TIME ZONE,
    due_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_exam_attempt_assignment UNIQUE (course_id, exam_type, attempt_no, assignment_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_attempt_map_course ON exam_attempt_map(course_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempt_map_exam_type ON exam_attempt_map(exam_type);
CREATE INDEX IF NOT EXISTS idx_exam_attempt_map_attempt_no ON exam_attempt_map(attempt_no);

CREATE TABLE IF NOT EXISTS student_exam_effective_scores (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    exam_type VARCHAR(32) NOT NULL,
    attempt_no INTEGER NOT NULL,
    assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    raw_percentage NUMERIC,
    question_best_percentage NUMERIC,
    clobbered_percentage NUMERIC,
    final_percentage NUMERIC,
    clobber_source_assignment_id INTEGER REFERENCES assignments(id),
    details JSONB,
    computed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_effective_exam_attempt UNIQUE (course_id, student_id, exam_type, attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_effective_scores_course ON student_exam_effective_scores(course_id);
CREATE INDEX IF NOT EXISTS idx_effective_scores_student ON student_exam_effective_scores(student_id);
CREATE INDEX IF NOT EXISTS idx_effective_scores_exam_type ON student_exam_effective_scores(exam_type);
CREATE INDEX IF NOT EXISTS idx_effective_scores_final_pct ON student_exam_effective_scores(final_percentage);

COMMENT ON TABLE exam_attempt_map IS 'Maps assignments to policy-aware exam attempts (quest/midterm/postterm)';
COMMENT ON TABLE student_exam_effective_scores IS 'Computed effective scores after clobber and question-best policies';
