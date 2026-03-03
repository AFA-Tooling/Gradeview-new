import { Router } from 'express';
import { getPool } from '../../../lib/dbHelper.mjs';
import { validateAuthenticatedMiddleware } from '../../../lib/authlib.mjs';
import { canManageCourse, canManageSystem, IAM_ROLE, SUPER_ADMIN_EMAIL } from '../../../lib/iam.mjs';
import {
    loadUnifiedConfig,
    saveUnifiedConfig,
    findCourseConfigById,
    getCourseGeneral,
} from '../../../lib/unifiedConfig.mjs';

const router = Router();
const pool = getPool();
const HEAD_ADMIN_EMAIL = SUPER_ADMIN_EMAIL;

router.use(validateAuthenticatedMiddleware);

async function ensureSystemAdmin(req, res) {
    const allowed = await canManageSystem({
        requesterEmail: req?.auth?.email,
        snapshot: req?.auth?.snapshot || null,
    });
    if (!allowed) {
        res.status(403).json({ error: 'Super admin access required' });
        return false;
    }
    return true;
}

function ensureConfigAdmin(req, res) {
    const role = req?.auth?.role;
    const allowed = role === IAM_ROLE.SUPER_ADMIN || role === IAM_ROLE.COURSE_ADMIN;
    if (!allowed) {
        res.status(403).json({ error: 'Admin permission required' });
        return false;
    }
    return true;
}

async function ensureHeadAdmin(req, res) {
    const allowed = await canManageSystem({
        requesterEmail: req?.auth?.email,
        snapshot: req?.auth?.snapshot || null,
    });
    if (!allowed) {
        res.status(403).json({ error: 'Only the head admin can manage personnel permissions' });
        return false;
    }
    return true;
}

async function ensureCourseAdmin(req, res, courseId) {
    const allowed = await canManageCourse({
        requesterEmail: req?.auth?.email,
        courseId,
        snapshot: req?.auth?.snapshot || null,
    });
    if (!allowed) {
        res.status(403).json({ error: 'Course admin permission required' });
        return false;
    }
    return true;
}

function getCourseIdVariants(course) {
    const general = getCourseGeneral(course);
    const internalId = String(general?.id || course?.id || '').trim();
    const gradescopeId = String(
        course?.gradesync?.sources?.gradescope?.course_id
        || course?.sources?.gradescope?.course_id
        || '',
    ).trim();
    return [internalId, gradescopeId].filter(Boolean);
}

function findCourseIndex(courses, courseId) {
    const normalizedCourseId = String(courseId || '').trim();
    if (!normalizedCourseId) {
        return -1;
    }
    return courses.findIndex((course) => getCourseIdVariants(course).includes(normalizedCourseId));
}

function parseStoredConfigValue(value, valueType) {
    if (valueType === 'integer') {
        const parsed = Number.parseInt(value, 10);
        return Number.isNaN(parsed) ? 0 : parsed;
    }
    if (valueType === 'boolean') {
        return value === true || value === 'true' || value === '1';
    }
    if (valueType === 'json') {
        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }
    return value;
}

function toStoredConfigValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return { value: String(value), valueType: 'integer' };
    }
    if (typeof value === 'boolean') {
        return { value: value ? 'true' : 'false', valueType: 'boolean' };
    }
    if (value && typeof value === 'object') {
        return { value: JSON.stringify(value), valueType: 'json' };
    }
    return { value: String(value ?? ''), valueType: 'string' };
}

