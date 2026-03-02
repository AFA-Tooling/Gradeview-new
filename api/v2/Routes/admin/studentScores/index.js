import { Router } from 'express';
import {
    getAllStudentScores,
    getAssignmentDistribution,
    getCategorySummaryDistribution,
} from '../../../../lib/dbHelper.mjs';

const router = Router({ mergeParams: true });

/**
 * GET /admin/student-scores
 * Returns all student scores in the format expected by admin.jsx
 * OPTIMIZED: Uses a single database query
 */
router.get('/', async (req, res) => {
    const startTime = Date.now();
    const { course_id: courseId } = req.query;
    
    try {
        const students = await getAllStudentScores(courseId || null);
        
        const queryTime = Date.now() - startTime;
        console.log(`[PERF] Fetched all student scores from DB in ${queryTime}ms (${students.length} students)`);
        
        res.json({
            students: students,
            dataSource: 'database',
            queryTime: queryTime
        });
    } catch (error) {
        console.error('Error fetching student scores:', error);
        res.status(500).json({ 
            error: error.message || 'Failed to fetch student scores',
            students: []
        });
    }
});

/**
 * GET /admin/students-by-score/:section/:assignment/:score
 * Returns students who achieved the specified score on the assignment.
 * Score can be a range (e.g., "50-74") or a single value.
 * This endpoint now caches distribution data internally to avoid re-traversal.
 */
router.get('/:section/:assignment/:score', async (req, res) => {
    const { section, assignment, score } = req.params;
    const { course_id: courseId } = req.query;
    // Decode parameters
    const decodedSection = decodeURIComponent(section);
    const decodedAssignment = decodeURIComponent(assignment);
    const decodedScore = decodeURIComponent(score);
    
    // Parse score - could be a range "min-max" or a single value
    let minScore, maxScore;
    if (decodedScore.includes('-')) {
        const parts = decodedScore.split('-');
        minScore = parseInt(parts[0]) || 0;
        maxScore = parseInt(parts[1]) || 0;
    } else {
        const val = parseInt(decodedScore) || 0;
        minScore = val;
        maxScore = val;
    }

    try {
        let rows = [];

        if (decodedAssignment.includes('Summary')) {
            rows = await getCategorySummaryDistribution(decodedSection, courseId || null);
        } else {
            rows = await getAssignmentDistribution(decodedAssignment, decodedSection, courseId || null);
        }

        const matchingStudents = rows
            .map((row) => {
                const scoreVal = Number(row.score);
                return {
                    name: row.studentName,
                    email: row.studentEmail,
                    score: scoreVal
                };
            })
            .filter((student) => !Number.isNaN(student.score) && student.score >= minScore && student.score <= maxScore);

        res.json({ students: matchingStudents });
    } catch (error) {
        console.error('Error fetching students for score %s on %s:', decodedScore, decodedAssignment, error);
        res.status(500).json({ 
            error: error.message || 'Failed to fetch students by score',
            students: []
        });
    }
});


export default router;