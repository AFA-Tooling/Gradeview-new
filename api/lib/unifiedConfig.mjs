import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_CONFIG_PATH = path.resolve(__dirname, '../../config.json');
const SUPER_ADMIN_EMAIL = 'weszhang@berkeley.edu';

const emptyConfig = {
    gradeview: {
        googleconfig: { oauth: {} },
        admins: [],
    },
    gradesync: {
        courses: [],
        global_settings: {},
    },
};

function getAllCourseAdminEmails(courses) {
    if (!Array.isArray(courses)) {
        return [];
    }

    const emails = [];
    for (const course of courses) {
        const general = course?.general && typeof course.general === 'object' ? course.general : course;
        if (Array.isArray(general?.admins)) {
            emails.push(...general.admins);
        }
        if (Array.isArray(course?.admins)) {
            emails.push(...course.admins);
        }
    }

    return Array.from(new Set(emails.map((email) => String(email || '').trim()).filter(Boolean)));
}

export function getRootConfigPath() {
    return ROOT_CONFIG_PATH;
}

export function loadUnifiedConfig() {
    try {
        const raw = fs.readFileSync(ROOT_CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(raw);

        const gradeview = parsed?.gradeview && typeof parsed.gradeview === 'object'
            ? parsed.gradeview
            : {
                googleconfig: parsed?.googleconfig || { oauth: {} },
                admins: Array.isArray(parsed?.admins) ? parsed.admins : getAllCourseAdminEmails(parsed?.courses),
            };

        const gradesync = parsed?.gradesync && typeof parsed.gradesync === 'object'
            ? parsed.gradesync
            : {
                courses: Array.isArray(parsed?.courses) ? parsed.courses : [],
                global_settings: parsed?.global_settings || {},
            };

        return {
            gradeview: {
                googleconfig: gradeview.googleconfig || { oauth: {} },
                admins: Array.isArray(gradeview.admins) ? gradeview.admins : [],
            },
            gradesync: {
                courses: Array.isArray(gradesync.courses) ? gradesync.courses : [],
                global_settings: gradesync.global_settings || {},
            },
        };
    } catch (error) {
        console.warn('Unable to load root config.json, falling back to empty config:', error?.message || error);
        return emptyConfig;
    }
}

export function saveUnifiedConfig(configData) {
    fs.writeFileSync(ROOT_CONFIG_PATH, `${JSON.stringify(configData, null, 2)}\n`, 'utf8');
}

export function getGradeviewConfig() {
    return loadUnifiedConfig().gradeview;
}

export function getGradeSyncConfig() {
    return loadUnifiedConfig().gradesync;
}

export function findCourseConfigById(courseId) {
    if (!courseId) {
        return null;
    }

    const normalizedCourseId = String(courseId).trim();
    if (!normalizedCourseId) {
        return null;
    }

    const gradesync = getGradeSyncConfig();
    const courses = Array.isArray(gradesync?.courses) ? gradesync.courses : [];

    return courses.find((course) => {
        const internalCourseId = String(course?.general?.id || course?.id || '');
        const gradescopeCourseId = String(
            course?.gradesync?.sources?.gradescope?.course_id
            || course?.sources?.gradescope?.course_id
            || '',
        );
        return internalCourseId === normalizedCourseId || gradescopeCourseId === normalizedCourseId;
    }) || null;
}

export function getCourseGeneral(course) {
    if (!course || typeof course !== 'object') {
        return {};
    }
    if (course.general && typeof course.general === 'object') {
        return course.general;
    }
    return course;
}

export function getCourseGradeSync(course) {
    if (!course || typeof course !== 'object') {
        return {};
    }
    if (course.gradesync && typeof course.gradesync === 'object') {
        return course.gradesync;
    }
    return course;
}

export function getCourseGradeView(course) {
    if (!course || typeof course !== 'object') {
        return {};
    }
    if (course.gradeview && typeof course.gradeview === 'object') {
        return course.gradeview;
    }
    return course;
}

function toNormalizedEmailList(values) {
    if (!Array.isArray(values)) {
        return [];
    }

    return values
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean);
}

function getCourseStaffEmailList(course) {
    const general = getCourseGeneral(course);

    const instructors = toNormalizedEmailList(general?.instructors);
    const tas = toNormalizedEmailList(general?.tas);
    const courseAdmins = toNormalizedEmailList(general?.admins || course?.admins);

    return Array.from(new Set([...instructors, ...tas, ...courseAdmins]));
}

export function getGoogleOauthClientId() {
    const gradeview = getGradeviewConfig();
    return gradeview?.googleconfig?.oauth?.clientid || process.env.GOOGLE_OAUTH_CLIENT_ID || '';
}

export function isGlobalAdmin(email) {
    if (!email) {
        return false;
    }

    const normalizedEmail = String(email).toLowerCase();
    return normalizedEmail === SUPER_ADMIN_EMAIL;
}

export function isCourseAdmin(email, courseId) {
    if (!email || !courseId) {
        return false;
    }

    if (isGlobalAdmin(email)) {
        return true;
    }

    const normalizedEmail = String(email).toLowerCase();
    const course = findCourseConfigById(courseId);
    const courseGeneral = getCourseGeneral(course);
    const courseAdmins = Array.isArray(courseGeneral?.admins)
        ? courseGeneral.admins
        : (Array.isArray(course?.admins) ? course.admins : []);

    if (courseAdmins.length === 0) {
        return false;
    }

    return courseAdmins.some((adminEmail) => String(adminEmail).toLowerCase() === normalizedEmail);
}

export function isCourseStaff(email, courseId = null) {
    if (!email) {
        return false;
    }

    if (isGlobalAdmin(email)) {
        return true;
    }

    const normalizedEmail = String(email).toLowerCase();
    const courses = Array.isArray(getGradeSyncConfig()?.courses) ? getGradeSyncConfig().courses : [];

    const matchedCourses = courseId
        ? courses.filter((course) => {
            const general = getCourseGeneral(course);
            const courseInternalId = String(general?.id || course?.id || '');
            const gradescopeCourseId = String(
                course?.gradesync?.sources?.gradescope?.course_id
                || course?.sources?.gradescope?.course_id
                || '',
            );
            const target = String(courseId);
            return courseInternalId === target || gradescopeCourseId === target;
        })
        : courses;

    return matchedCourses.some((course) => getCourseStaffEmailList(course).includes(normalizedEmail));
}

export function getAccessibleCoursesForEmail(email) {
    if (!email) {
        return [];
    }

    const normalizedEmail = String(email).toLowerCase();
    const isGlobal = isGlobalAdmin(normalizedEmail);
    const courses = Array.isArray(getGradeSyncConfig()?.courses) ? getGradeSyncConfig().courses : [];

    return courses
        .filter((course) => {
            if (isGlobal) {
                return true;
            }
            return getCourseStaffEmailList(course).includes(normalizedEmail);
        })
        .map((course) => {
            const general = getCourseGeneral(course);
            const gradescopeCourseId = String(
                course?.gradesync?.sources?.gradescope?.course_id
                || course?.sources?.gradescope?.course_id
                || '',
            );

            return {
                id: general?.id || course?.id || null,
                name: general?.name || null,
                gradescope_course_id: gradescopeCourseId || null,
                department: general?.department || null,
                course_number: general?.course_number || null,
                semester: general?.semester || null,
                year: general?.year || null,
                role: isGlobal ? 'admin' : 'staff',
            };
        });
}

export function isAdmin(email, courseId = null) {
    if (courseId) {
        return isCourseAdmin(email, courseId);
    }
    return isGlobalAdmin(email);
}