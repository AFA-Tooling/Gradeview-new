import { Router } from 'express';
import { validateAuthenticatedMiddleware } from '../../../lib/authlib.mjs';
import RateLimit from 'express-rate-limit';
import { buildPermissionSnapshot } from '../../../lib/iam.mjs';
import { buildPermissionTokenResponse } from '../../../lib/sessionToken.mjs';

const router = Router({ mergeParams: true });

router.use(RateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 100, // 100 requests
}));

router.get('/', validateAuthenticatedMiddleware, async (req, res) => {
    const email = req?.auth?.email;
    const snapshot = await buildPermissionSnapshot(email);
    const role = req?.auth?.role || null;
    console.log(JSON.stringify({
        event: 'iam.login',
        email,
        role,
        course_id: req?.auth?.courseId || null,
        snapshot_from_token: req?.auth?.snapshotFromToken === true,
    }));

    res.send(buildPermissionTokenResponse(snapshot));
}, (error, req, res, next) => {
    // If an error occurs in the middleware, return a useful reason.
    const message = error?.message || 'Login failed.';
    res.send({ status: false, message });
});

export default router;
