import { Router } from 'express';
import { getMaxPointsSoFar } from '../../../../lib/studentHelper.mjs';
import {
    getStudentSubmissionsGrouped,
    getCourseAssignmentMatrix,
    getCourseTotalPossibleScore,
} from '../../../../lib/dbHelper.mjs';
import { IAM_ROLE } from '../../../../lib/iam.mjs';

const router = Router({ mergeParams: true });

router.get('/', async (req, res) => {
    const { email } = req.params;
    const { course_id: courseId } = req.query;
    try {
        let studentTotalScore = 0;
        let userGrades = {};
        const requesterRole = req?.auth?.role;
        const requesterIsPrivileged = [IAM_ROLE.SUPER_ADMIN, IAM_ROLE.COURSE_ADMIN, IAM_ROLE.INSTRUCTOR].includes(requesterRole);

        const maxScores = await getCourseAssignmentMatrix(courseId || null);
        const maxPoints = await getCourseTotalPossibleScore(courseId || null);

        if (requesterIsPrivileged) {
            userGrades = maxScores;
            studentTotalScore = maxPoints;
        } else {
            userGrades = await getStudentSubmissionsGrouped(email, courseId || null);
            studentTotalScore = Object.values(userGrades).reduce((categorySum, categoryScores) => {
                const assignmentSum = Object.values(categoryScores).reduce((sum, scoreObj) => {
                    return sum + (Number(scoreObj?.student) || 0);
                }, 0);
                return categorySum + assignmentSum;
            }, 0);
        }

        const maxPointsSoFar = getMaxPointsSoFar(userGrades, maxScores);
        const safeMaxPointsSoFar = maxPointsSoFar > 0 ? maxPointsSoFar : 1;

        return res.status(200).json({
            zeros: Math.round(studentTotalScore),
            pace: Math.round((studentTotalScore / safeMaxPointsSoFar) * maxPoints),
            perfect: Math.round(studentTotalScore + (maxPoints - maxPointsSoFar)),
            dataSource: 'database'
        }); 
    } catch (err) {
        console.error("Internal service error fetching student with id %s", email, err);
        return res.status(500).json({ message: "Internal server error." });
    }
});

export default router;
