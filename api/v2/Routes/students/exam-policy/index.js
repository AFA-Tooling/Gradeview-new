import { Router } from 'express';
import { getStudentExamPolicyScores, getStudentExamComponentTrends, getStudentQuestComponentTrend } from '../../../../lib/dbHelper.mjs';

const router = Router({ mergeParams: true });

router.get('/', async (req, res) => {
    const { email } = req.params;
    const { course_id: courseId } = req.query;

    try {
        const rows = await getStudentExamPolicyScores(email, courseId || null);
        const examComponentTrends = await getStudentExamComponentTrends(email, courseId || null);
        const questComponentTrend = examComponentTrends.quest || await getStudentQuestComponentTrend(email, courseId || null);
        return res.status(200).json({
            rows,
            total: rows.length,
            questComponentTrend,
            examComponentTrends,
        });
    } catch (err) {
        console.error('Error fetching student exam policy scores:', err);
        return res.status(500).json({ message: 'Internal server error.' });
    }
});

export default router;
