import { getEmailFromAuth } from './googleAuthHelper.mjs';
import {
    ACCESS_ACTION,
    ACCESS_ERROR_CODE,
    IAM_ROLE,
    canManageSystem,
    canViewClassData,
    canViewStudentGrades,
    createAccessPolicyError,
    ensureCourseAccess,
    ensurePermission,
    getCourseAccessDecision,
    resolveRole,
} from './iam.mjs';
import { verifyAccessToken } from './jwtAuth.mjs';
import { getSessionCapabilities } from './sessionToken.mjs';

function extractAuthorizationToken(req) {
    const headerValue = req?.headers?.authorization;
    if (!headerValue || typeof headerValue !== 'string') {
        return null;
    }
    const trimmed = headerValue.trim();
    if (trimmed.toLowerCase().startsWith('bearer ')) {
        return trimmed.slice(7).trim();
    }
    return trimmed;
}

export function getRequestedCourseId(req) {
    const value = req?.query?.course_id || req?.params?.courseId || req?.params?.course_id || null;
    if (Array.isArray(value)) {
        return null;
    }
    return String(value || '').trim() || null;
}

function isCourseScopedStaffRole(role) {
    return role === IAM_ROLE.COURSE_ADMIN || role === IAM_ROLE.INSTRUCTOR;
}

export async function getAuthContext(req) {
    try {
        validateAuthenticatedRequestFormat(req);
    } catch (error) {
        throw createAccessPolicyError(ACCESS_ERROR_CODE.AUTH_REQUIRED, {
            reason: error?.message || undefined,
        });
    }

    let authEmail;
    try {
        authEmail = await getEmailFromAuth(req);
    } catch (error) {
        if (error?.status === 401 || error?.name === 'AuthorizationError') {
            throw createAccessPolicyError(ACCESS_ERROR_CODE.AUTH_REQUIRED, {
                reason: error?.message || undefined,
            });
        }
        throw error;
    }
    const courseId = getRequestedCourseId(req);
    const rawToken = extractAuthorizationToken(req);

    let snapshot = null;
    if (rawToken) {
        try {
            const payload = verifyAccessToken(rawToken);
            const sessionCapabilities = getSessionCapabilities(payload);
            snapshot = {
                email: payload?.email || payload?.sub || authEmail,
                is_super: payload?.is_super === true,
                course_roles: payload?.course_roles || {},
                has_course_admin: payload?.has_course_admin === true,
                has_instructor: payload?.has_instructor === true,
                has_student: payload?.has_student === true,
                generated_at: payload?.generated_at || null,
                impersonated_by: payload?.impersonated_by || null,
                is_demo: sessionCapabilities.is_demo,
                read_only: sessionCapabilities.read_only,
                demo_course_id: sessionCapabilities.demo_course_id,
                capabilities: sessionCapabilities,
            };
        } catch {
            snapshot = null;
        }
    }

    const role = await resolveRole(authEmail, courseId, snapshot);

    req.auth = {
        email: authEmail,
        role,
        courseId,
        snapshot,
        snapshotFromToken: Boolean(snapshot),
        impersonatedBy: snapshot?.impersonated_by || null,
        isDemo: snapshot?.is_demo === true,
        readOnly: snapshot?.read_only === true,
    };

    return req.auth;
}

export async function validateAuthenticatedMiddleware(req, _, next) {
    await getAuthContext(req);
    next();
}

export function requireWritableSessionMiddleware(req, _, next) {
    const method = String(req?.method || '').toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        return next();
    }

    if (req?.auth?.readOnly === true || req?.auth?.snapshot?.read_only === true) {
        throw createAccessPolicyError(ACCESS_ERROR_CODE.DEMO_READ_ONLY);
    }

    return next();
}

/**
 * Validates that the requester is either an admin or a student.
 * @param {Request} req request to validate.
 * @param {*} _
 * @param {Function} next trigger the next middleware / request.
 */
export async function validateAdminOrStudentMiddleware(req, _, next) {
    const auth = await getAuthContext(req);
    ensurePermission(
        auth.role === IAM_ROLE.SUPER_ADMIN
            || auth.role === IAM_ROLE.COURSE_ADMIN
            || auth.role === IAM_ROLE.INSTRUCTOR
            || auth.role === IAM_ROLE.STUDENT,
        'You are not assigned as a student or staff in any active course.',
    );
    next();
}

