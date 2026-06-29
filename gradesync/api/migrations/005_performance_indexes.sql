-- Migration: Add performance indexes for course-scoped grade views
-- Date: 2026-06-29
-- Description: Composite and covering indexes for admin score tables,
-- student profile loads, and policy summary queries.

CREATE INDEX IF NOT EXISTS idx_courses_id_text
    ON courses ((id::text));

CREATE INDEX IF NOT EXISTS idx_students_course_email_include_name
    ON students (course_id, email)
    INCLUDE (legal_name, sid);

CREATE INDEX IF NOT EXISTS idx_assignments_course_category_title
    ON assignments (course_id, category, title)
    INCLUDE (id, assignment_id, max_points);

CREATE INDEX IF NOT EXISTS idx_assignments_course_assignment_id
    ON assignments (course_id, assignment_id)
    INCLUDE (id, title, category, max_points);

CREATE INDEX IF NOT EXISTS idx_submissions_student_assignment_include_scores
    ON submissions (student_id, assignment_id)
    INCLUDE (total_score, max_points, submission_time, lateness);

CREATE INDEX IF NOT EXISTS idx_submissions_assignment_student_include_scores
    ON submissions (assignment_id, student_id)
    INCLUDE (total_score, max_points);

CREATE INDEX IF NOT EXISTS idx_effective_scores_course_exam_student
    ON student_exam_effective_scores (course_id, exam_type, student_id)
    INCLUDE (
        attempt_no,
        raw_percentage,
        question_best_percentage,
        clobbered_percentage,
        final_percentage,
        assignment_id,
        clobber_source_assignment_id
    );

CREATE INDEX IF NOT EXISTS idx_attendance_effective_course_student_kind
    ON student_attendance_effective_scores (course_id, student_id, kind)
    INCLUDE (
        total_required_sessions,
        attended_sessions,
        drops_applied,
        effective_attended,
        effective_total,
        raw_percentage,
        final_percentage
    );
