import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import configService from './service.js';
import { isAdmin } from '../../../lib/userlib.mjs';
import { getEmailFromAuth } from '../../../lib/googleAuthHelper.mjs';
import AuthorizationError from '../../../lib/errors/http/AuthorizationError.js';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GRADEVIEW_CONFIG_PATH = path.resolve(__dirname, '../../../config/default.json');
const GRADESYNC_CONFIG_PATH = path.resolve(__dirname, '../../../../gradesync/config.json');

const ensureAdmin = async (req, res) => {
    try {
        const authEmail = await getEmailFromAuth(req);
        const adminStatus = await isAdmin(authEmail);
        if (!adminStatus) {
            res.status(403).json({ error: 'Admin access required' });
            return null;
        }
        return authEmail;
    } catch (error) {
        if (error?.name === 'AuthorizationError') {
            res.status(401).json({ error: error.message || 'Authentication required' });
            return null;
        }
        if (error instanceof AuthorizationError) {
            res.status(401).json({ error: error.message || 'Authentication required' });
            return null;
        }
        throw error;
    }
};

/**
 * Middleware to extract user ID from token/session
 * TODO: Integrate with your actual authentication system
 */
const getUserId = (req) => {
    // This should extract the user ID from your JWT token or session
    // For now, placeholder implementation
    return req.user?.id || req.headers['x-user-id'];
};

// GET /v2/config - Get GradeView configuration
router.get('/', async (req, res, next) => {
    try {
        const authEmail = await ensureAdmin(req, res);
        if (!authEmail) {
            return;
        }

        const file = await fs.readFile(GRADEVIEW_CONFIG_PATH, 'utf8');
        const config = JSON.parse(file);
        res.status(200).json(config);
    } catch (error) {
        console.error('Error getting GradeView config:', error);
        next(error);
    }
});

// PUT /v2/config - Update GradeView configuration
router.put('/', async (req, res, next) => {
    try {
        const authEmail = await ensureAdmin(req, res);
        if (!authEmail) {
            return;
        }

        await fs.writeFile(GRADEVIEW_CONFIG_PATH, `${JSON.stringify(req.body, null, 4)}\n`, 'utf8');
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
        const authEmail = await ensureAdmin(req, res);
        if (!authEmail) {
            return;
        }

        const file = await fs.readFile(GRADESYNC_CONFIG_PATH, 'utf8');
        const config = JSON.parse(file);
        res.status(200).json(config);
    } catch (error) {
        console.error('Error getting GradeSync config:', error);
        next(error);
    }
});

// PUT /v2/config/sync - Update GradeSync configuration
router.put('/sync', async (req, res, next) => {
    try {
        const authEmail = await ensureAdmin(req, res);
        if (!authEmail) {
            return;
        }

        await fs.writeFile(GRADESYNC_CONFIG_PATH, `${JSON.stringify(req.body, null, 2)}\n`, 'utf8');
        res.status(200).json({ success: true, message: 'GradeSync configuration saved' });
    } catch (error) {
        console.error('Error updating GradeSync config:', error);
        next(error);
    }
});

// GET /v2/config/courses - Get all courses user has access to
router.get('/courses', async (req, res, next) => {
    try {
        const userId = getUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        const courses = await configService.getUserCourses(userId);
        res.status(200).json({ courses });
    } catch (error) {
        console.error('Error getting user courses:', error);
        next(error);
    }
});

// GET /v2/config/courses/:courseId - Get specific course configuration
router.get('/courses/:courseId', async (req, res, next) => {
    try {
        const userId = getUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        const courseId = parseInt(req.params.courseId);
        const config = await configService.getCourseConfig(userId, courseId);
        res.status(200).json(config);
    } catch (error) {
        console.error('Error getting course config:', error);
        if (error.message.includes('Access denied') || error.message.includes('permission')) {
            return res.status(403).json({ error: error.message });
        }
        if (error.message === 'Course not found') {
            return res.status(404).json({ error: error.message });
        }
        next(error);
    }
});

// PUT /v2/config/courses/:courseId - Update course configuration
router.put('/courses/:courseId', async (req, res, next) => {
    try {
        const userId = getUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        const courseId = parseInt(req.params.courseId);
        const result = await configService.updateCourseConfig(userId, courseId, req.body);
        res.status(200).json(result);
    } catch (error) {
        console.error('Error updating course config:', error);
        if (error.message.includes('permission required')) {
            return res.status(403).json({ error: error.message });
        }
        next(error);
    }
});

// GET /v2/config/system - Get system global settings
router.get('/system', async (req, res, next) => {
    try {
        const userId = getUserId(req);
        if (!userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        const config = await configService.getSystemConfig(userId);
        res.status(200).json(config);
    } catch (error) {
        console.error('Error getting system config:', error);
        if (error.message === 'Admin access required') {
            return res.status(403).json({ error: error.message });
        }
        next(error);
    }
});

export default router;
