import { studentEnrolledInCourse } from './dbHelper.mjs';
import { getPool } from './dbHelper.mjs';

export const SUPER_ADMIN_EMAIL = 'weszhang@berkeley.edu';

export const IAM_ROLE = {
    NONE: 'none',
    SUPER_ADMIN: 'super_admin',
    COURSE_ADMIN: 'course_admin',
    INSTRUCTOR: 'instructor',
    STUDENT: 'student',
};

export const ACCESS_ACTION = Object.freeze({
    READ: 'read',
    WRITE: 'write',
});

export const ACCESS_ERROR_CODE = Object.freeze({
    AUTH_REQUIRED: 'AUTH_REQUIRED',
    ROLE_FORBIDDEN: 'ROLE_FORBIDDEN',
    COURSE_SCOPE_REQUIRED: 'COURSE_SCOPE_REQUIRED',
    COURSE_SCOPE_FORBIDDEN: 'COURSE_SCOPE_FORBIDDEN',
    DEMO_READ_ONLY: 'DEMO_READ_ONLY',
});

const ACCESS_ERROR_DEFINITIONS = Object.freeze({
    [ACCESS_ERROR_CODE.AUTH_REQUIRED]: {
        status: 401,
        reason: 'Authentication is required for this request.',
        recovery: 'Sign in again, then retry the request.',
    },
    [ACCESS_ERROR_CODE.ROLE_FORBIDDEN]: {
        status: 403,
        reason: 'Your role does not permit this action.',
        recovery: 'Use an account with the required role or contact a GradeView administrator.',
    },
    [ACCESS_ERROR_CODE.COURSE_SCOPE_REQUIRED]: {
        status: 400,
        reason: 'Select exactly one course before accessing course data.',
        recovery: 'Choose a course and retry with its course_id.',
    },
    [ACCESS_ERROR_CODE.COURSE_SCOPE_FORBIDDEN]: {
        status: 403,
        reason: 'You do not have access to the selected course.',
        recovery: 'Choose a course assigned to your account or request course access.',
    },
    [ACCESS_ERROR_CODE.DEMO_READ_ONLY]: {
        status: 403,
        reason: 'Demo sessions are read-only and cannot change GradeView data.',
        recovery: 'Sign in with an authorized staff account to make changes.',
    },
});

export class AccessPolicyError extends Error {
    constructor(code, overrides = {}) {
        const definition = ACCESS_ERROR_DEFINITIONS[code]
            || ACCESS_ERROR_DEFINITIONS[ACCESS_ERROR_CODE.ROLE_FORBIDDEN];
        const reason = overrides.reason || definition.reason;
        super(reason);
        this.name = 'AccessPolicyError';
        this.status = overrides.status || definition.status;
        this.code = code;
        this.reason = reason;
        this.recovery = overrides.recovery || definition.recovery;
        this.isControlledApiError = true;
    }
}

export function createAccessPolicyError(code, overrides = {}) {
    return new AccessPolicyError(code, overrides);
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

const ROLE_PRIORITY = {
    [IAM_ROLE.NONE]: 0,
    [IAM_ROLE.STUDENT]: 1,
    [IAM_ROLE.INSTRUCTOR]: 2,
    [IAM_ROLE.COURSE_ADMIN]: 3,
    [IAM_ROLE.SUPER_ADMIN]: 4,
};

function pickHigherRole(currentRole, nextRole) {
    const currentPriority = ROLE_PRIORITY[currentRole] ?? 0;
    const nextPriority = ROLE_PRIORITY[nextRole] ?? 0;
    return nextPriority > currentPriority ? nextRole : currentRole;
}

function resolveCourseRoleFromDbRow(row) {
    const permissionLevel = String(row?.permission_level || '').toLowerCase();

    if (permissionLevel === 'owner') {
        return IAM_ROLE.COURSE_ADMIN;
    }

    if (['editor', 'viewer'].includes(permissionLevel)) {
        return IAM_ROLE.INSTRUCTOR;
    }

    return IAM_ROLE.NONE;
}

function upsertCourseRole(roleMap, key, role) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey || role === IAM_ROLE.NONE) {
        return;
    }
    const current = roleMap.get(normalizedKey) || IAM_ROLE.NONE;
    roleMap.set(normalizedKey, pickHigherRole(current, role));
}

