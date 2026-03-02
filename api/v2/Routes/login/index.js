import { Router } from 'express';
import { validateAdminOrStudentMiddleware } from '../../../lib/authlib.mjs';
import RateLimit from 'express-rate-limit';
import { buildPermissionSnapshot } from '../../../lib/iam.mjs';
import { signAccessToken } from '../../../lib/jwtAuth.mjs';

const router = Router({ mergeParams: true });

router.use(RateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 100, // 100 requests
}));

router.get('/', validateAdminOrStudentMiddleware, async (req, res) => {
    const email = req?.auth?.email;
    const snapshot = await buildPermissionSnapshot(email);

    const token = signAccessToken({
        sub: snapshot.email,
        email: snapshot.email,
        is_super: snapshot.is_super,
        course_roles: snapshot.course_roles,
        has_course_admin: snapshot.has_course_admin,
        has_instructor: snapshot.has_instructor,
        has_student: snapshot.has_student,
    });

    res.send({
        status: true,
        token: `Bearer ${token}`,
        permissions: snapshot,
    });
}, (error, req, res, next) => {
    // If an error occurs in the middleware, return a useful reason.
    const message = error?.message || 'Login failed.';
    res.send({ status: false, message });
});

export default router;
