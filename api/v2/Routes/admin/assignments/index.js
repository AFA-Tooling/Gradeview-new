import { Router } from 'express';
import { getPool } from '../../../../lib/dbHelper.mjs';
import {
    assignmentEvidenceRequestError,
    queryCourseAssignmentCatalog,
} from '../../../../lib/assignmentEvidence.mjs';
import { buildAdminAssignmentsRouteResponse } from './assignmentsResponse.mjs';

const router = Router({ mergeParams: true });

/**
 * GET /admin/assignments
 * Returns all assignments grouped by category from PostgreSQL database
 * Database-backed assignments endpoint
 * Format: {
 *   "Projects": { "Project 1": 100, "Project 2": 100, ... },
 *   "Labs": { "Lab 1": 10, "Lab 2": 10, ... },
 *   ...
 * }
 */
router.get('/', async (req, res) => {
    try {
        const { course_id: courseId } = req.query;
        const includeMetadata = ['1', 'true', 'yes'].includes(
            String(req.query?.include_metadata || req.query?.includeMetadata || '').trim().toLowerCase(),
        );
        const { body, catalogResponse } = buildAdminAssignmentsRouteResponse(
            await queryCourseAssignmentCatalog(getPool(), courseId || null),
            includeMetadata,
        );
        console.log(`[INFO] Fetched ${catalogResponse.catalogCount} visible assignments from database, ${Object.keys(catalogResponse.assignments).length} categories`);
        res.json(body);
    } catch (error) {
        console.error('Error fetching assignments from database:', error);
        res.status(Number(error?.status) || 500).json(assignmentEvidenceRequestError(error));
    }
});

export default router;
