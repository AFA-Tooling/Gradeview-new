import { Router } from 'express';
import { validateAuthenticatedMiddleware } from '../../../lib/authlib.mjs';
import {
    IAM_ROLE,
    SUPER_ADMIN_EMAIL,
    buildPermissionSnapshot,
} from '../../../lib/iam.mjs';
import { buildPermissionTokenResponse } from '../../../lib/sessionToken.mjs';

const router = Router({ mergeParams: true });

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function isDevImpersonationEnabled() {
    return process.env.ALLOW_DEV_IMPERSONATION === 'true'
        && process.env.NODE_ENV !== 'production';
}

function hasAnyPermission(snapshot = {}) {
    return snapshot.is_super === true
        || snapshot.has_course_admin === true
        || snapshot.has_instructor === true
        || snapshot.has_student === true;
}

router.post('/impersonate', validateAuthenticatedMiddleware, async (req, res) => {
    if (!isDevImpersonationEnabled()) {
        return res.status(404).json({ error: 'dev impersonation is disabled' });
    }

    const requesterEmail = normalizeEmail(req?.auth?.email);
    if (requesterEmail !== SUPER_ADMIN_EMAIL || req?.auth?.role !== IAM_ROLE.SUPER_ADMIN) {
        return res.status(403).json({ error: 'super admin permission required' });
    }

    const targetEmail = normalizeEmail(req?.body?.email);
    if (!targetEmail) {
        return res.status(400).json({ error: 'email is required' });
    }

    const snapshot = await buildPermissionSnapshot(targetEmail);
    if (!hasAnyPermission(snapshot)) {
        return res.status(404).json({ error: 'target user has no active GradeView permissions' });
    }

    console.log(JSON.stringify({
        event: 'iam.dev_impersonate',
        requester: requesterEmail,
        target: targetEmail,
    }));

    return res.status(200).json({
        ...buildPermissionTokenResponse(snapshot, { impersonated_by: requesterEmail }),
        impersonated_by: requesterEmail,
    });
});

export default router;
