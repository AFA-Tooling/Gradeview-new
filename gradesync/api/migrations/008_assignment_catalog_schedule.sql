-- Migration: Store authoritative assignment catalog schedule and visibility.
-- Gradescope exposes these values in AssignmentsTable.data-react-props.

ALTER TABLE assignments
    ADD COLUMN IF NOT EXISTS source_type VARCHAR(50),
    ADD COLUMN IF NOT EXISTS release_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS due_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS late_due_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS is_published BOOLEAN,
    ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS catalog_last_seen_at TIMESTAMP WITH TIME ZONE;

UPDATE assignments
SET is_visible = TRUE
WHERE is_visible IS NULL;

CREATE INDEX IF NOT EXISTS idx_assignments_course_due
    ON assignments(course_id, due_at);

CREATE INDEX IF NOT EXISTS idx_assignments_course_visible
    ON assignments(course_id, is_visible);

CREATE INDEX IF NOT EXISTS idx_assignments_catalog_last_seen
    ON assignments(catalog_last_seen_at);

COMMENT ON COLUMN assignments.due_at IS
    'Authoritative assignment due time normalized to UTC';
COMMENT ON COLUMN assignments.late_due_at IS
    'Authoritative hard/late due time normalized to UTC';
COMMENT ON COLUMN assignments.catalog_last_seen_at IS
    'Last successful source catalog observation, separate from evidence sync';
