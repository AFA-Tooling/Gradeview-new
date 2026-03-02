import AuthorizationError from './errors/http/AuthorizationError.js';
import UnauthorizedAccessError from './errors/http/UnauthorizedAccessError.js';
import { getEmailFromAuth } from './googleAuthHelper.mjs';
import {
    IAM_ROLE,
    canManageSystem,
    canViewClassData,
    canViewStudentGrades,
    ensurePermission,
    resolveRole,
    canManageCourse,
} from './iam.mjs';
import { verifyAccessToken } from './jwtAuth.mjs';

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

function getRequestedCourseId(req) {
    return req?.query?.course_id || req?.params?.courseId || req?.params?.course_id || null;
}

async function getAuthContext(req) {
    validateAuthenticatedRequestFormat(req);

    const authEmail = await getEmailFromAuth(req);
    const courseId = getRequestedCourseId(req);
    const rawToken = extractAuthorizationToken(req);

    let snapshot = null;
    if (rawToken) {
        try {
            const payload = verifyAccessToken(rawToken);
            snapshot = {
                email: payload?.email || payload?.sub || authEmail,
                is_super: payload?.is_super === true,
                course_roles: payload?.course_roles || {},
                has_course_admin: payload?.has_course_admin === true,
                has_instructor: payload?.has_instructor === true,
                has_student: payload?.has_student === true,
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
    };

    return req.auth;
}

export async function validateAuthenticatedMiddleware(req, _, next) {
    await getAuthContext(req);
    next();
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
    const allowed = await canViewClassData({
        requesterEmail: auth.email,
        courseId: auth.courseId,
        snapshot: auth.snapshot,
    });
    ensurePermission(allowed, 'staff/admin permission required');
    next();
}

export async function validateAdminPortalMiddleware(req, _, next) {
    const auth = await getAuthContext(req);
    ensurePermission(
        auth.role === IAM_ROLE.SUPER_ADMIN || auth.role === IAM_ROLE.COURSE_ADMIN,
        'admin permission required',
    );
    next();
}

export async function validateCourseAdminOrSuperMiddleware(req, _, next) {
    const auth = await getAuthContext(req);
    const courseId = req?.params?.courseId || auth.courseId;
    const allowed = await canManageCourse({
        requesterEmail: auth.email,
        courseId,
        snapshot: auth.snapshot,
    });
    ensurePermission(allowed, 'course admin permission required');
    next();
}

export async function validateStudentSelfOrStaffOrAdminMiddleware(req, _, next) {
    const auth = await getAuthContext(req);
    const allowed = await canViewStudentGrades({
        requesterEmail: auth.email,
        targetEmail: req.params?.email,
        courseId: auth.courseId,
        snapshot: auth.snapshot,
    });
    ensurePermission(allowed, 'not permitted');
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
        throw new AuthorizationError('You are not a registered student.');
    }

    if (email && auth.email !== email) {
        throw new UnauthorizedAccessError('not permitted');
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
        throw new AuthorizationError('no authorization token provided.');
    }
}