function buildSnapshotFromRoleMap(email, courseRoleMap) {
    const roleEntries = [];
    for (const [courseKey, role] of courseRoleMap.entries()) {
        roleEntries.push({ courseKey, role });
    }

    const hasCourseAdmin = roleEntries.some((entry) => entry.role === IAM_ROLE.COURSE_ADMIN);
    const hasInstructor = roleEntries.some((entry) => entry.role === IAM_ROLE.INSTRUCTOR);
    const hasStudent = roleEntries.some((entry) => entry.role === IAM_ROLE.STUDENT);

    return {
        email,
        is_super: email === SUPER_ADMIN_EMAIL,
        generated_at: new Date().toISOString(),
        course_roles: Object.fromEntries(courseRoleMap.entries()),
        has_course_admin: hasCourseAdmin,
        has_instructor: hasInstructor,
        has_student: hasStudent,
    };
}

export async function buildPermissionSnapshot(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
        return buildSnapshotFromRoleMap('', new Map());
    }

    if (normalizedEmail === SUPER_ADMIN_EMAIL) {
        return {
            email: normalizedEmail,
            is_super: true,
            generated_at: new Date().toISOString(),
            course_roles: {},
            has_course_admin: true,
            has_instructor: true,
            has_student: true,
        };
    }

    const pool = getPool();
    const courseRoleMap = new Map();

    const staffResult = await pool.query(
        `
            SELECT
                c.id::text AS course_id,
                c.gradescope_course_id::text AS gradescope_course_id,
                cp.permission_level,
                u.role AS user_role
            FROM users u
            JOIN course_permissions cp ON cp.user_id = u.id
            JOIN courses c ON c.id = cp.course_id
            WHERE LOWER(u.email) = LOWER($1)
              AND u.is_active = true
              AND c.is_active = true
        `,
        [normalizedEmail],
    );

    for (const row of staffResult.rows) {
        const role = resolveCourseRoleFromDbRow(row);
        upsertCourseRole(courseRoleMap, row.course_id, role);
        upsertCourseRole(courseRoleMap, row.gradescope_course_id, role);
    }

    const studentResult = await pool.query(
        `
            SELECT
                c.id::text AS course_id,
                c.gradescope_course_id::text AS gradescope_course_id
            FROM students st
            JOIN courses c ON c.id = st.course_id
            WHERE LOWER(st.email) = LOWER($1)
              AND c.is_active = true
        `,
        [normalizedEmail],
    );

    for (const row of studentResult.rows) {
        upsertCourseRole(courseRoleMap, row.course_id, IAM_ROLE.STUDENT);
        upsertCourseRole(courseRoleMap, row.gradescope_course_id, IAM_ROLE.STUDENT);
    }

    return buildSnapshotFromRoleMap(normalizedEmail, courseRoleMap);
}

function getRoleFromSnapshot(snapshot, courseId = null) {
    if (!snapshot || typeof snapshot !== 'object') {
        return IAM_ROLE.NONE;
    }

    if (snapshot.is_super === true) {
        return IAM_ROLE.SUPER_ADMIN;
    }

    const roles = snapshot.course_roles || {};

    if (courseId) {
        const scoped = roles[String(courseId)] || IAM_ROLE.NONE;
        return scoped;
    }

    if (snapshot.has_course_admin) {
        return IAM_ROLE.COURSE_ADMIN;
    }
    if (snapshot.has_instructor) {
        return IAM_ROLE.INSTRUCTOR;
    }
    if (snapshot.has_student) {
        return IAM_ROLE.STUDENT;
    }

    return IAM_ROLE.NONE;
}

export async function resolveRole(email, courseId = null, snapshot = null) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
        return IAM_ROLE.NONE;
    }

    if (snapshot) {
        return getRoleFromSnapshot(snapshot, courseId);
    }

    const dbSnapshot = await buildPermissionSnapshot(normalizedEmail);
    return getRoleFromSnapshot(dbSnapshot, courseId);
}