/**
 * Validates that an admin request is permitted.
 * @param {Request} req the request to validate.
 * @param {*} _
 * @param {Function} next trigger the next middleware / request.
 * @throws {UnauthorizedAccessError} if the requester is not an admin.
 */
export async function validateAdminMiddleware(req, _, next) {
    const auth = await getAuthContext(req);
    const allowed = await canManageSystem({ requesterEmail: auth.email, snapshot: auth.snapshot });
    ensurePermission(allowed, 'admin permission required');

    next();
}

export async function validateStaffOrAdminMiddleware(req, _, next) {
    const auth = await getAuthContext(req);
    if (!auth.courseId) {
        ensurePermission(false, null, ACCESS_ERROR_CODE.COURSE_SCOPE_REQUIRED);
    }

    const allowed = await canViewClassData({
        requesterEmail: auth.email,
        courseId: auth.courseId,
        snapshot: auth.snapshot,
    });
    ensurePermission(
        allowed,
        null,
        auth.courseId ? ACCESS_ERROR_CODE.COURSE_SCOPE_FORBIDDEN : ACCESS_ERROR_CODE.ROLE_FORBIDDEN,
    );
    next();
}

export async function validateAdminPortalMiddleware(req, _, next) {
    const auth = req?.auth || await getAuthContext(req);
    ensurePermission(
        auth.role === IAM_ROLE.SUPER_ADMIN
            || auth.role === IAM_ROLE.COURSE_ADMIN
            || auth.role === IAM_ROLE.INSTRUCTOR,
        null,
        auth.courseId ? ACCESS_ERROR_CODE.COURSE_SCOPE_FORBIDDEN : ACCESS_ERROR_CODE.ROLE_FORBIDDEN,
    );
    next();
}

export async function validateCourseAdminOrSuperMiddleware(req, _, next) {
    const auth = await getAuthContext(req);
    const courseId = req?.params?.courseId || auth.courseId;
    const decision = await getCourseAccessDecision({
        requesterEmail: auth.email,
        courseId,
        action: ACCESS_ACTION.WRITE,
        snapshot: auth.snapshot,
    });
    ensureCourseAccess(decision);
    next();
}

export async function validateStudentSelfOrStaffOrAdminMiddleware(req, _, next) {
    const auth = await getAuthContext(req);
    const requiresCourseScope = auth.role === IAM_ROLE.SUPER_ADMIN || isCourseScopedStaffRole(auth.role);
    if (requiresCourseScope && !auth.courseId) {
        ensurePermission(false, null, ACCESS_ERROR_CODE.COURSE_SCOPE_REQUIRED);
    }

    const allowed = await canViewStudentGrades({
        requesterEmail: auth.email,
        targetEmail: req.params?.email,
        courseId: auth.courseId,
        snapshot: auth.snapshot,
    });
    ensurePermission(
        allowed,
        null,
        auth.courseId ? ACCESS_ERROR_CODE.COURSE_SCOPE_FORBIDDEN : ACCESS_ERROR_CODE.ROLE_FORBIDDEN,
    );
    next();
}

/**
 * Validates that a student request is permitted.
 * @param {Request} req the request to validate.
 * @param {*} _
 * @param {Function} next trigger the next middleware / request.
 * @throws {AuthorizationError} if the domain is not berkeley.
 * @throws {UnauthorizedAccessError} if the requester is not the route email param.
 */
export async function validateStudentMiddleware(req, _, next) {
    const auth = await getAuthContext(req);
    const { email } = req.params;

    if (auth.role !== IAM_ROLE.STUDENT) {
        throw createAccessPolicyError(ACCESS_ERROR_CODE.ROLE_FORBIDDEN, {
            reason: 'You are not a registered student.',
        });
    }

    if (email && auth.email !== email) {
        throw createAccessPolicyError(ACCESS_ERROR_CODE.ROLE_FORBIDDEN);
    }

    next();
}

/**
 * Validates that a request has authorization headers.
 * @param {Request} req the request object to validate.
 * @throws {AuthorizationError} if the request does not have an authorization header.
 */
function validateAuthenticatedRequestFormat(req) {
    let token = req.headers['authorization'];
    if (!token) {
        throw createAccessPolicyError(ACCESS_ERROR_CODE.AUTH_REQUIRED, {
            reason: 'no authorization token provided.',
        });
    }
}
