import { Router } from 'express';
import {
    getRequestedCourseId,
    requireWritableSessionMiddleware,
    validateAuthenticatedMiddleware,
    validateAdminPortalMiddleware,
} from '../../../lib/authlib.mjs';
import { ACCESS_ERROR_CODE, ensurePermission } from '../../../lib/iam.mjs';
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

    if (isClassDataRequest && !getRequestedCourseId(req)) {
        ensurePermission(false, null, ACCESS_ERROR_CODE.COURSE_SCOPE_REQUIRED);
    }

    return next();
}

router.use(validateAuthenticatedMiddleware);
router.use(requireCourseScopeForClassData);
router.use(validateAdminPortalMiddleware);

// Mount sub-routers
router.use('/categories', CategoriesRouter);
router.use('/assignments', AssignmentsRouter);
router.use('/stats', StatsRouter);
router.use('/distribution', DistributionRouter);
router.use('/studentScores', StudentScoresRouter);
router.use('/ai-query', AIQueryRouter); // AI Agent query endpoint
router.use('/sync', requireWritableSessionMiddleware, SyncRouter); // GradeSync integration

// Default admin route
router.get('/', (_, res) => {
    res.status(200);
    res.json({ message: 'Admin API endpoints available' });
});

export default router;
