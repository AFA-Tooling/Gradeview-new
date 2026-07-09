import { Router } from 'express';
import { getStudentGradeFlow } from '../../../../lib/dbHelper.mjs';

const router = Router({ mergeParams: true });

router.get('/', async (req, res) => {
    const { email } = req.params;
    const { course_id: courseId } = req.query;

    try {
        const graph = await getStudentGradeFlow(email, courseId || null);
        return res.status(200).json(graph);
    } catch (err) {
        console.error('Error building student grade-flow graph:', err);
        const status = Number(err?.status) || 500;
        return res.status(status).json({
            message: status < 500 ? err.message : 'Internal server error.',
            code: err?.code || 'GRADE_FLOW_BUILD_FAILED',
            details: err?.details || null,
            error: err?.message || 'Failed to build grade-flow graph',
        });
    }
});

export default router;
