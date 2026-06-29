import { Router } from 'express';
import { validateAuthenticatedMiddleware } from '../../../lib/authlib.mjs';
import RateLimit from 'express-rate-limit';
import { getPool } from '../../../lib/dbHelper.mjs';
import { buildPermissionSnapshot, IAM_ROLE } from '../../../lib/iam.mjs';
import { buildPermissionTokenResponse } from '../../../lib/sessionToken.mjs';

const router = Router({ mergeParams: true });

router.use(RateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 100, // 100 requests
}));

function buildDemoSnapshot(course) {
    const demoUserEmail = getDemoUserEmail();
    const courseRoles = {};
    const internalCourseId = String(course?.id || '').trim();
    const gradescopeCourseId = String(course?.gradescope_course_id || '').trim();

    if (internalCourseId) {
        courseRoles[internalCourseId] = IAM_ROLE.COURSE_ADMIN;
    }
    if (gradescopeCourseId) {
        courseRoles[gradescopeCourseId] = IAM_ROLE.COURSE_ADMIN;
    }

    return {
        email: demoUserEmail,
        is_super: false,
        is_demo: true,
        demo_course_id: gradescopeCourseId || internalCourseId,
        generated_at: new Date().toISOString(),
        course_roles: courseRoles,
        has_course_admin: true,
        has_instructor: false,
        has_student: false,
    };
}

function getDemoCourseId() {
    return process.env.DEMO_COURSE_ID || 'demo_cs10_spring2025';
}

function getDemoUserEmail() {
    return (process.env.DEMO_USER_EMAIL || 'public-demo@gradeview.local').toLowerCase();
}

function isDemoAccessEnabled() {
    return process.env.DEMO_ACCESS_ENABLED !== 'false';
}

router.post('/demo', async (_, res) => {
    if (!isDemoAccessEnabled()) {
        return res.status(404).json({
            status: false,
            message: 'Demo access is disabled.',
        });
    }

    try {
        const demoCourseId = getDemoCourseId();
        const demoUserEmail = getDemoUserEmail();
        const result = await getPool().query(
            `
            SELECT
                c.id,
                c.gradescope_course_id,
                c.name,
                c.department,
                c.course_number,
                c.semester,
                c.year
            FROM courses c
            JOIN course_permissions cp ON cp.course_id = c.id
            JOIN users u ON u.id = cp.user_id
            WHERE (c.gradescope_course_id::text = $1 OR c.id::text = $1)
              AND LOWER(u.email) = LOWER($2)
              AND cp.permission_level = 'owner'
              AND u.is_active = true
              AND c.is_active = true
            LIMIT 1
            `,
            [demoCourseId, demoUserEmail],
        );

        const course = result.rows[0];
        if (!course) {
            return res.status(503).json({
                status: false,
                message: `Demo course is not configured. Run "cd gradesync && python3 create_demo_course.py --clean" and ensure DEMO_COURSE_ID is "${demoCourseId}".`,
            });
        }

        const snapshot = buildDemoSnapshot(course);

        console.log(JSON.stringify({
            event: 'iam.demo_login',
            email: demoUserEmail,
            course_id: course.gradescope_course_id || course.id,
        }));

        return res.status(200).json({
            ...buildPermissionTokenResponse(snapshot, {
                demo: true,
                demo_course_id: snapshot.demo_course_id,
            }),
            demo: true,
            email: demoUserEmail,
            name: 'GradeView Demo',
            demo_course: {
                id: String(course.id),
                gradescope_course_id: String(course.gradescope_course_id || ''),
                name: course.name || 'GradeView Demo Course',
                department: course.department || '',
                course_number: course.course_number || '',
                semester: course.semester || '',
                year: course.year || '',
            },
        });
    } catch (error) {
        console.error('Demo login failed:', error);
        return res.status(500).json({
            status: false,
            message: 'Demo login failed. Please try again later.',
        });
    }
});

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
