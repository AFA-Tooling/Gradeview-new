import { Router } from 'express';
import {
    getStudentSubmissionsByTime,
    getStudentSubmissionsGrouped,
    getStudentCourses,
    studentEnrolledInCourse,
    getCourseAssignmentMatrix,
} from '../../../../lib/dbHelper.mjs';
import { IAM_ROLE } from '../../../../lib/iam.mjs';

const router = Router({ mergeParams: true });

router.get('/', async (req, res) => {
    const { email } = req.params;
    const { sort, format, course_id: courseId } = req.query; // sort: 'time' or 'assignment' (default), format: 'list' or 'grouped'
    
    try {
        const authEmail = req?.auth?.email;
        const requesterRole = req?.auth?.role;
        const requesterIsPrivileged = [IAM_ROLE.SUPER_ADMIN, IAM_ROLE.COURSE_ADMIN, IAM_ROLE.INSTRUCTOR].includes(requesterRole);

        if (!requesterIsPrivileged && authEmail !== email) {
            return res.status(403).json({ message: 'Access denied.' });
        }

        if (courseId && !requesterIsPrivileged) {
            const enrolled = await studentEnrolledInCourse(email, courseId);
            if (!enrolled) {
                return res.status(403).json({ message: 'Access denied for requested course.' });
            }
        }

        if (!courseId && !requesterIsPrivileged) {
            const studentCourses = await getStudentCourses(email);
            if (studentCourses.length > 0) {
                const defaultCourseId = studentCourses[0].gradescope_course_id || studentCourses[0].id;
                req.query.course_id = String(defaultCourseId);
            }
        }

        const effectiveCourseId = req.query.course_id || courseId || null;

        // Handle time-based sorting from PostgreSQL
        if (sort === 'time') {
            const submissionsByTime = await getStudentSubmissionsByTime(email, effectiveCourseId);
            
            if (!submissionsByTime || submissionsByTime.length === 0) {
                return res.status(200).json([]);
            }
            
            // Return array format with submission times for chronological view
            return res.status(200).json({
                sortBy: 'time',
                submissions: submissionsByTime,
            });
        }
        
        // Handle grouped format from PostgreSQL
        if (format === 'db') {
            const groupedSubmissions = await getStudentSubmissionsGrouped(email, effectiveCourseId);
            const maxScores = await getCourseAssignmentMatrix(effectiveCourseId);
            
            return res.status(200).json(
                getStudentScoresWithMaxPointsAndTime(groupedSubmissions, maxScores)
            );
        }

        const groupedSubmissions = await getStudentSubmissionsGrouped(email, effectiveCourseId);
        const maxScores = await getCourseAssignmentMatrix(effectiveCourseId);
        return res.status(200).json(
            getStudentScoresWithMaxPointsAndTime(groupedSubmissions, maxScores)
        );
    } catch (err) {
        console.error("Internal service error for student with email %s", email, err);
        return res.status(500).json({ message: "Internal server error." });
    }
});

/**
 * Gets the student's scores but with the max points added on.
 * @param {object} studentScores the student's scores.
 * @param {object} maxScores the maximum possible scores.
 * @returns {object} students scores with max points.
 */
function getStudentScoresWithMaxPointsAndTime(studentScores, maxScores) {
    return Object.keys(studentScores).reduce((assignmentsDict, assignment) => {
        assignmentsDict[assignment] = Object.entries(
            studentScores[assignment],
        ).reduce((scoresDict, [category, data]) => {
            const maxScore = maxScores?.[assignment]?.[category] ?? data.max;
            scoresDict[category] = {
                student: data.student,
                max: maxScore,
                submissionTime: data.submissionTime,
                lateness: data.lateness,
            };
            return scoresDict;
        }, {});
        return assignmentsDict;
    }, {});
}

export default router;
