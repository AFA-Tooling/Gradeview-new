-- Canonical GradeView/GradeSync schema reference
-- Source aligned with migrations + SQLAlchemy models as of 2026-03-02.
-- Use this file for architecture review and local bootstrap reference.

BEGIN;

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    google_id VARCHAR(255) UNIQUE,
    profile_picture TEXT,
    name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'instructor' CHECK (role IN ('superadmin', 'admin', 'instructor', 'ta', 'readonly')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS courses (
    id SERIAL PRIMARY KEY,
    gradescope_course_id VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    department VARCHAR(255),
    course_number VARCHAR(255),
    semester VARCHAR(255),
    year VARCHAR(50),
    instructor VARCHAR(255),
    number_of_students INTEGER,
    owner_id INTEGER,
    is_active BOOLEAN DEFAULT true,
    last_synced_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE courses
    ADD CONSTRAINT fk_courses_owner_id
    FOREIGN KEY (owner_id) REFERENCES users(id);

CREATE TABLE IF NOT EXISTS course_permissions (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_level VARCHAR(50) DEFAULT 'viewer' CHECK (permission_level IN ('owner', 'editor', 'viewer')),
    granted_by INTEGER REFERENCES users(id),
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_course_user UNIQUE (course_id, user_id)
);

CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
    sid VARCHAR(255),
    email VARCHAR(255),
    legal_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_student_email_course UNIQUE (email, course_id)
);

CREATE TABLE IF NOT EXISTS assignments (
    id SERIAL PRIMARY KEY,
    assignment_id VARCHAR(255) NOT NULL,
    course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(255),
    category VARCHAR(255),
    max_points NUMERIC,
    assignment_metadata JSON,
    last_synced_at TIMESTAMP WITH TIME ZONE,
    gradescope_updated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS submissions (
    id SERIAL PRIMARY KEY,
    assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    total_score NUMERIC,
    max_points NUMERIC,
    status VARCHAR(255),
    submission_id VARCHAR(255),
    submission_time TIMESTAMP WITH TIME ZONE,
    lateness VARCHAR(255),
    view_count INTEGER,
    submission_count INTEGER,
    scores_by_question JSON,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_assignment_student UNIQUE (assignment_id, student_id)
);

CREATE TABLE IF NOT EXISTS summary_sheets (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    score NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT uq_summary_course_student_assignment UNIQUE (course_id, student_id, assignment_id)
);

CREATE TABLE IF NOT EXISTS course_configs (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL UNIQUE REFERENCES courses(id) ON DELETE CASCADE,
    gradescope_enabled BOOLEAN DEFAULT false,
    gradescope_course_id VARCHAR(255),
    gradescope_sync_interval_hours INTEGER DEFAULT 24,
    prairielearn_enabled BOOLEAN DEFAULT false,
    prairielearn_course_id VARCHAR(255),
    iclicker_enabled BOOLEAN DEFAULT false,
    iclicker_course_names TEXT[],
    database_enabled BOOLEAN DEFAULT true,
    use_as_primary BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assignment_categories (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    patterns TEXT[],
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_course_category UNIQUE (course_id, name)
);

CREATE TABLE IF NOT EXISTS system_config (
    id SERIAL PRIMARY KEY,
    key VARCHAR(255) UNIQUE NOT NULL,
    value TEXT,
    value_type VARCHAR(50) DEFAULT 'string' CHECK (value_type IN ('string', 'integer', 'boolean', 'json')),
    description TEXT,
    is_public BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gradeview_config (
    id SERIAL PRIMARY KEY,
    key VARCHAR(255) UNIQUE NOT NULL,
    value TEXT,
    value_type VARCHAR(50) DEFAULT 'string' CHECK (value_type IN ('string', 'integer', 'boolean', 'json')),
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS config_audit_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    table_name VARCHAR(100) NOT NULL,
    record_id INTEGER,
    action VARCHAR(50) NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Required indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE INDEX IF NOT EXISTS idx_course_permissions_course_id ON course_permissions(course_id);
CREATE INDEX IF NOT EXISTS idx_course_permissions_user_id ON course_permissions(user_id);

CREATE INDEX IF NOT EXISTS ix_students_course_id ON students(course_id);
CREATE INDEX IF NOT EXISTS idx_students_email ON students(email);

CREATE INDEX IF NOT EXISTS idx_assignments_course_id ON assignments(course_id);
CREATE INDEX IF NOT EXISTS idx_assignments_assignment_id ON assignments(assignment_id);

CREATE INDEX IF NOT EXISTS idx_submissions_assignment_id ON submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_submissions_student_id ON submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_submissions_submission_time ON submissions(submission_time);

CREATE INDEX IF NOT EXISTS idx_summary_sheets_course_id ON summary_sheets(course_id);
CREATE INDEX IF NOT EXISTS idx_summary_sheets_student_id ON summary_sheets(student_id);
CREATE INDEX IF NOT EXISTS idx_summary_sheets_assignment_id ON summary_sheets(assignment_id);

CREATE INDEX IF NOT EXISTS idx_course_configs_course_id ON course_configs(course_id);
CREATE INDEX IF NOT EXISTS idx_assignment_categories_course_id ON assignment_categories(course_id);

CREATE INDEX IF NOT EXISTS idx_config_audit_log_user_id ON config_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_config_audit_log_created_at ON config_audit_log(created_at);

COMMIT;
