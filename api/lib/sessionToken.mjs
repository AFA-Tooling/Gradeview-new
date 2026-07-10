import { signAccessToken } from './jwtAuth.mjs';

export function getSessionCapabilities(source = {}) {
    const isDemo = source?.is_demo === true
        || source?.demo === true
        || source?.capabilities?.is_demo === true;
    const readOnly = isDemo
        || source?.read_only === true
        || source?.capabilities?.read_only === true;

    return {
        is_demo: isDemo,
        read_only: readOnly,
        demo_course_id: isDemo
            ? String(source?.demo_course_id || source?.capabilities?.demo_course_id || '').trim() || null
            : null,
    };
}

export function inheritSessionCapabilities(snapshot = {}, source = {}) {
    const capabilities = getSessionCapabilities(source);
    const demoCourseRoles = capabilities.is_demo
        ? { ...(source?.course_roles || {}) }
        : null;
    return {
        ...snapshot,
        ...(capabilities.is_demo ? {
            is_super: false,
            course_roles: demoCourseRoles,
            has_course_admin: source?.has_course_admin === true,
            has_instructor: source?.has_instructor === true,
            has_student: source?.has_student === true,
        } : {}),
        is_demo: capabilities.is_demo,
        read_only: capabilities.read_only,
        demo_course_id: capabilities.demo_course_id,
        capabilities,
        impersonated_by: source?.impersonated_by || snapshot?.impersonated_by || null,
    };
}

export function buildPermissionTokenPayload(snapshot = {}, extra = {}) {
    const effectiveSnapshot = inheritSessionCapabilities(snapshot, {
        ...snapshot,
        ...extra,
        capabilities: {
            ...(snapshot?.capabilities || {}),
            ...(extra?.capabilities || {}),
        },
    });

    return {
        sub: effectiveSnapshot.email,
        email: effectiveSnapshot.email,
        is_super: effectiveSnapshot.is_super === true,
        course_roles: effectiveSnapshot.course_roles || {},
        has_course_admin: effectiveSnapshot.has_course_admin === true,
        has_instructor: effectiveSnapshot.has_instructor === true,
        has_student: effectiveSnapshot.has_student === true,
        generated_at: effectiveSnapshot.generated_at || new Date().toISOString(),
        is_demo: effectiveSnapshot.is_demo,
        demo: effectiveSnapshot.is_demo,
        read_only: effectiveSnapshot.read_only,
        demo_course_id: effectiveSnapshot.demo_course_id,
        capabilities: effectiveSnapshot.capabilities,
        impersonated_by: effectiveSnapshot.impersonated_by,
    };
}

export function signPermissionSnapshot(snapshot = {}, extra = {}) {
    return signAccessToken(buildPermissionTokenPayload(snapshot, extra));
}

export function buildPermissionTokenResponse(snapshot = {}, extra = {}) {
    const effectiveSnapshot = inheritSessionCapabilities(snapshot, {
        ...snapshot,
        ...extra,
        capabilities: {
            ...(snapshot?.capabilities || {}),
            ...(extra?.capabilities || {}),
        },
    });
    const token = signPermissionSnapshot(effectiveSnapshot);
    return {
        status: true,
        token: `Bearer ${token}`,
        permissions: effectiveSnapshot,
        demo: effectiveSnapshot.is_demo,
        read_only: effectiveSnapshot.read_only,
    };
}
