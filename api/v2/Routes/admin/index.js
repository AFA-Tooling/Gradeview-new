import { Router } from 'express';
import { validateAdminPortalMiddleware } from '../../../lib/authlib.mjs';
import { IAM_ROLE } from '../../../lib/iam.mjs';
import CategoriesRouter from './categories/index.js';
import AssignmentsRouter from './assignments/index.js';
import StatsRouter from './stats/index.js';
import DistributionRouter from './distribution/index.js';
import StudentScoresRouter from './studentScores/index.js';
import AIQueryRouter from './ai-query/index.js';
import SyncRouter from './sync/index.js';
import RateLimit from 'express-rate-limit';

const router = Router({ mergeParams: true });

// set up rate limiter: maximum of 10000 requests per 15 minutes
const limiter = RateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10000, // max 10000 requests per windowMs
});

// apply rate limiter to all requests
router.use(limiter);

router.use(validateAdminPortalMiddleware);

function requireCourseScopeForClassData(req, res, next) {
    const classDataPrefixes = [
        '/categories',
        '/assignments',
        '/stats',
        '/distribution',
        '/studentScores',
        '/ai-query',
    ];
    const isClassDataRequest = classDataPrefixes.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`));

    if (req?.auth?.role !== IAM_ROLE.SUPER_ADMIN && isClassDataRequest && !req?.query?.course_id) {
        return res.status(403).json({ error: 'course_id is required for course-scoped class-data access' });
    }

    return next();
}

router.use(requireCourseScopeForClassData);

// Mount sub-routers
router.use('/categories', CategoriesRouter);
router.use('/assignments', AssignmentsRouter);
router.use('/stats', StatsRouter);
router.use('/distribution', DistributionRouter);
router.use('/studentScores', StudentScoresRouter);
router.use('/ai-query', AIQueryRouter); // AI Agent query endpoint
router.use('/sync', SyncRouter); // GradeSync integration

// Default admin route
router.get('/', (_, res) => {
    res.status(200);
    res.json({ message: 'Admin API endpoints available' });
});

export default router;
