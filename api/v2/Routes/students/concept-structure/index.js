import { Router } from 'express';
import {
    getPool,
    getCourseAssignmentMatrix,
    getStudentSubmissionsGrouped,
    getAllStudentScores,
    getStudentCourses,
} from '../../../../lib/dbHelper.mjs';
import { getGradeSyncConfig, getCourseGradeView } from '../../../../lib/unifiedConfig.mjs';

const router = Router({ mergeParams: true });

const DEFAULT_STUDENT_LEVELS = [
    { name: 'First Steps', color: '#dddddd' },
    { name: 'Needs Practice', color: '#ADD8E6' },
    { name: 'In Progress', color: '#89CFF0' },
    { name: 'Almost There', color: '#6495ED' },
    { name: 'Mastered', color: '#0F4D92' },
];

const DEFAULT_CLASS_LEVELS = [
    { name: 'Not Taught', color: '#dddddd' },
    { name: 'Taught', color: '#8fbc8f' },
];

function normalizeLevelConfig(levels, fallback) {
    if (!Array.isArray(levels) || levels.length === 0) {
        return fallback;
    }

    return levels.map((level, index) => {
        if (typeof level === 'string') {
            return {
                name: level,
                color: fallback[index]?.color || fallback[fallback.length - 1]?.color,
            };
        }

        return {
            name: level?.name || fallback[index]?.name || `Level ${index + 1}`,
            color: level?.color || fallback[index]?.color || fallback[fallback.length - 1]?.color,
        };
    });
}

function toLevel(score, maxScore, levelCount) {
    if (!maxScore || maxScore <= 0 || !score || score <= 0) {
        return 0;
    }

    if (score >= maxScore) {
        return levelCount - 1;
    }

    const raw = (score / maxScore) * (levelCount - 1);
    return Math.min(Math.ceil(raw), levelCount - 1);
}

function averageLevel(children) {
    if (!Array.isArray(children) || children.length === 0) {
        return 0;
    }

    const total = children.reduce((sum, child) => sum + (child?.data?.student_mastery || 0), 0);
    return Math.floor(total / children.length);
}

function parseConfigJson() {
    try {
        return getGradeSyncConfig();
    } catch (err) {
        console.warn('Unable to parse gradesync config for concept map:', err?.message || err);
        return null;
    }
}

function findCourseConfig(config, internalCourseId, gradescopeCourseId) {
    if (!config || !Array.isArray(config.courses)) {
        return null;
    }

    return config.courses.find((course) => {
        const sourceGsId = course?.gradesync?.sources?.gradescope?.course_id || course?.sources?.gradescope?.course_id;
        const internalId = course?.general?.id || course?.id;
        return (
            String(internalId || '') === String(internalCourseId || '')
            || String(sourceGsId || '') === String(gradescopeCourseId || '')
            || String(sourceGsId || '') === String(internalCourseId || '')
            || String(internalId || '') === String(gradescopeCourseId || '')
        );
    }) || null;
}

async function resolveCourseContext(email, requestedCourseId) {
    const pool = getPool();

    if (requestedCourseId) {
        const result = await pool.query(
            `
            SELECT id, gradescope_course_id, name
            FROM courses
            WHERE (id::text = $1 OR gradescope_course_id::text = $1)
            LIMIT 1
            `,
            [String(requestedCourseId)],
        );

        if (result.rows.length > 0) {
            return {
                internalCourseId: String(result.rows[0].id),
                gradescopeCourseId: String(result.rows[0].gradescope_course_id || ''),
                courseName: result.rows[0].name || 'Concept Map',
            };
        }
    }

    const studentCourses = await getStudentCourses(email);
    if (!studentCourses || studentCourses.length === 0) {
        return null;
    }

    const firstCourse = studentCourses[0];
    return {
        internalCourseId: String(firstCourse.id),
        gradescopeCourseId: String(firstCourse.gradescope_course_id || ''),
        courseName: firstCourse.name || 'Concept Map',
    };
}