export async function canViewStudentGrades({ requesterEmail, targetEmail, courseId = null, snapshot = null }) {
    const requester = normalizeEmail(requesterEmail);
    const target = normalizeEmail(targetEmail);

    if (!requester || !target) {
        return false;
    }

    const role = await resolveRole(requester, courseId, snapshot);
    if (role === IAM_ROLE.SUPER_ADMIN || role === IAM_ROLE.COURSE_ADMIN) {
        return true;
    }

    if (role === IAM_ROLE.INSTRUCTOR) {
        if (requester === target) {
            return true;
        }
        return Boolean(courseId);
    }

    if (role !== IAM_ROLE.STUDENT) {
        return false;
    }

    if (requester !== target) {
        return false;
    }

    if (!courseId) {
        return true;
    }

    return studentEnrolledInCourse(requester, String(courseId));
}

export async function canViewClassData({ requesterEmail, courseId = null, snapshot = null }) {
    const requester = normalizeEmail(requesterEmail);
    if (!requester) {
        return false;
    }

    const role = await resolveRole(requester, courseId, snapshot);
    if (role === IAM_ROLE.SUPER_ADMIN || role === IAM_ROLE.COURSE_ADMIN) {
        return true;
    }

    if (role === IAM_ROLE.INSTRUCTOR) {
        return Boolean(courseId);
    }

    return false;
}

export async function canManageSystem({ requesterEmail, snapshot = null }) {
    const requester = normalizeEmail(requesterEmail);
    if (!requester) {
        return false;
    }

    const role = await resolveRole(requester, null, snapshot);
    return role === IAM_ROLE.SUPER_ADMIN;
}

export async function canManageCourse({ requesterEmail, courseId, snapshot = null }) {
    const requester = normalizeEmail(requesterEmail);
    if (!requester || !courseId) {
        return false;
    }

    const role = await resolveRole(requester, courseId, snapshot);
    return role === IAM_ROLE.SUPER_ADMIN || role === IAM_ROLE.COURSE_ADMIN;
}

export async function getCourseAccessDecision({
    requesterEmail,
    courseId,
    action = ACCESS_ACTION.READ,
    snapshot = null,
}) {
    const normalizedCourseId = String(courseId || '').trim();
    if (!normalizedCourseId) {
        return {
            allowed: false,
            code: ACCESS_ERROR_CODE.COURSE_SCOPE_REQUIRED,
            role: IAM_ROLE.NONE,
        };
    }

    const role = await resolveRole(requesterEmail, normalizedCourseId, snapshot);
    const roleAllowsAction = action === ACCESS_ACTION.WRITE
        ? role === IAM_ROLE.SUPER_ADMIN || role === IAM_ROLE.COURSE_ADMIN
        : role === IAM_ROLE.SUPER_ADMIN
            || role === IAM_ROLE.COURSE_ADMIN
            || role === IAM_ROLE.INSTRUCTOR;

    if (!roleAllowsAction) {
        return {
            allowed: false,
            code: ACCESS_ERROR_CODE.COURSE_SCOPE_FORBIDDEN,
            role,
        };
    }

    const isReadOnly = snapshot?.read_only === true
        || snapshot?.is_demo === true
        || snapshot?.capabilities?.read_only === true;
    if (action === ACCESS_ACTION.WRITE && isReadOnly) {
        return {
            allowed: false,
            code: ACCESS_ERROR_CODE.DEMO_READ_ONLY,
            role,
        };
    }

    return {
        allowed: true,
        code: null,
        role,
    };
}

export function ensurePermission(
    allowed,
    errorMessage = 'not permitted',
    code = ACCESS_ERROR_CODE.ROLE_FORBIDDEN,
    overrides = {},
) {
    if (!allowed) {
        throw createAccessPolicyError(code, {
            ...overrides,
            reason: overrides.reason || errorMessage || undefined,
        });
    }
}

export function ensureCourseAccess(decision, overrides = {}) {
    ensurePermission(
        decision?.allowed === true,
        overrides.reason || null,
        decision?.code || ACCESS_ERROR_CODE.COURSE_SCOPE_FORBIDDEN,
        overrides,
    );
    return decision;
}