function resolveCourseSections(courseData) {
    const base = courseData && typeof courseData === 'object' ? courseData : {};
    const general = base.general && typeof base.general === 'object' ? base.general : base;
    const gradesync = base.gradesync && typeof base.gradesync === 'object' ? base.gradesync : base;
    const sourceContainer = gradesync.sources && typeof gradesync.sources === 'object'
        ? gradesync.sources
        : (base.sources && typeof base.sources === 'object' ? base.sources : {});

    const gradescope = sourceContainer.gradescope && typeof sourceContainer.gradescope === 'object'
        ? sourceContainer.gradescope
        : (base.gradescope && typeof base.gradescope === 'object' ? base.gradescope : {});

    const prairielearn = sourceContainer.prairielearn && typeof sourceContainer.prairielearn === 'object'
        ? sourceContainer.prairielearn
        : (base.prairielearn && typeof base.prairielearn === 'object' ? base.prairielearn : {});

    const iclicker = sourceContainer.iclicker && typeof sourceContainer.iclicker === 'object'
        ? sourceContainer.iclicker
        : (base.iclicker && typeof base.iclicker === 'object' ? base.iclicker : {});

    const database = gradesync.database && typeof gradesync.database === 'object'
        ? gradesync.database
        : (base.database && typeof base.database === 'object' ? base.database : {});

    const assignmentCategories = Array.isArray(gradesync.assignment_categories)
        ? gradesync.assignment_categories
        : (Array.isArray(base.assignment_categories) ? base.assignment_categories : []);

    return {
        base,
        general,
        gradescope,
        prairielearn,
        iclicker,
        database,
        assignmentCategories,
    };
}

async function loadGradeSyncConfigFromDatabase() {
    const systemResult = await pool.query('SELECT key, value, value_type FROM system_config');
    const coursesResult = await pool.query(
        `
        SELECT
            c.id AS internal_id,
            c.gradescope_course_id,
            c.name,
            c.department,
            c.course_number,
            c.semester,
            c.year,
            c.instructor,
            cc.gradescope_enabled,
            cc.gradescope_course_id AS cfg_gradescope_course_id,
            cc.gradescope_sync_interval_hours,
            cc.prairielearn_enabled,
            cc.prairielearn_course_id,
            cc.iclicker_enabled,
            cc.iclicker_course_names,
            cc.database_enabled,
            cc.use_as_primary,
            json_agg(
                json_build_object(
                    'name', ac.name,
                    'patterns', ac.patterns,
                    'display_order', ac.display_order
                )
                ORDER BY ac.display_order, ac.name
            ) FILTER (WHERE ac.id IS NOT NULL) AS assignment_categories
        FROM courses c
        LEFT JOIN course_configs cc ON cc.course_id = c.id
        LEFT JOIN assignment_categories ac ON ac.course_id = c.id
        WHERE c.is_active = true
        GROUP BY c.id, cc.id
        ORDER BY c.year DESC NULLS LAST, c.semester ASC NULLS LAST, c.department ASC NULLS LAST, c.course_number ASC NULLS LAST, c.name ASC NULLS LAST
        `,
    );

    const hasDbData = systemResult.rows.length > 0 || coursesResult.rows.length > 0;
    if (!hasDbData) {
        return null;
    }

    const globalSettings = {};
    for (const row of systemResult.rows) {
        globalSettings[row.key] = parseStoredConfigValue(row.value, row.value_type);
    }

    const courses = coursesResult.rows.map((row) => ({
        id: String(row.cfg_gradescope_course_id || row.gradescope_course_id || row.internal_id || ''),
        name: row.name || '',
        department: row.department || '',
        course_number: row.course_number || '',
        semester: row.semester || 'Fall',
        year: row.year || new Date().getFullYear(),
        instructor: row.instructor || '',
        sources: {
            gradescope: {
                enabled: row.gradescope_enabled ?? false,
                course_id: row.cfg_gradescope_course_id || row.gradescope_course_id || '',
                sync_interval_hours: row.gradescope_sync_interval_hours ?? 24,
            },
            prairielearn: {
                enabled: row.prairielearn_enabled ?? false,
                course_id: row.prairielearn_course_id || '',
            },
            iclicker: {
                enabled: row.iclicker_enabled ?? false,
                course_names: Array.isArray(row.iclicker_course_names) ? row.iclicker_course_names : [],
            },
        },
        database: {
            enabled: row.database_enabled ?? true,
            use_as_primary: row.use_as_primary ?? true,
        },
        assignment_categories: Array.isArray(row.assignment_categories)
            ? row.assignment_categories.map((item) => ({
                name: item?.name || '',
                patterns: Array.isArray(item?.patterns) ? item.patterns : [],
            }))
            : [],
    }));

    return {
        global_settings: globalSettings,
        courses,
    };
}

