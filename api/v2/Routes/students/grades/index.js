import { Router } from 'express';
import {
    getStudentAssignmentEvidence,
    getStudentCourses,
    studentEnrolledInCourse,
} from '../../../../lib/dbHelper.mjs';
import { IAM_ROLE } from '../../../../lib/iam.mjs';
import {
    assignmentEvidenceRequestError,
} from '../../../../lib/assignmentEvidence.mjs';
import { buildStudentGradesRouteResponse } from './gradesResponse.mjs';

const router = Router({ mergeParams: true });

router.get('/', async (req, res) => {
    const { email } = req.params;
    const { sort, course_id: courseId } = req.query;
    
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
        const evidence = await getStudentAssignmentEvidence(email, effectiveCourseId);

        return res.status(200).json(buildStudentGradesRouteResponse(evidence, sort));
    } catch (err) {
        console.error("Internal service error for student with email %s", email, err);
        return res.status(Number(err?.status) || 500).json(assignmentEvidenceRequestError(err));
    }
});

export default router;
