import { Router } from 'express';
import { getAssignmentDistribution, getCategorySummaryDistribution } from '../../../../lib/dbHelper.mjs';
const router = Router({ mergeParams: true });

/**
 * GET /admin/stats/:section/:name
 * Returns statistics for a specific assignment
 * Returns: { average, max, min, count }
 */
router.get('/:section/:name', async (req, res) => {
    try {
        const { section, name } = req.params;
        const { course_id: courseId } = req.query;

        const ceilScore = (value) => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return 0;
            return Math.ceil(numeric);
        };

        let scores = [];
        if (name.includes('Summary')) {
            const summaryRows = await getCategorySummaryDistribution(section, courseId || null);
            scores = summaryRows.map((row) => ceilScore(row.score)).filter((score) => !Number.isNaN(score));
        } else {
            const assignmentRows = await getAssignmentDistribution(name, section, courseId || null);
            scores = assignmentRows.map((row) => ceilScore(row.score)).filter((score) => !Number.isNaN(score));
        }

        if (scores.length === 0) {
            return res.json({
                average: 0,
                max: 0,
                min: 0,
                count: 0,
                median: 0
            });
        }

        const sum = scores.reduce((a, b) => a + b, 0);

        const average = sum / scores.length;
        const max = Math.max(...scores);
        const min = Math.min(...scores);
        
        const sorted = [...scores].sort((a, b) => a - b); 
        
        const median = sorted.length % 2 === 0
            ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
            : sorted[Math.floor(sorted.length / 2)];

        return res.json({
            average: parseFloat(average.toFixed(2)),
            max,
            min,
            median: parseFloat(median.toFixed(2)),
            count: scores.length
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch stats' });
    }
});

export default router;