async function saveGradeSyncConfigToDatabase(syncConfig) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const globalSettings = syncConfig?.global_settings && typeof syncConfig.global_settings === 'object'
            ? syncConfig.global_settings
            : {};

        for (const [key, rawValue] of Object.entries(globalSettings)) {
            const { value, valueType } = toStoredConfigValue(rawValue);
            await client.query(
                `
                INSERT INTO system_config (key, value, value_type)
                VALUES ($1, $2, $3)
                ON CONFLICT (key)
                DO UPDATE SET value = EXCLUDED.value, value_type = EXCLUDED.value_type, updated_at = CURRENT_TIMESTAMP
                `,
                [key, value, valueType],
            );
        }

        const inputCourses = Array.isArray(syncConfig?.courses) ? syncConfig.courses : [];
        const activeCourseIds = [];

        for (const courseData of inputCourses) {
            const {
                general,
                gradescope,
                prairielearn,
                iclicker,
                database,
                assignmentCategories,
            } = resolveCourseSections(courseData);

            const gradescopeCourseId = String(
                gradescope?.course_id || general?.id || courseData?.id || '',
            ).trim();

            if (!gradescopeCourseId) {
                continue;
            }

            const courseResult = await client.query(
                `
                INSERT INTO courses (
                    gradescope_course_id,
                    name,
                    department,
                    course_number,
                    semester,
                    year,
                    instructor,
                    is_active
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, true)
                ON CONFLICT (gradescope_course_id)
                DO UPDATE SET
                    name = EXCLUDED.name,
                    department = EXCLUDED.department,
                    course_number = EXCLUDED.course_number,
                    semester = EXCLUDED.semester,
                    year = EXCLUDED.year,
                    instructor = EXCLUDED.instructor,
                    is_active = true,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING id
                `,
                [
                    gradescopeCourseId,
                    general?.name || null,
                    general?.department || null,
                    general?.course_number || null,
                    general?.semester || null,
                    general?.year || null,
                    general?.instructor || null,
                ],
            );

            const internalCourseId = courseResult.rows[0]?.id;
            if (!internalCourseId) {
                continue;
            }
            activeCourseIds.push(internalCourseId);

            await client.query(
                `
                INSERT INTO course_configs (
                    course_id,
                    gradescope_enabled,
                    gradescope_course_id,
                    gradescope_sync_interval_hours,
                    prairielearn_enabled,
                    prairielearn_course_id,
                    iclicker_enabled,
                    iclicker_course_names,
                    database_enabled,
                    use_as_primary
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (course_id)
                DO UPDATE SET
                    gradescope_enabled = EXCLUDED.gradescope_enabled,
                    gradescope_course_id = EXCLUDED.gradescope_course_id,
                    gradescope_sync_interval_hours = EXCLUDED.gradescope_sync_interval_hours,
                    prairielearn_enabled = EXCLUDED.prairielearn_enabled,
                    prairielearn_course_id = EXCLUDED.prairielearn_course_id,
                    iclicker_enabled = EXCLUDED.iclicker_enabled,
                    iclicker_course_names = EXCLUDED.iclicker_course_names,
                    database_enabled = EXCLUDED.database_enabled,
                    use_as_primary = EXCLUDED.use_as_primary,
                    updated_at = CURRENT_TIMESTAMP
                `,
                [
                    internalCourseId,
                    gradescope?.enabled ?? false,
                    gradescope?.course_id || gradescopeCourseId,
                    gradescope?.sync_interval_hours ?? 24,
                    prairielearn?.enabled ?? false,
                    prairielearn?.course_id || null,
                    iclicker?.enabled ?? false,
                    Array.isArray(iclicker?.course_names) ? iclicker.course_names : [],
                    database?.enabled ?? true,
                    database?.use_as_primary ?? true,
                ],
            );

            await client.query('DELETE FROM assignment_categories WHERE course_id = $1', [internalCourseId]);
            for (let index = 0; index < assignmentCategories.length; index += 1) {
                const category = assignmentCategories[index] || {};
                const name = String(category.name || '').trim();
                if (!name) {
                    continue;
                }
                await client.query(
                    `
                    INSERT INTO assignment_categories (course_id, name, patterns, display_order)
                    VALUES ($1, $2, $3, $4)
                    `,
                    [
                        internalCourseId,
                        name,
                        Array.isArray(category.patterns) ? category.patterns : [],
                        index,
                    ],
                );
            }
        }

        if (activeCourseIds.length > 0) {
            await client.query(
                `
                UPDATE courses
                SET is_active = false, updated_at = CURRENT_TIMESTAMP
                WHERE is_active = true
                  AND id <> ALL($1::int[])
                `,
                [activeCourseIds],
            );
        } else {
            await client.query('UPDATE courses SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE is_active = true');
        }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

