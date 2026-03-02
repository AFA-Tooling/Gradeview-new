import { Router } from 'express';
import { validateAuthenticatedMiddleware } from '../../../lib/authlib.mjs';
import AuthorizationError from '../../../lib/errors/http/AuthorizationError.js';
import { IAM_ROLE, resolveRole } from '../../../lib/iam.mjs';
const router = Router({ mergeParams: true });

// Responds with whether or not the current user is an admin
router.get('/', validateAuthenticatedMiddleware, async (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        const { course_id: courseId } = req.query;
        if (!authHeader) {
            throw new AuthorizationError('Authorization Header is empty.');
        }
        const authEmail = req?.auth?.email;
        const role = await resolveRole(authEmail, courseId || null, req?.auth?.snapshot || null);
        const adminStatus = role === IAM_ROLE.SUPER_ADMIN || role === IAM_ROLE.COURSE_ADMIN;
        const staffStatus = role === IAM_ROLE.INSTRUCTOR;
        
        // --- ADDING DEBUG LOG ---
        console.log(`[AUTH_DEBUG] IAM role for ${authEmail}: ${role}`);
        
        return res.status(200).json({ isAdmin: adminStatus, isStaff: staffStatus, role });
    } catch (err) {
        switch (err.name) {
            case 'AuthorizationError':
                console.error('AuthorizationError:', err);
                return res.status(401).json({ message: err.message });
            default:
                console.error('Internal Server Error:', err);
                return res
                    .status(500)
                    .json({ message: 'Internal Server Error' });
        }
    }
});

export default router;
