#!/usr/bin/env node
/**
 * Migration script: JSON config to Database
 * Migrates existing config.json files to PostgreSQL database
 * 
 * Usage: node migrate_config_to_db.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pkg from 'pg';
const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_CONFIG_PATH = path.join(__dirname, '../../../../config.json');

dotenv.config({ path: path.join(__dirname, '../../../../.env') });
dotenv.config();

function buildDbPoolConfig() {
    const connectionString = process.env.GRADESYNC_DATABASE_URL || process.env.DATABASE_URL;
    if (connectionString) {
        return { connectionString };
    }

    return {
        host: process.env.POSTGRES_HOST || '127.0.0.1',
        port: Number(process.env.POSTGRES_PORT || 5432),
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        database: process.env.POSTGRES_DB,
    };
}

const pool = new Pool({
    ...buildDbPoolConfig(),
});

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function toNormalizedEmailList(values) {
    if (!Array.isArray(values)) {
        return [];
    }

    return Array.from(new Set(values.map((value) => normalizeEmail(value)).filter(Boolean)));
}

function getCourseGeneral(courseData) {
    return courseData?.general || courseData || {};
}

async function upsertUser(client, email, role) {
    await client.query(
        `
        INSERT INTO users (email, role, is_active)
        VALUES ($1, $2, true)
        ON CONFLICT (email)
        DO UPDATE SET
            role = CASE
                WHEN users.role IN ('superadmin', 'admin') THEN users.role
                WHEN EXCLUDED.role IN ('superadmin', 'admin') THEN EXCLUDED.role
                WHEN users.role = 'instructor' THEN users.role
                WHEN EXCLUDED.role = 'instructor' THEN EXCLUDED.role
                WHEN users.role = 'ta' THEN users.role
                WHEN EXCLUDED.role = 'ta' THEN EXCLUDED.role
                ELSE COALESCE(users.role, EXCLUDED.role)
            END,
            is_active = true,
            updated_at = CURRENT_TIMESTAMP
        `,
        [email, role],
    );
}

async function upsertCoursePermission(client, courseId, email, userRole, permissionLevel) {
    if (!courseId || !email) {
        return;
    }

    await upsertUser(client, email, userRole);

    await client.query(
        `
        INSERT INTO course_permissions (course_id, user_id, permission_level, granted_by)
        SELECT $1, u.id, $3, NULL
        FROM users u
        WHERE LOWER(u.email) = LOWER($2)
        ON CONFLICT (course_id, user_id)
        DO UPDATE SET
            permission_level = CASE
                WHEN course_permissions.permission_level = 'owner' THEN course_permissions.permission_level
                WHEN EXCLUDED.permission_level = 'owner' THEN EXCLUDED.permission_level
                WHEN course_permissions.permission_level = 'editor' THEN course_permissions.permission_level
                WHEN EXCLUDED.permission_level = 'editor' THEN EXCLUDED.permission_level
                ELSE COALESCE(course_permissions.permission_level, EXCLUDED.permission_level)
            END,
            granted_at = CURRENT_TIMESTAMP
        `,
        [courseId, email, permissionLevel],
    );
}

async function migrateGradeSyncConfig() {
    console.log('🔄 Migrating GradeSync config.json to database...');

    if (!fs.existsSync(ROOT_CONFIG_PATH)) {
        console.log('⚠️  root config.json not found, skipping...');
        return;
    }

    const rootConfig = JSON.parse(fs.readFileSync(ROOT_CONFIG_PATH, 'utf8'));
    const config = rootConfig?.gradesync || rootConfig;
    const gradeviewConfig = rootConfig?.gradeview || {};
    const globalAdmins = toNormalizedEmailList(gradeviewConfig?.admins);
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Migrate global settings
        console.log('  📝 Migrating global settings...');
        const globalSettings = config.global_settings || {};
        
        for (const [key, value] of Object.entries(globalSettings)) {
            let valueType = 'string';
            let stringValue = String(value);
            
            if (typeof value === 'number') {
                valueType = 'integer';
            } else if (typeof value === 'boolean') {
                valueType = 'boolean';
            } else if (Array.isArray(value) || typeof value === 'object') {
                valueType = 'json';
                stringValue = JSON.stringify(value);
            }
            
            await client.query(`
                INSERT INTO system_config (key, value, value_type)
                VALUES ($1, $2, $3)
                ON CONFLICT (key) DO UPDATE SET value = $2, value_type = $3
            `, [key, stringValue, valueType]);
        }
        
        // Migrate courses
        console.log('  📚 Migrating courses...');
        const courses = config.courses || [];
        
        const migratedCourseIds = [];

        for (const courseData of courses) {
            const general = courseData?.general || courseData || {};
            const gradesyncSection = courseData?.gradesync || courseData || {};
            const gradeviewSection = courseData?.gradeview || courseData || {};

            const gradescope = gradesyncSection?.sources?.gradescope || courseData?.sources?.gradescope || courseData?.gradescope || {};
            const prairielearn = gradesyncSection?.sources?.prairielearn || courseData?.sources?.prairielearn || courseData?.prairielearn || {};
            const iclicker = gradesyncSection?.sources?.iclicker || courseData?.sources?.iclicker || courseData?.iclicker || {};

            // Insert or update course
            const courseResult = await client.query(`
                INSERT INTO courses (
                    gradescope_course_id, name, department, course_number,
                    semester, year, instructor, is_active
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
                ON CONFLICT (gradescope_course_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    department = EXCLUDED.department,
                    course_number = EXCLUDED.course_number,
                    semester = EXCLUDED.semester,
                    year = EXCLUDED.year,
                    instructor = EXCLUDED.instructor,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING id
            `, [
                gradescope?.course_id || general.id,
                general.name,
                general.department,
                general.course_number,
                general.semester,
                general.year,
                general.instructor
            ]);
            
            const courseId = courseResult.rows[0].id;
            migratedCourseIds.push(courseId);
            console.log(`    ✅ Course: ${general.name || general.id} (ID: ${courseId})`);
            
            // Insert course config
            await client.query(`
                INSERT INTO course_configs (
                    course_id, 
                    gradescope_enabled, gradescope_course_id, gradescope_sync_interval_hours,
                    prairielearn_enabled, prairielearn_course_id,
                    iclicker_enabled, iclicker_course_names,
                    database_enabled, use_as_primary
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (course_id) DO UPDATE SET
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
            `, [
                courseId,
                gradescope?.enabled || false,
                gradescope?.course_id,
                gradescope?.sync_interval_hours || 24,
                prairielearn?.enabled || false,
                prairielearn?.course_id,
                iclicker?.enabled || false,
                iclicker?.course_names || [],
                gradesyncSection?.database?.enabled ?? courseData?.database?.enabled ?? true,
                gradesyncSection?.database?.use_as_primary ?? courseData?.database?.use_as_primary ?? true
            ]);
            
            // Insert assignment categories
            const assignmentCategories =
                gradesyncSection?.assignment_categories
                || gradeviewSection?.assignment_categories
                || courseData.assignment_categories;

            if (assignmentCategories) {
                await client.query('DELETE FROM assignment_categories WHERE course_id = $1', [courseId]);
                
                for (let i = 0; i < assignmentCategories.length; i++) {
                    const category = assignmentCategories[i];
                    await client.query(`
                        INSERT INTO assignment_categories (course_id, name, patterns, display_order)
                        VALUES ($1, $2, $3, $4)
                    `, [courseId, category.name, category.patterns || [], i]);
                }
                
                console.log(`      📋 Added ${assignmentCategories.length} categories`);
            }

            const courseAdmins = toNormalizedEmailList(general?.admins || courseData?.admins);
            const courseInstructors = toNormalizedEmailList(general?.instructors);
            const courseTas = toNormalizedEmailList(general?.tas);

            for (const email of courseAdmins) {
                await upsertCoursePermission(client, courseId, email, 'admin', 'owner');
            }

            for (const email of courseInstructors) {
                await upsertCoursePermission(client, courseId, email, 'instructor', 'editor');
            }

            for (const email of courseTas) {
                await upsertCoursePermission(client, courseId, email, 'ta', 'viewer');
            }
        }

        if (globalAdmins.length > 0) {
            console.log('  👥 Migrating global admins to all active courses...');
            for (const email of globalAdmins) {
                await upsertUser(client, email, 'admin');
                for (const courseId of migratedCourseIds) {
                    await upsertCoursePermission(client, courseId, email, 'admin', 'owner');
                }
            }
            console.log(`    ✅ Migrated ${globalAdmins.length} global admins`);
        }
        
        await client.query('COMMIT');
        console.log('✅ GradeSync configuration migrated successfully!');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error migrating GradeSync config:', error);
        throw error;
    } finally {
        client.release();
    }
}

async function migrateGradeViewConfig() {
    console.log('\n🔄 Migrating GradeView config to database...');

    if (!fs.existsSync(ROOT_CONFIG_PATH)) {
        console.log('⚠️  root config.json not found, skipping...');
        return;
    }

    const rootConfig = JSON.parse(fs.readFileSync(ROOT_CONFIG_PATH, 'utf8'));
    const config = rootConfig?.gradeview || rootConfig;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Migrate GradeView configs
        const configs = [
            ['google_oauth_client_id', config.googleconfig?.oauth?.clientid, 'string']
        ];
        
        for (const [key, value, valueType] of configs) {
            if (value !== undefined && value !== null) {
                await client.query(`
                    UPDATE gradeview_config 
                    SET value = $1, value_type = $2, updated_at = CURRENT_TIMESTAMP
                    WHERE key = $3
                `, [String(value), valueType, key]);
            }
        }
        
        // Users and permissions are migrated in migrateGradeSyncConfig.
        
        await client.query('COMMIT');
        console.log('✅ GradeView configuration migrated successfully!');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error migrating GradeView config:', error);
        throw error;
    } finally {
        client.release();
    }
}

async function main() {
    console.log('🚀 Starting configuration migration to database...\n');
    
    try {
        await migrateGradeSyncConfig();
        await migrateGradeViewConfig();
        
        console.log('\n✨ Migration completed successfully!');
        console.log('\n📝 Next steps:');
        console.log('  1. Verify users and course_permissions rows in database');
        console.log('  2. Test login/isadmin for migrated staff/admin accounts');
        console.log('  3. Keep permission management in DB/API moving forward');
        console.log('  4. Backup and archive old config-based role lists if no longer needed');
        
    } catch (error) {
        console.error('\n❌ Migration failed:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
