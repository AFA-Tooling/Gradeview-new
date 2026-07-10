import { Router } from 'express';

import V2Router from './v2/index.js';

const router = Router();
router.use('/v2', V2Router);

// Error handling middleware
export function apiErrorHandler(err, _, res, next) {
    if (err?.isControlledApiError === true
        && Number.isInteger(err?.status)
        && typeof err?.code === 'string'
        && typeof err?.reason === 'string'
        && typeof err?.recovery === 'string') {
        return res.status(err.status).json({
            error: err.reason,
            code: err.code,
            reason: err.reason,
            recovery: err.recovery,
        });
    }

    if (res.headersSent) {
        return next(err);
    }

    return res.status(err?.status ?? 500).send(err?.message);
}

router.use(apiErrorHandler);

export default router;
