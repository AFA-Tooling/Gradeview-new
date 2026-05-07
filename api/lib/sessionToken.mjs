import { signAccessToken } from './jwtAuth.mjs';

export function buildPermissionTokenPayload(snapshot = {}, extra = {}) {
    return {
        sub: snapshot.email,
        email: snapshot.email,
        is_super: snapshot.is_super === true,
        course_roles: snapshot.course_roles || {},
        has_course_admin: snapshot.has_course_admin === true,
        has_instructor: snapshot.has_instructor === true,
        has_student: snapshot.has_student === true,
        generated_at: snapshot.generated_at || new Date().toISOString(),
        ...extra,
    };
}

export function signPermissionSnapshot(snapshot = {}, extra = {}) {
    return signAccessToken(buildPermissionTokenPayload(snapshot, extra));
}

export function buildPermissionTokenResponse(snapshot = {}, extra = {}) {
    const token = signPermissionSnapshot(snapshot, extra);
    return {
        status: true,
        token: `Bearer ${token}`,
        permissions: snapshot,
    };
}
