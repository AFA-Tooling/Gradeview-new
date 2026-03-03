import { Router } from 'express';
import RateLimit from 'express-rate-limit';
import GradesRouter from './grades/index.js';
import ProjectionsRouter from './projections/index.js';
import ConceptStructureRouter from './concept-structure/index.js';
import CategoryStatsRouter from './category-stats/index.js';
import ExamPolicyRouter from './exam-policy/index.js';
import {
    validateAdminOrStudentMiddleware,
    validateStaffOrAdminMiddleware,
    validateStudentSelfOrStaffOrAdminMiddleware,
} from '../../../lib/authlib.mjs';
import { getStudentsByCourse, getStudentCourses, getAllStudentsFromDb, getStaffCourses } from '../../../lib/dbHelper.mjs';

const router = Router({ mergeParams: true });

// Rate limit calls to 100 per 5 minutes
router.use(
    RateLimit({
        windowMs: 5 * 60 * 1000, // 5 minutes
        max: 100, // 100 requests
    }),
);

// Current user's enrolled courses (students) or all courses (admins).
router.get('/courses', validateAdminOrStudentMiddleware, async (req, res) => {
    try {
        const authEmail = req?.auth?.email;
        const studentCourses = await getStudentCourses(authEmail);
        const staffCourses = await getStaffCourses(authEmail);

        const mapById = new Map();
        for (const course of [...studentCourses, ...staffCourses]) {
            const key = String(course?.id || course?.gradescope_course_id || '');
            if (!key) {
                continue;
            }
            if (!mapById.has(key)) {
                mapById.set(key, course);
            }
        }

        const courses = Array.from(mapById.values());
        return res.status(200).json({ courses });
    } catch (err) {
        console.error('Error fetching current user courses:', err);
        return res.status(500).json({ message: 'Internal server error.' });
    }
});

router.use('/category-stats', validateStaffOrAdminMiddleware, CategoryStatsRouter);

// Ensure only self-student, course staff/TA, or admin can access email-based resources.
router.use('/:email', validateStudentSelfOrStaffOrAdminMiddleware);

router.use('/:email/grades', GradesRouter);
router.use('/:email/projections', ProjectionsRouter);
router.use('/:email/concept-structure', ConceptStructureRouter);
router.use('/:email/exam-policy', ExamPolicyRouter);

router.get('/', validateStaffOrAdminMiddleware, async (req, res) => {
    try {
        const { course_id: courseId } = req.query;

        if (courseId) {
            const students = await getStudentsByCourse(courseId);
            return res.status(200).json({ students });
        }

        const students = await getAllStudentsFromDb();
        return res.status(200).json({ students });
    } catch (err) {
        console.error(`Internal service error fetching all students. `, err);
        return res.status(500).json({ message: "Internal server error." });
    }
});

export default router;