const PERMISSION_LEVELS = new Set(['owner', 'editor', 'viewer']);
const USER_ROLES = new Set(['superadmin', 'admin', 'instructor', 'ta', 'readonly']);

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function deriveIamRole(email, userRole, permissionLevel) {
    if (normalizeEmail(email) === HEAD_ADMIN_EMAIL) {
        return 'head_admin';
    }
    if (permissionLevel === 'owner' || userRole === 'admin' || userRole === 'superadmin') {
        return 'course_admin';
    }
    if (['editor', 'viewer'].includes(permissionLevel) || ['instructor', 'ta'].includes(userRole)) {
        return 'instructor';
    }
    return 'none';
}

function mapRoleInput({ iamRole, permissionLevel, userRole }) {
    if (iamRole) {
        const normalizedIamRole = String(iamRole).trim().toLowerCase();
        if (normalizedIamRole === 'instructor') {
            return { permissionLevel: 'editor', userRole: 'instructor' };
        }
        if (normalizedIamRole === 'ta') {
            return { permissionLevel: 'viewer', userRole: 'ta' };
        }
        if (normalizedIamRole === 'viewer') {
            return { permissionLevel: 'viewer', userRole: 'readonly' };
        }
        throw new Error('Invalid iam_role. Use instructor, ta, or viewer.');
    }

    const normalizedPermission = String(permissionLevel || '').trim().toLowerCase();
    const normalizedUserRole = String(userRole || '').trim().toLowerCase();

    if (!PERMISSION_LEVELS.has(normalizedPermission)) {
        throw new Error('Invalid permission_level. Use owner, editor, or viewer.');
    }
    if (!USER_ROLES.has(normalizedUserRole)) {
        throw new Error('Invalid user_role. Use superadmin, admin, instructor, ta, or readonly.');
    }

    if (normalizedPermission === 'owner' || ['admin', 'superadmin'].includes(normalizedUserRole)) {
        throw new Error('Course admin assignment is disabled. Only head admin has personnel-management power.');
    }

    return {
        permissionLevel: normalizedPermission,
        userRole: normalizedUserRole,
    };
}

async function resolveInternalCourseNumericId(courseId) {
    const result = await pool.query(
        `
        SELECT id
        FROM courses
        WHERE id::text = $1 OR gradescope_course_id::text = $1
        LIMIT 1
        `,
        [String(courseId || '').trim()],
    );

    return result.rows[0]?.id || null;
}

async function findUserIdByEmail(email) {
    const result = await pool.query(
        `
        SELECT id
        FROM users
        WHERE LOWER(email) = LOWER($1)
          AND is_active = true
        LIMIT 1
        `,
        [email],
    );
    return result.rows[0]?.id || null;
}

// GET /v2/config - Get GradeView configuration
router.get('/', async (req, res, next) => {
    try {
        const allowed = ensureConfigAdmin(req, res);
        if (!allowed) {
            return;
        }

        const config = loadUnifiedConfig();
        res.status(200).json(config.gradeview || {});
    } catch (error) {
        console.error('Error getting GradeView config:', error);
        next(error);
    }
});

// PUT /v2/config - Update GradeView configuration
router.put('/', async (req, res, next) => {
    try {
        const allowed = ensureConfigAdmin(req, res);
        if (!allowed) {
            return;
        }

        const config = loadUnifiedConfig();
        config.gradeview = req.body || {};
        saveUnifiedConfig(config);
        const result = { success: true, message: 'GradeView configuration saved' };
        res.status(200).json(result);
    } catch (error) {
        console.error('Error updating GradeView config:', error);
        next(error);
    }
});

