import {
    ACCESS_ACTION,
    ACCESS_ERROR_CODE,
    getCourseAccessDecision,
    IAM_ROLE,
} from '../lib/iam.mjs';

jest.mock('../lib/dbHelper.mjs', () => ({
    getPool: jest.fn(),
    studentEnrolledInCourse: jest.fn().mockResolvedValue(true),
}));

const OWN_COURSE = 'course-own';
const OTHER_COURSE = 'course-other';

function roleSnapshot(role, overrides = {}) {
    return {
        email: `${role}@example.edu`,
        is_super: role === IAM_ROLE.SUPER_ADMIN,
        course_roles: role === IAM_ROLE.SUPER_ADMIN ? {} : { [OWN_COURSE]: role },
        has_course_admin: role === IAM_ROLE.COURSE_ADMIN,
        has_instructor: role === IAM_ROLE.INSTRUCTOR,
        has_student: role === IAM_ROLE.STUDENT,
        ...overrides,
    };
}

const actors = {
    student: roleSnapshot(IAM_ROLE.STUDENT),
    staff: roleSnapshot(IAM_ROLE.INSTRUCTOR),
    course_admin: roleSnapshot(IAM_ROLE.COURSE_ADMIN),
    super_admin: roleSnapshot(IAM_ROLE.SUPER_ADMIN),
    demo: roleSnapshot(IAM_ROLE.COURSE_ADMIN, {
        email: 'public-demo@gradeview.local',
        is_demo: true,
        read_only: true,
        demo_course_id: OWN_COURSE,
        capabilities: {
            is_demo: true,
            read_only: true,
            demo_course_id: OWN_COURSE,
        },
    }),
};

const expectedOwn = {
    student: {
        read: [false, ACCESS_ERROR_CODE.COURSE_SCOPE_FORBIDDEN],
        write: [false, ACCESS_ERROR_CODE.COURSE_SCOPE_FORBIDDEN],
    },
    staff: {
        read: [true, null],
        write: [false, ACCESS_ERROR_CODE.COURSE_SCOPE_FORBIDDEN],
    },
    course_admin: {
        read: [true, null],
        write: [true, null],
    },
    super_admin: {
        read: [true, null],
        write: [true, null],
    },
    demo: {
        read: [true, null],
        write: [false, ACCESS_ERROR_CODE.DEMO_READ_ONLY],
    },
};

describe('course authorization matrix', () => {
    test.each(Object.entries(actors).flatMap(([actor, snapshot]) => (
        [ACCESS_ACTION.READ, ACCESS_ACTION.WRITE].map((action) => [actor, action, snapshot])
    )))('%s receives a stable own-course %s decision', async (actor, action, snapshot) => {
        const decision = await getCourseAccessDecision({
            requesterEmail: snapshot.email,
            courseId: OWN_COURSE,
            action,
            snapshot,
        });

        const [allowed, code] = expectedOwn[actor][action];
        expect(decision).toMatchObject({ allowed, code });
    });

    test.each(Object.entries(actors).flatMap(([actor, snapshot]) => (
        [ACCESS_ACTION.READ, ACCESS_ACTION.WRITE].map((action) => [actor, action, snapshot])
    )))('%s receives COURSE_SCOPE_REQUIRED for missing-course %s', async (_, action, snapshot) => {
        const decision = await getCourseAccessDecision({
            requesterEmail: snapshot.email,
            courseId: '',
            action,
            snapshot,
        });

        expect(decision).toMatchObject({
            allowed: false,
            code: ACCESS_ERROR_CODE.COURSE_SCOPE_REQUIRED,
        });
    });

    test.each(Object.entries(actors).flatMap(([actor, snapshot]) => (
        [ACCESS_ACTION.READ, ACCESS_ACTION.WRITE].map((action) => [actor, action, snapshot])
    )))('%s cannot silently cross course scope for %s', async (actor, action, snapshot) => {
        const decision = await getCourseAccessDecision({
            requesterEmail: snapshot.email,
            courseId: OTHER_COURSE,
            action,
            snapshot,
        });

        if (actor === 'super_admin') {
            expect(decision).toMatchObject({ allowed: true, code: null });
        } else {
            expect(decision).toMatchObject({
                allowed: false,
                code: ACCESS_ERROR_CODE.COURSE_SCOPE_FORBIDDEN,
            });
        }
    });
});
