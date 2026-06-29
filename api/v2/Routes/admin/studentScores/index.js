import { Router } from 'express';
import {
    getAllStudentPolicySummaries,
    getAllStudentScores,
    getAssignmentDistribution,
    getCategorySummaryDistribution,
    getStudentPolicySummaries,
} from '../../../../lib/dbHelper.mjs';

const router = Router({ mergeParams: true });

function isPolicySummarySection(sectionName = '') {
    const normalized = String(sectionName || '').trim().toLowerCase();
    return Boolean(normalized)
        && normalized !== 'uncategorized'
        && !normalized.startsWith('_')
        && !normalized.endsWith('_raw')
        && !normalized.includes('_raw');
}

function normalizeSectionName(sectionName = '') {
    return String(sectionName || '').trim().toLowerCase();
}

function summarySectionMatches(rawSectionName = '', summarySectionName = '') {
    const raw = normalizeSectionName(rawSectionName);
    const summary = normalizeSectionName(summarySectionName);
    if (!raw || !summary) return false;
    if (raw === summary) return true;

    const categoryChecks = [
        ['attendance', ['attendance', 'attendence', 'participation']],
        ['labs', ['lab', 'labs']],
        ['projects', ['project', 'projects']],
        ['quest', ['quest']],
        ['midterm', ['midterm']],
        ['postterm', ['postterm', 'posterm']],
    ];

    return categoryChecks.some(([, terms]) => (
        terms.some((term) => raw.includes(term))
        && terms.some((term) => summary.includes(term))
    ));
}

function keepDisplayedPolicySections(summarySectionTotals = {}, studentScores = {}) {
    const visibleSummaryTotals = {};
    const summaryEntries = Object.entries(summarySectionTotals || {});

    Object.keys(studentScores || {}).forEach((rawSectionName) => {
        if (!isPolicySummarySection(rawSectionName)) return;
        const matchedSummary = summaryEntries.find(([summarySectionName]) => (
            summarySectionMatches(rawSectionName, summarySectionName)
        ));
        visibleSummaryTotals[rawSectionName] = Number(matchedSummary?.[1]) || 0;
    });

    return visibleSummaryTotals;
}

async function buildStudentsWithSummary(students = [], courseId = null) {
    const summariesByEmail = await getAllStudentPolicySummaries(courseId || null);

    return students.map((student) => {
        const studentEmail = String(student?.email || '').trim().toLowerCase();
        const summary = summariesByEmail.get(studentEmail) || {};
        const summarySectionTotals = keepDisplayedPolicySections(
            summary.summarySectionTotals || {},
            student?.scores || {},
        );

        return {
            ...student,
            summarySectionTotals,
        };
    });
}

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
        const studentsWithSummary = await buildStudentsWithSummary(students, courseId || null);
        
        const queryTime = Date.now() - startTime;
        console.log(`[PERF] Fetched all student scores from DB in ${queryTime}ms (${students.length} students)`);
        
        res.json({
            students: studentsWithSummary,
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
 * GET /admin/student-scores/summary/:email
 * Returns summary totals for one student using the exact same data source + function as list view.
 */
router.get('/summary/:email', async (req, res) => {
    const { email } = req.params;
    const { course_id: courseId } = req.query;

    try {
        const decodedEmail = decodeURIComponent(email || '').trim().toLowerCase();
        if (!decodedEmail) {
            return res.status(400).json({ error: 'Missing student email' });
        }

        const { summarySectionTotals, summaryTotal } = await getStudentPolicySummaries(decodedEmail, courseId || null);

        return res.json({
            email: decodedEmail,
            summarySectionTotals,
            summaryTotal,
        });
    } catch (error) {
        console.error('Error fetching student summary totals:', error);
        return res.status(500).json({ error: error.message || 'Failed to fetch student summary totals' });
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
        const ceilScore = (value) => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return 0;
            return Math.ceil(numeric);
        };

        let rows = [];

        if (decodedAssignment.includes('Summary')) {
            rows = await getCategorySummaryDistribution(decodedSection, courseId || null);
        } else {
            rows = await getAssignmentDistribution(decodedAssignment, decodedSection, courseId || null);
        }

        const matchingStudents = rows
            .map((row) => {
                const scoreVal = ceilScore(row.score);
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