// GET /v2/config/sync - Get GradeSync configuration
router.get('/sync', async (req, res, next) => {
    try {
        const allowed = ensureConfigAdmin(req, res);
        if (!allowed) {
            return;
        }

        try {
            const dbConfig = await loadGradeSyncConfigFromDatabase();
            if (dbConfig) {
                return res.status(200).json(dbConfig);
            }
        } catch (dbError) {
            console.warn('DB-backed GradeSync config read failed, falling back to config.json:', dbError?.message || dbError);
        }

        const config = loadUnifiedConfig();
        return res.status(200).json(config.gradesync || {});
    } catch (error) {
        console.error('Error getting GradeSync config:', error);
        next(error);
    }
});

// PUT /v2/config/sync - Update GradeSync configuration
router.put('/sync', async (req, res, next) => {
    try {
        const allowed = ensureConfigAdmin(req, res);
        if (!allowed) {
            return;
        }

        const syncConfig = req.body || {};

        await saveGradeSyncConfigToDatabase(syncConfig);

        const config = loadUnifiedConfig();
        config.gradesync = syncConfig;
        saveUnifiedConfig(config);
        res.status(200).json({ success: true, message: 'GradeSync configuration saved' });
    } catch (error) {
        console.error('Error updating GradeSync config:', error);
        next(error);
    }
});

// GET /v2/config/courses - Get all courses user has access to
router.get('/courses', async (req, res, next) => {
    try {
        const config = loadUnifiedConfig();
        const courses = Array.isArray(config?.gradesync?.courses) ? config.gradesync.courses : [];

        const isSuper = await canManageSystem({
            requesterEmail: req?.auth?.email,
            snapshot: req?.auth?.snapshot || null,
        });

        if (isSuper) {
            return res.status(200).json({ courses });
        }

        const allowedCourses = [];
        for (const course of courses) {
            const ids = getCourseIdVariants(course);
            const allowed = await Promise.any(ids.map((courseId) => canManageCourse({
                requesterEmail: req?.auth?.email,
                courseId,
                snapshot: req?.auth?.snapshot || null,
            })).map((promise) => promise.then((result) => {
                if (result) {
                    return true;
                }
                throw new Error('not-allowed');
            }))).catch(() => false);

            if (allowed) {
                allowedCourses.push(course);
            }
        }

        res.status(200).json({ courses: allowedCourses });
    } catch (error) {
        console.error('Error getting user courses:', error);
        next(error);
    }
});

// GET /v2/config/courses/:courseId - Get specific course configuration
router.get('/courses/:courseId', async (req, res, next) => {
    try {
        const { courseId } = req.params;
        const allowed = await ensureCourseAdmin(req, res, courseId);
        if (!allowed) {
            return;
        }

        const config = findCourseConfigById(courseId);
        if (!config) {
            return res.status(404).json({ error: 'Course not found' });
        }
        res.status(200).json(config);
    } catch (error) {
        console.error('Error getting course config:', error);
        next(error);
    }
});

// PUT /v2/config/courses/:courseId - Update course configuration
router.put('/courses/:courseId', async (req, res, next) => {
    try {
        const { courseId } = req.params;
        const allowed = await ensureCourseAdmin(req, res, courseId);
        if (!allowed) {
            return;
        }

        const rootConfig = loadUnifiedConfig();
        const courses = Array.isArray(rootConfig?.gradesync?.courses) ? rootConfig.gradesync.courses : [];
        const courseIndex = findCourseIndex(courses, courseId);

        if (courseIndex < 0) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const current = courses[courseIndex] || {};
        const nextBody = req.body && typeof req.body === 'object' ? req.body : {};

        const merged = {
            ...current,
            ...nextBody,
            general: nextBody.general && typeof nextBody.general === 'object'
                ? { ...(current.general || {}), ...nextBody.general }
                : current.general,
            gradesync: nextBody.gradesync && typeof nextBody.gradesync === 'object'
                ? { ...(current.gradesync || {}), ...nextBody.gradesync }
                : current.gradesync,
            gradeview: nextBody.gradeview && typeof nextBody.gradeview === 'object'
                ? { ...(current.gradeview || {}), ...nextBody.gradeview }
                : current.gradeview,
        };

        courses[courseIndex] = merged;
        rootConfig.gradesync = rootConfig.gradesync || {};
        rootConfig.gradesync.courses = courses;
        saveUnifiedConfig(rootConfig);

        res.status(200).json({ success: true, message: 'Course configuration updated' });
    } catch (error) {
        console.error('Error updating course config:', error);
        next(error);
    }
});

