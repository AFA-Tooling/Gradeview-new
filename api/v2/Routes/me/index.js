import { Router } from 'express';
import { validateAuthenticatedMiddleware } from '../../../lib/authlib.mjs';
import {
    buildPermissionSnapshot,
    canManageSystem,
    resolveRole,
} from '../../../lib/iam.mjs';
import {
    buildPermissionTokenResponse,
    inheritSessionCapabilities,
} from '../../../lib/sessionToken.mjs';

const router = Router({ mergeParams: true });

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function summarizeCourseRoles(snapshot = {}) {
    return Object.entries(snapshot.course_roles || {})
        .map(([course_id, role]) => ({ course_id, role }))
        .sort((a, b) => String(a.course_id).localeCompare(String(b.course_id)));
}

router.get('/permissions', validateAuthenticatedMiddleware, async (req, res) => {
    const email = req?.auth?.email;
    const courseId = req?.query?.course_id || null;
    const snapshot = inheritSessionCapabilities(
        await buildPermissionSnapshot(email),
        req?.auth?.snapshot || {},
    );
    const role = await resolveRole(email, courseId, snapshot);

    console.log(JSON.stringify({
        event: 'iam.permissions_refresh',
        email,
        role,
        course_id: courseId,
        snapshot_from_token: req?.auth?.snapshotFromToken === true,
    }));

    return res.status(200).json({
        ...buildPermissionTokenResponse(snapshot),
        role,
        course_id: courseId,
    });
});

router.get('/iam-debug', validateAuthenticatedMiddleware, async (req, res) => {
    const requesterEmail = req?.auth?.email;
    const allowed = await canManageSystem({
        requesterEmail,
        snapshot: req?.auth?.snapshot || null,
    });

    if (!allowed) {
        return res.status(403).json({ error: 'super admin permission required' });
    }

    const targetEmail = normalizeEmail(req?.query?.email);
    if (!targetEmail) {
        return res.status(400).json({ error: 'email is required' });
    }

    const courseId = req?.query?.course_id || null;
    const snapshot = await buildPermissionSnapshot(targetEmail);
    const role = await resolveRole(targetEmail, courseId, snapshot);

    return res.status(200).json({
        email: targetEmail,
        course_id: courseId,
        role,
        permissions: snapshot,
        course_roles: summarizeCourseRoles(snapshot),
    });
});

export default router;
