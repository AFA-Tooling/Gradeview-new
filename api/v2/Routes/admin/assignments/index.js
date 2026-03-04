import { Router } from 'express';
import { getPool } from '../../../../lib/dbHelper.mjs';

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
        const pool = getPool();
        const naturalCollator = new Intl.Collator('en', {
            numeric: true,
            sensitivity: 'base',
            ignorePunctuation: true,
        });
        let query = `
            SELECT 
                COALESCE(a.category, 'Uncategorized') as category,
                a.title as assignment_name,
                a.max_points,
                ac.display_order
            FROM assignments a
            JOIN courses c ON a.course_id = c.id
            LEFT JOIN assignment_categories ac
              ON ac.course_id = c.id
             AND LOWER(TRIM(ac.name)) = LOWER(TRIM(COALESCE(a.category, 'Uncategorized')))
            WHERE a.title IS NOT NULL
        `;

        const params = [];
        if (courseId) {
            query += ` AND (c.gradescope_course_id::text = $1 OR c.id::text = $1)`;
            params.push(courseId);
        }
        
        const result = await pool.query(query, params);

        const sortedRows = [...result.rows].sort((a, b) => {
            const orderA = Number.isFinite(Number(a.display_order)) ? Number(a.display_order) : Number.MAX_SAFE_INTEGER;
            const orderB = Number.isFinite(Number(b.display_order)) ? Number(b.display_order) : Number.MAX_SAFE_INTEGER;
            if (orderA !== orderB) return orderA - orderB;

            const categoryA = (a.category || '').trim();
            const categoryB = (b.category || '').trim();
            const categoryCmp = naturalCollator.compare(categoryA, categoryB);
            if (categoryCmp !== 0) return categoryCmp;

            const nameA = (a.assignment_name || '').trim();
            const nameB = (b.assignment_name || '').trim();
            return naturalCollator.compare(nameA, nameB);
        });
        
        // Group by category
        const grouped = {};
        sortedRows.forEach(row => {
            const category = row.category.trim();
            const name = row.assignment_name.trim();
            const maxPoints = parseFloat(row.max_points) || 0;
            
            if (!grouped[category]) {
                grouped[category] = {};
            }
            grouped[category][name] = maxPoints;
        });
        
        console.log(`[INFO] Fetched ${result.rows.length} assignments from database, ${Object.keys(grouped).length} categories`);
        
        res.json(grouped);
    } catch (error) {
        console.error('Error fetching assignments from database:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch assignments' });
    }
});

export default router;