// GET /v2/config/system - Get system global settings
router.get('/system', async (req, res, next) => {
    try {
        const allowed = ensureConfigAdmin(req, res);
        if (!allowed) {
            return;
        }

        const config = loadUnifiedConfig();
        res.status(200).json(config?.gradesync?.global_settings || {});
    } catch (error) {
        console.error('Error getting system config:', error);
        next(error);
    }
});

// GET /v2/config/courses/:courseId/permissions - List course staff permissions
router.get('/courses/:courseId/permissions', async (req, res, next) => {
    try {
        const { courseId } = req.params;
        const allowed = await ensureHeadAdmin(req, res);
        if (!allowed) {
            return;
        }

        const internalCourseId = await resolveInternalCourseNumericId(courseId);
        if (!internalCourseId) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const result = await pool.query(
            `
            SELECT
                u.email,
                u.role AS user_role,
                cp.permission_level,
                cp.granted_at,
                grantor.email AS granted_by_email
            FROM course_permissions cp
            JOIN users u ON u.id = cp.user_id
            LEFT JOIN users grantor ON grantor.id = cp.granted_by
            WHERE cp.course_id = $1
              AND u.is_active = true
            ORDER BY u.email ASC
            `,
            [internalCourseId],
        );

        const permissions = result.rows.map((row) => ({
            email: row.email,
            user_role: row.user_role,
            permission_level: row.permission_level,
            iam_role: deriveIamRole(row.email, String(row.user_role || '').toLowerCase(), String(row.permission_level || '').toLowerCase()),
            granted_at: row.granted_at,
            granted_by: row.granted_by_email || null,
        }));

        if (!permissions.some((item) => normalizeEmail(item.email) === HEAD_ADMIN_EMAIL)) {
            permissions.unshift({
                email: HEAD_ADMIN_EMAIL,
                user_role: 'head_admin',
                permission_level: 'owner',
                iam_role: 'head_admin',
                granted_at: null,
                granted_by: null,
            });
        }

        return res.status(200).json({ course_id: String(courseId), permissions });
    } catch (error) {
        console.error('Error listing course permissions:', error);
        return next(error);
    }
});

// PUT /v2/config/courses/:courseId/permissions - Upsert course staff permission
router.put('/courses/:courseId/permissions', async (req, res, next) => {
    try {
        const { courseId } = req.params;
        const allowed = await ensureHeadAdmin(req, res);
        if (!allowed) {
            return;
        }

        const targetEmail = normalizeEmail(req?.body?.email);
        if (!targetEmail) {
            return res.status(400).json({ error: 'email is required' });
        }
        if (targetEmail === HEAD_ADMIN_EMAIL) {
            return res.status(400).json({ error: 'head admin is code-controlled and cannot be modified here' });
        }

        let mapped;
        try {
            mapped = mapRoleInput({
                iamRole: req?.body?.iam_role,
                permissionLevel: req?.body?.permission_level,
                userRole: req?.body?.user_role,
            });
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }

        const internalCourseId = await resolveInternalCourseNumericId(courseId);
        if (!internalCourseId) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const requesterUserId = await findUserIdByEmail(req?.auth?.email);

        const upsertUserResult = await pool.query(
            `
            INSERT INTO users (email, role, is_active)
            VALUES ($1, $2, true)
            ON CONFLICT (email)
            DO UPDATE SET role = EXCLUDED.role, is_active = true, updated_at = CURRENT_TIMESTAMP
            RETURNING id, email, role
            `,
            [targetEmail, mapped.userRole],
        );

        const userId = upsertUserResult.rows[0]?.id;

        await pool.query(
            `
            INSERT INTO course_permissions (course_id, user_id, permission_level, granted_by)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (course_id, user_id)
            DO UPDATE SET
                permission_level = EXCLUDED.permission_level,
                granted_by = EXCLUDED.granted_by,
                granted_at = CURRENT_TIMESTAMP
            `,
            [internalCourseId, userId, mapped.permissionLevel, requesterUserId],
        );

        return res.status(200).json({
            success: true,
            permission: {
                email: targetEmail,
                user_role: mapped.userRole,
                permission_level: mapped.permissionLevel,
                iam_role: deriveIamRole(targetEmail, mapped.userRole, mapped.permissionLevel),
            },
        });
    } catch (error) {
        console.error('Error upserting course permission:', error);
        return next(error);
    }
});