async function getDbCategoryRules(internalCourseId) {
    const pool = getPool();

    try {
        const result = await pool.query(
            `
            SELECT name, patterns, display_order
            FROM assignment_categories
            WHERE course_id = $1
            ORDER BY display_order ASC, name ASC
            `,
            [internalCourseId],
        );

        return result.rows.map((row) => ({
            name: row.name,
            patterns: Array.isArray(row.patterns) ? row.patterns : [],
            display_order: Number(row.display_order) || 0,
        }));
    } catch (err) {
        return [];
    }
}

function matchCategoryByRules(assignmentTitle, rules) {
    const normalizedTitle = String(assignmentTitle || '').toLowerCase();

    for (const rule of rules) {
        const matched = (rule.patterns || []).some((pattern) =>
            normalizedTitle.includes(String(pattern || '').toLowerCase()),
        );

        if (matched) {
            return rule.name;
        }
    }

    return null;
}

router.get('/', async (req, res, next) => {
    const { email } = req.params;
    const { course_id: requestedCourseId } = req.query;

    try {
        const courseContext = await resolveCourseContext(email, requestedCourseId);
        if (!courseContext) {
            return res.status(200).json({
                name: 'Concept Map',
                nodes: { name: 'Concept Map', children: [] },
                'student levels': DEFAULT_STUDENT_LEVELS,
                'class levels': DEFAULT_CLASS_LEVELS,
                currentWeek: 1,
            });
        }

        const courseRef = courseContext.internalCourseId;

        const [assignmentMatrix, studentScoresGrouped, allStudentScores, dbCategoryRules] = await Promise.all([
            getCourseAssignmentMatrix(courseRef),
            getStudentSubmissionsGrouped(email, courseRef),
            getAllStudentScores(courseRef),
            getDbCategoryRules(courseRef),
        ]);

        const config = parseConfigJson();
        const matchedCourseConfig = findCourseConfig(
            config,
            courseContext.internalCourseId,
            courseContext.gradescopeCourseId,
        );
        const courseGradeView = getCourseGradeView(matchedCourseConfig);

        const fileCategoryRules = (courseGradeView?.assignment_categories || matchedCourseConfig?.assignment_categories || []).map((item, index) => ({
            name: item?.name,
            patterns: Array.isArray(item?.patterns) ? item.patterns : [],
            display_order: Number(item?.display_order) || index,
            week: Number(item?.week) || null,
        }));

        const activeCategoryRules = dbCategoryRules.length > 0 ? dbCategoryRules : fileCategoryRules;

        const studentLevels = normalizeLevelConfig(
            courseGradeView?.concept_map?.student_levels || matchedCourseConfig?.concept_map?.student_levels,
            DEFAULT_STUDENT_LEVELS,
        );
        const classLevels = normalizeLevelConfig(
            courseGradeView?.concept_map?.class_levels || matchedCourseConfig?.concept_map?.class_levels,
            DEFAULT_CLASS_LEVELS,
        );
        const levelCount = studentLevels.length;

        const allAssignments = [];
        Object.entries(assignmentMatrix || {}).forEach(([dbCategory, assignments]) => {
            Object.entries(assignments || {}).forEach(([title, maxPoints]) => {
                allAssignments.push({
                    dbCategory,
                    title,
                    maxPoints: Number(maxPoints) || 0,
                });
            });
        });

        if (allAssignments.length === 0) {
            return res.status(200).json({
                name: courseContext.courseName,
                nodes: {
                    name: courseContext.courseName,
                    data: { student_mastery: 0, class_mastery: 0, taught: false },
                    children: [],
                },
                'student levels': studentLevels,
                'class levels': classLevels,
                currentWeek: 1,
            });
        }

        const studentScoreByTitle = {};
        Object.values(studentScoresGrouped || {}).forEach((assignmentMap) => {
            Object.entries(assignmentMap || {}).forEach(([assignmentTitle, scoreObj]) => {
                studentScoreByTitle[assignmentTitle] = Number(scoreObj?.student) || 0;
            });
        });

        const classAggregateByTitle = {};
        (allStudentScores || []).forEach((student) => {
            Object.values(student?.scores || {}).forEach((assignmentMap) => {
                Object.entries(assignmentMap || {}).forEach(([assignmentTitle, score]) => {
                    if (!classAggregateByTitle[assignmentTitle]) {
                        classAggregateByTitle[assignmentTitle] = {
                            sum: 0,
                            count: 0,
                            taught: false,
                        };
                    }

                    const numericScore = Number(score) || 0;
                    classAggregateByTitle[assignmentTitle].sum += numericScore;
                    classAggregateByTitle[assignmentTitle].count += 1;
                    if (numericScore > 0) {
                        classAggregateByTitle[assignmentTitle].taught = true;
                    }
                });
            });
        });

        const buckets = new Map();

        allAssignments.forEach((assignment) => {
            const matchedCategory = activeCategoryRules.length > 0
                ? matchCategoryByRules(assignment.title, activeCategoryRules)
                : null;

            const categoryName = matchedCategory || assignment.dbCategory || 'Uncategorized';
            if (!buckets.has(categoryName)) {
                buckets.set(categoryName, []);
            }
            buckets.get(categoryName).push(assignment);
        });

        const categoryOrder = new Map();
        activeCategoryRules.forEach((rule, index) => {
            categoryOrder.set(rule.name, Number(rule.display_order ?? index));
        });

        const sortedCategoryNames = Array.from(buckets.keys()).sort((a, b) => {
            const orderA = categoryOrder.has(a) ? categoryOrder.get(a) : Number.MAX_SAFE_INTEGER;
            const orderB = categoryOrder.has(b) ? categoryOrder.get(b) : Number.MAX_SAFE_INTEGER;

            if (orderA !== orderB) {
                return orderA - orderB;
            }

            return a.localeCompare(b);
        });

        const categoryNodes = sortedCategoryNames.map((categoryName, categoryIndex) => {
            const assignments = buckets.get(categoryName) || [];
            const configuredCategory = activeCategoryRules.find((rule) => rule.name === categoryName);
            const categoryWeek = Number(configuredCategory?.week) || (categoryIndex + 1);

            const assignmentNodes = assignments
                .sort((a, b) => a.title.localeCompare(b.title))
                .map((assignment, assignmentIndex) => {
                    const studentScore = studentScoreByTitle[assignment.title] || 0;
                    const classAgg = classAggregateByTitle[assignment.title] || { sum: 0, count: 0, taught: false };
                    const classAverage = classAgg.count > 0 ? classAgg.sum / classAgg.count : 0;

                    const studentMastery = toLevel(studentScore, assignment.maxPoints, levelCount);
                    const classMastery = toLevel(classAverage, assignment.maxPoints, levelCount);

                    return {
                        id: `${categoryName}-${assignmentIndex + 1}`,
                        name: assignment.title,
                        parent: categoryName,
                        children: [],
                        data: {
                            week: categoryWeek,
                            taught: Boolean(classAgg.taught),
                            student_mastery: studentMastery,
                            class_mastery: classMastery,
                        },
                    };
                });

            return {
                id: `category-${categoryIndex + 1}`,
                name: categoryName,
                parent: courseContext.courseName,
                children: assignmentNodes,
                data: {
                    week: categoryWeek,
                    taught: assignmentNodes.some((node) => node.data.taught),
                    student_mastery: averageLevel(assignmentNodes),
                    class_mastery: 0,
                },
            };
        });

        const rootNode = {
            id: 'root',
            name: courseContext.courseName,
            parent: 'null',
            children: categoryNodes,
            data: {
                student_mastery: averageLevel(categoryNodes),
                class_mastery: 0,
                taught: categoryNodes.some((node) => node.data.taught),
            },
        };

        const currentWeek = Math.max(
            1,
            ...categoryNodes
                .filter((node) => node.data?.taught)
                .map((node) => Number(node.data?.week) || 1),
        );

        return res.status(200).json({
            name: courseContext.courseName,
            nodes: rootNode,
            'student levels': studentLevels,
            'class levels': classLevels,
            currentWeek,
        });
    } catch (err) {
        console.error('Error building concept-structure for', email, err);
        return next(err);
    }
});

export default router;