// DELETE /v2/config/courses/:courseId/permissions/:email - Remove course staff permission
router.delete('/courses/:courseId/permissions/:email', async (req, res, next) => {
    try {
        const { courseId, email } = req.params;
        const allowed = await ensureHeadAdmin(req, res);
        if (!allowed) {
            return;
        }

        const targetEmail = normalizeEmail(email);
        if (!targetEmail) {
            return res.status(400).json({ error: 'Valid email is required' });
        }
        if (targetEmail === HEAD_ADMIN_EMAIL) {
            return res.status(400).json({ error: 'head admin cannot be removed' });
        }

        const internalCourseId = await resolveInternalCourseNumericId(courseId);
        if (!internalCourseId) {
            return res.status(404).json({ error: 'Course not found' });
        }

        const result = await pool.query(
            `
            DELETE FROM course_permissions cp
            USING users u
            WHERE cp.user_id = u.id
              AND cp.course_id = $1
              AND LOWER(u.email) = LOWER($2)
            `,
            [internalCourseId, targetEmail],
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Permission not found' });
        }

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error deleting course permission:', error);
        return next(error);
    }
});

// POST /v2/config/permissions/normalize-legacy - force non-head-admin staff to instructor/editor
router.post('/permissions/normalize-legacy', async (req, res, next) => {
    try {
        const allowed = await ensureHeadAdmin(req, res);
        if (!allowed) {
            return;
        }

        const requestedCourseId = String(req?.body?.course_id || '').trim();
        let courseIds = [];

        if (requestedCourseId) {
            const internalId = await resolveInternalCourseNumericId(requestedCourseId);
            if (!internalId) {
                return res.status(404).json({ error: 'Course not found' });
            }
            courseIds = [internalId];
        } else {
            const courses = await pool.query('SELECT id FROM courses WHERE is_active = true');
            courseIds = courses.rows.map((row) => row.id).filter(Boolean);
        }

        if (courseIds.length === 0) {
            return res.status(200).json({ success: true, updated_users: 0, updated_permissions: 0 });
        }

        const usersResult = await pool.query(
            `
            UPDATE users u
            SET role = 'instructor', updated_at = CURRENT_TIMESTAMP
            WHERE LOWER(u.email) <> LOWER($1)
              AND u.id IN (
                  SELECT DISTINCT cp.user_id
                  FROM course_permissions cp
                  WHERE cp.course_id = ANY($2::int[])
              )
            `,
            [HEAD_ADMIN_EMAIL, courseIds],
        );

        const permissionsResult = await pool.query(
            `
            UPDATE course_permissions cp
            SET permission_level = 'editor', granted_at = CURRENT_TIMESTAMP
            FROM users u
            WHERE cp.user_id = u.id
              AND cp.course_id = ANY($1::int[])
              AND LOWER(u.email) <> LOWER($2)
            `,
            [courseIds, HEAD_ADMIN_EMAIL],
        );

        return res.status(200).json({
            success: true,
            updated_users: usersResult.rowCount,
            updated_permissions: permissionsResult.rowCount,
            scope_course_ids: courseIds,
        });
    } catch (error) {
        console.error('Error normalizing legacy personnel permissions:', error);
        return next(error);
    }
});

export default router;
