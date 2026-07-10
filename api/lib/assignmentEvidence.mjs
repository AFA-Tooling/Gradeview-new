export const ASSIGNMENT_EVIDENCE_SCHEMA_VERSION = '1.0';
export const ASSIGNMENT_EVIDENCE_BASIS = 'assignment_evidence';

export const ASSIGNMENT_EVIDENCE_STATUS = Object.freeze({
    EARNED_ZERO: 'earned_zero',
    SUBMITTED: 'submitted',
    MISSING: 'missing',
    NOT_DUE: 'not_due',
    DUE_UNKNOWN: 'due_unknown',
    NOT_SYNCED: 'not_synced',
    NOT_APPLICABLE: 'not_applicable',
    REQUEST_ERROR: 'request_error',
});

export const ASSIGNMENT_DUE_STATE = Object.freeze({
    PAST_DUE: 'past_due',
    NOT_DUE: 'not_due',
    DUE_UNKNOWN: 'due_unknown',
});

const RAW_CATEGORY_DISPLAY_NAMES = Object.freeze({
    _attendance_raw: 'Attendance / Participation',
    _labs_raw: 'Labs',
    _projects_raw: 'Projects',
});

function safeJsonObject(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return {};
}

function firstPresentValue(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== '');
}

function optionalNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function normalizeDateValue(value) {
    if (value === null || value === undefined || value === '') return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeText(value = '') {
    return String(value || '').trim().toLowerCase();
}

function normalizeBoolean(value) {
    if (typeof value === 'boolean') return value;
    const normalized = normalizeText(value);
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
    return null;
}

function assignmentKey(row = {}) {
    return String(
        row.assignment_pk
        ?? row.assignmentId
        ?? row.assignment_id
        ?? row.externalAssignmentId
        ?? '',
    );
}

function mergeDefined(base, overlay) {
    const merged = { ...base };
    Object.entries(overlay || {}).forEach(([key, value]) => {
        if (value !== undefined) merged[key] = value;
    });
    return merged;
}

export function resolveAssignmentDueAt(row = {}) {
    const metadata = safeJsonObject(row.assignment_metadata || row.assignmentMetadata || row.metadata);
    const submissionWindow = safeJsonObject(metadata.submission_window || metadata.submissionWindow);
    const dates = safeJsonObject(metadata.dates);

    return normalizeDateValue(firstPresentValue(
        row.due_at,
        row.dueAt,
        row.exam_due_at,
        row.examDueAt,
        metadata.due,
        metadata.due_at,
        metadata.dueAt,
        metadata.due_date,
        metadata.dueDate,
        metadata.deadline,
        metadata.deadline_at,
        metadata.deadlineAt,
        submissionWindow.due_date,
        submissionWindow.dueDate,
        submissionWindow.due_at,
        submissionWindow.dueAt,
        dates.due,
        dates.due_at,
        dates.dueAt,
    ));
}

export function resolveAssignmentReleaseAt(row = {}) {
    const metadata = safeJsonObject(row.assignment_metadata || row.assignmentMetadata || row.metadata);
    const submissionWindow = safeJsonObject(metadata.submission_window || metadata.submissionWindow);
    const dates = safeJsonObject(metadata.dates);

    return normalizeDateValue(firstPresentValue(
        row.release_at,
        row.releaseAt,
        row.exam_release_at,
        row.examReleaseAt,
        metadata.release,
        metadata.release_at,
        metadata.releaseAt,
        metadata.release_date,
        metadata.releaseDate,
        submissionWindow.release_date,
        submissionWindow.releaseDate,
        submissionWindow.release_at,
        submissionWindow.releaseAt,
        dates.release,
        dates.release_at,
        dates.releaseAt,
    ));
}

export function getAssignmentDueState(row = {}, now = Date.now()) {
    const dueAt = resolveAssignmentDueAt(row);
    if (!dueAt) return ASSIGNMENT_DUE_STATE.DUE_UNKNOWN;
    const dueTimestamp = new Date(dueAt).getTime();
    if (!Number.isFinite(dueTimestamp)) return ASSIGNMENT_DUE_STATE.DUE_UNKNOWN;
    return dueTimestamp <= Number(now)
        ? ASSIGNMENT_DUE_STATE.PAST_DUE
        : ASSIGNMENT_DUE_STATE.NOT_DUE;
}

export function isVisibleCatalogAssignment(row = {}) {
    const title = String(row.assignment_name || row.title || row.name || '').trim();
    if (!title) return false;

    const metadata = safeJsonObject(row.assignment_metadata || row.assignmentMetadata || row.metadata);
    const explicitVisible = normalizeBoolean(firstPresentValue(
        row.is_visible,
        row.isVisible,
        metadata.is_visible,
        metadata.isVisible,
        metadata.visible,
    ));
    const explicitHidden = normalizeBoolean(firstPresentValue(
        row.is_hidden,
        row.isHidden,
        metadata.is_hidden,
        metadata.isHidden,
        metadata.hidden,
    ));
    if (explicitVisible === false || explicitHidden === true) return false;
    const published = normalizeBoolean(firstPresentValue(
        row.is_published,
        row.isPublished,
        metadata.is_published,
        metadata.isPublished,
        metadata.published,
    ));
    if (published === false) return false;
    const audience = normalizeText(firstPresentValue(metadata.audience, metadata.visibility));
    if (['staff', 'internal', 'hidden'].includes(audience)) return false;

    const category = normalizeText(row.category);
    if (category.startsWith('_') && !RAW_CATEGORY_DISPLAY_NAMES[category]) return false;

    const externalId = normalizeText(row.external_assignment_id || row.externalAssignmentId || row.assignment_id);
    if (['labs_rollup:', 'project_rollup:', 'attendance_rollup:'].some((prefix) => externalId.startsWith(prefix))) {
        return false;
    }

    return true;
}

export function normalizeCatalogCategory(category = '') {
    const normalized = normalizeText(category);
    return RAW_CATEGORY_DISPLAY_NAMES[normalized] || String(category || 'Uncategorized');
}

function hasSubmissionRecord(row = {}) {
    const explicit = normalizeBoolean(row.has_submission ?? row.hasSourceRecord);
    if (explicit != null) return explicit;
    return row.submission_pk !== null && row.submission_pk !== undefined && row.submission_pk !== '';
}

function hasUsableSubmission(row = {}) {
    const submissionStatus = normalizeText(row.submission_status || row.submissionStatus || row.status);
    if ([
        'missing',
        'not_submitted',
        'unsubmitted',
        'not_synced',
        'not_applicable',
        'not applicable',
        'n/a',
        'excused',
    ].includes(submissionStatus)) return false;

    if (optionalNumber(row.total_score ?? row.score) != null) return true;
    if (['request_error', 'error'].includes(submissionStatus)) return false;
    if (['submitted', 'graded', 'recorded', 'late'].includes(submissionStatus)) return true;
    if (row.submission_time || row.submissionTime) return true;
    if ((optionalNumber(row.submission_count ?? row.submissionCount) || 0) > 0) return true;
    return Boolean((row.submission_id || row.submissionId) && submissionStatus);
}

function isNotApplicable(row = {}, metadata = {}) {
    const status = normalizeText(row.submission_status || row.submissionStatus || row.status);
    if (['not_applicable', 'not applicable', 'n/a', 'excused'].includes(status)) return true;

    const explicitApplicable = normalizeBoolean(firstPresentValue(
        row.assignment_applicable,
        row.assignmentApplicable,
        metadata.applicable,
    ));
    if (explicitApplicable === false) return true;
    if (normalizeBoolean(firstPresentValue(metadata.not_applicable, metadata.notApplicable)) === true) return true;

    const email = normalizeText(row.student_email || row.studentEmail);
    const sid = normalizeText(row.student_sid || row.studentSid);
    const excluded = [
        ...(Array.isArray(metadata.not_applicable_students) ? metadata.not_applicable_students : []),
        ...(Array.isArray(metadata.notApplicableStudents) ? metadata.notApplicableStudents : []),
    ].map(normalizeText);
    return Boolean((email && excluded.includes(email)) || (sid && excluded.includes(sid)));
}

function resolveSourceSyncStatus(row = {}, hasEvidence = false) {
    const metadata = safeJsonObject(row.assignment_metadata || row.assignmentMetadata || row.metadata);
    const explicit = normalizeText(firstPresentValue(
        row.source_sync_status,
        row.sourceSyncStatus,
        metadata.source_sync_status,
        metadata.sourceSyncStatus,
        metadata.sync_status,
        metadata.syncStatus,
    ));
    if (['not_synced', 'pending', 'never_synced'].includes(explicit)) return 'not_synced';
    if (['request_error', 'error', 'failed'].includes(explicit)) return 'request_error';
    if (['synced', 'complete', 'available'].includes(explicit)) return 'synced';

    const explicitSynced = normalizeBoolean(row.source_synced ?? row.sourceSynced);
    if (explicitSynced === true || hasEvidence) return 'synced';
    if (explicitSynced === false) return 'not_synced';

    // `courses.last_synced_at` is intentionally not a fallback here. A course
    // sync can be marked complete when only the database/derived-score step is
    // enabled, so it does not prove that this assignment's catalog/submission
    // source was queried. The assignment timestamp (or explicit source state)
    // is the narrowest trustworthy sync boundary.
    return firstPresentValue(
        row.assignment_last_synced_at,
        row.assignmentLastSyncedAt,
    ) ? 'synced' : 'not_synced';
}

export function resolveAssignmentEvidenceStatus(row = {}, now = Date.now()) {
    const metadata = safeJsonObject(row.assignment_metadata || row.assignmentMetadata || row.metadata);
    const submissionStatus = normalizeText(row.submission_status || row.submissionStatus || row.status);
    const hasSourceRecord = hasSubmissionRecord(row);
    const usableSubmission = hasUsableSubmission(row);
    const sourceSyncStatus = resolveSourceSyncStatus(row, hasSourceRecord || usableSubmission);

    if (isNotApplicable(row, metadata)) return ASSIGNMENT_EVIDENCE_STATUS.NOT_APPLICABLE;

    // Stored evidence is authoritative even when a later refresh failed. The
    // serializer exposes that refresh failure separately as `syncWarning`.
    if (usableSubmission) {
        const score = optionalNumber(row.total_score ?? row.score);
        return score === 0
            ? ASSIGNMENT_EVIDENCE_STATUS.EARNED_ZERO
            : ASSIGNMENT_EVIDENCE_STATUS.SUBMITTED;
    }

    // Without usable evidence, an explicit request failure outranks both the
    // sync sentinel and the due-date schedule. This prevents an error row from
    // being mislabeled as a real missing submission.
    if (
        row.request_error
        || row.requestError
        || sourceSyncStatus === 'request_error'
        || ['request_error', 'error'].includes(submissionStatus)
    ) {
        return ASSIGNMENT_EVIDENCE_STATUS.REQUEST_ERROR;
    }

    if (submissionStatus === 'not_synced' || sourceSyncStatus === 'not_synced') {
        return ASSIGNMENT_EVIDENCE_STATUS.NOT_SYNCED;
    }
    const releaseAt = resolveAssignmentReleaseAt(row);
    if (releaseAt && new Date(releaseAt).getTime() > Number(now)) {
        return ASSIGNMENT_EVIDENCE_STATUS.NOT_DUE;
    }
    const dueState = getAssignmentDueState(row, now);
    if (dueState === ASSIGNMENT_DUE_STATE.DUE_UNKNOWN) return ASSIGNMENT_EVIDENCE_STATUS.DUE_UNKNOWN;
    return dueState === ASSIGNMENT_DUE_STATE.NOT_DUE
        ? ASSIGNMENT_EVIDENCE_STATUS.NOT_DUE
        : ASSIGNMENT_EVIDENCE_STATUS.MISSING;
}

function toCatalogRow(row = {}) {
    return {
        assignment_pk: row.assignment_pk,
        assignment_id: row.assignment_id,
        external_assignment_id: row.external_assignment_id,
        assignment_name: row.assignment_name,
        category: row.category,
        assignment_max_points: row.assignment_max_points ?? row.max_points,
        assignment_metadata: row.assignment_metadata,
        assignment_last_synced_at: row.assignment_last_synced_at,
        course_last_synced_at: row.course_last_synced_at,
        course_id: row.course_id,
        gradescope_course_id: row.gradescope_course_id,
        course_name: row.course_name,
        semester: row.semester,
        year: row.year,
        student_id: row.student_id,
        student_sid: row.student_sid,
        student_email: row.student_email,
        student_name: row.student_name,
        exam_due_at: row.exam_due_at,
        exam_release_at: row.exam_release_at,
        due_at: row.due_at,
        release_at: row.release_at,
        source_synced: row.source_synced,
        source_sync_status: row.source_sync_status,
        assignment_applicable: row.assignment_applicable,
    };
}

function toEvidenceRow(row = {}) {
    return {
        assignment_pk: row.assignment_pk,
        submission_pk: row.submission_pk,
        total_score: row.total_score,
        submission_max_points: row.submission_max_points,
        submission_status: row.submission_status,
        submission_id: row.submission_id,
        submission_time: row.submission_time,
        lateness: row.lateness,
        submission_count: row.submission_count,
        request_error: row.request_error ?? row.requestError,
    };
}

export function serializeAssignmentEvidence(row = {}, { now = Date.now() } = {}) {
    const evidenceStatus = resolveAssignmentEvidenceStatus(row, now);
    const hasSourceRecord = hasSubmissionRecord(row);
    const usableSubmission = hasUsableSubmission(row);
    const recordedScore = optionalNumber(row.total_score ?? row.score);
    const maxPoints = optionalNumber(row.assignment_max_points ?? row.max_points ?? row.maxPoints)
        ?? optionalNumber(row.submission_max_points ?? row.submissionMaxPoints);
    const scoredStatus = [
        ASSIGNMENT_EVIDENCE_STATUS.EARNED_ZERO,
        ASSIGNMENT_EVIDENCE_STATUS.SUBMITTED,
    ].includes(evidenceStatus);
    const score = scoredStatus ? recordedScore : null;
    const dueAt = resolveAssignmentDueAt(row);
    const releaseAt = resolveAssignmentReleaseAt(row);
    const sourceSyncStatus = resolveSourceSyncStatus(row, hasSourceRecord || usableSubmission);
    const assignmentId = assignmentKey(row);

    return {
        schemaVersion: ASSIGNMENT_EVIDENCE_SCHEMA_VERSION,
        basis: ASSIGNMENT_EVIDENCE_BASIS,
        assignmentId,
        externalAssignmentId: row.external_assignment_id || row.externalAssignmentId || row.assignment_id || null,
        category: normalizeCatalogCategory(row.category),
        rawCategory: String(row.category || 'Uncategorized'),
        name: String(row.assignment_name || row.title || row.name || ''),
        maxPoints,
        evidenceStatus,
        score,
        recordedScore,
        percentage: score != null && maxPoints != null && maxPoints > 0 ? (score / maxPoints) * 100 : null,
        submitted: [
            ASSIGNMENT_EVIDENCE_STATUS.EARNED_ZERO,
            ASSIGNMENT_EVIDENCE_STATUS.SUBMITTED,
        ].includes(evidenceStatus),
        hasSourceRecord,
        hasUsableSubmission: usableSubmission,
        hasSubmissionEvidence: scoredStatus,
        submissionStatus: row.submission_status || row.submissionStatus || row.status || null,
        submissionId: row.submission_id || row.submissionId || null,
        submissionTime: normalizeDateValue(row.submission_time ?? row.submissionTime),
        lateness: row.lateness ?? null,
        dueAt,
        releaseAt,
        dueState: getAssignmentDueState({ ...row, dueAt }, now),
        sourceSyncStatus,
        syncWarning: sourceSyncStatus === 'request_error'
            && evidenceStatus !== ASSIGNMENT_EVIDENCE_STATUS.REQUEST_ERROR
            ? 'request_error'
            : null,
        applicable: evidenceStatus !== ASSIGNMENT_EVIDENCE_STATUS.NOT_APPLICABLE,
        requestError: evidenceStatus === ASSIGNMENT_EVIDENCE_STATUS.REQUEST_ERROR
            ? String(row.request_error || row.requestError || 'Assignment evidence request failed')
            : null,
        student: {
            id: row.student_id == null ? null : String(row.student_id),
            sid: row.student_sid || row.studentSid || null,
            email: row.student_email || row.studentEmail || null,
            name: row.student_name || row.studentName || null,
        },
        course: {
            id: row.course_id == null ? null : String(row.course_id),
            gradescopeCourseId: row.gradescope_course_id == null ? null : String(row.gradescope_course_id),
            name: row.course_name || row.courseName || null,
            semester: row.semester || null,
            year: row.year || null,
        },
    };
}

export function joinAssignmentCatalogWithEvidence(
    catalogRows = [],
    evidenceRows = [],
    { now = Date.now() } = {},
) {
    const evidenceByAssignment = new Map();
    (Array.isArray(evidenceRows) ? evidenceRows : []).forEach((row) => {
        const key = assignmentKey(row);
        if (key) evidenceByAssignment.set(key, row);
    });

    return (Array.isArray(catalogRows) ? catalogRows : [])
        .filter(isVisibleCatalogAssignment)
        .map((catalogRow) => {
            const evidenceRow = evidenceByAssignment.get(assignmentKey(catalogRow));
            return serializeAssignmentEvidence(mergeDefined(catalogRow, evidenceRow), { now });
        });
}

export function countAssignmentEvidenceStatuses(rows = []) {
    return (Array.isArray(rows) ? rows : []).reduce((counts, row) => {
        const status = String(row?.evidenceStatus || ASSIGNMENT_EVIDENCE_STATUS.REQUEST_ERROR);
        counts[status] = (counts[status] || 0) + 1;
        return counts;
    }, {});
}

export function summarizeAssignmentEvidence(rows = [], {
    matches = () => true,
    recentLimit = 5,
} = {}) {
    const items = (Array.isArray(rows) ? rows : [])
        .filter((row) => matches(row?.category || '', row?.name || '', row))
        .map((row) => ({
            category: row.category || 'Uncategorized',
            name: row.name || '',
            score: optionalNumber(row.score),
            maxPoints: optionalNumber(row.maxPoints),
            percentage: optionalNumber(row.percentage),
            submissionTime: row.submissionTime || null,
            lateness: row.lateness || '',
            evidenceStatus: row.evidenceStatus || ASSIGNMENT_EVIDENCE_STATUS.DUE_UNKNOWN,
            submitted: [
                ASSIGNMENT_EVIDENCE_STATUS.EARNED_ZERO,
                ASSIGNMENT_EVIDENCE_STATUS.SUBMITTED,
            ].includes(row.evidenceStatus),
            dueAt: row.dueAt || null,
            releaseAt: row.releaseAt || null,
        }));

    const recentItems = items
        .filter((item) => item.submitted)
        .slice(0, Math.max(0, Number(recentLimit) || 0));
    const scoredItems = items.filter((item) => item.submitted && item.score != null);
    const rawScore = scoredItems.reduce((sum, item) => sum + item.score, 0);
    const rawMax = scoredItems.reduce((sum, item) => sum + (item.maxPoints || 0), 0);
    const evidenceStatusCounts = countAssignmentEvidenceStatuses(items);
    const dueEligibleItems = items.filter((item) => [
        ASSIGNMENT_EVIDENCE_STATUS.EARNED_ZERO,
        ASSIGNMENT_EVIDENCE_STATUS.SUBMITTED,
        ASSIGNMENT_EVIDENCE_STATUS.MISSING,
    ].includes(item.evidenceStatus));
    const dueScore = dueEligibleItems.reduce((sum, item) => (
        sum + (item.submitted && item.score != null ? item.score : 0)
    ), 0);
    const dueMax = dueEligibleItems.reduce((sum, item) => sum + (item.maxPoints || 0), 0);
    const incompleteMetadataItems = (
        (evidenceStatusCounts[ASSIGNMENT_EVIDENCE_STATUS.DUE_UNKNOWN] || 0)
        + (evidenceStatusCounts[ASSIGNMENT_EVIDENCE_STATUS.NOT_SYNCED] || 0)
        + (evidenceStatusCounts[ASSIGNMENT_EVIDENCE_STATUS.REQUEST_ERROR] || 0)
    );

    return {
        basis: ASSIGNMENT_EVIDENCE_BASIS,
        status: items.length === 0
            ? 'unavailable'
            : (incompleteMetadataItems > 0 ? 'partial' : 'complete'),
        totalItems: items.length,
        submittedItems: items.filter((item) => item.submitted).length,
        missingItems: evidenceStatusCounts[ASSIGNMENT_EVIDENCE_STATUS.MISSING] || 0,
        notDueItems: evidenceStatusCounts[ASSIGNMENT_EVIDENCE_STATUS.NOT_DUE] || 0,
        dueUnknownItems: evidenceStatusCounts[ASSIGNMENT_EVIDENCE_STATUS.DUE_UNKNOWN] || 0,
        notSyncedItems: evidenceStatusCounts[ASSIGNMENT_EVIDENCE_STATUS.NOT_SYNCED] || 0,
        notApplicableItems: evidenceStatusCounts[ASSIGNMENT_EVIDENCE_STATUS.NOT_APPLICABLE] || 0,
        requestErrorItems: evidenceStatusCounts[ASSIGNMENT_EVIDENCE_STATUS.REQUEST_ERROR] || 0,
        evidenceStatusCounts,
        rawScore,
        rawMax,
        rawPercentage: rawMax > 0 ? (rawScore / rawMax) * 100 : null,
        dueItemCount: dueEligibleItems.length,
        dueScore,
        dueMax,
        duePercentage: dueMax > 0 ? (dueScore / dueMax) * 100 : null,
        recentItems,
    };
}

export function attachAssignmentEvidenceToCanonicalGrade(
    canonicalGrade,
    assignmentEvidence = [],
    categoryBlocks = [],
) {
    const evidence = Array.isArray(assignmentEvidence) ? assignmentEvidence : [];
    const statusCounts = countAssignmentEvidenceStatuses(evidence);
    const incompleteEvidenceCount = (
        (statusCounts[ASSIGNMENT_EVIDENCE_STATUS.DUE_UNKNOWN] || 0)
        + (statusCounts[ASSIGNMENT_EVIDENCE_STATUS.NOT_SYNCED] || 0)
        + (statusCounts[ASSIGNMENT_EVIDENCE_STATUS.REQUEST_ERROR] || 0)
    );

    return {
        ...(canonicalGrade || {}),
        rawEvidence: {
            basis: 'raw_evidence',
            status: 'available',
            catalogCount: evidence.length,
            submissionCount: evidence.filter((row) => [
                ASSIGNMENT_EVIDENCE_STATUS.EARNED_ZERO,
                ASSIGNMENT_EVIDENCE_STATUS.SUBMITTED,
            ].includes(row?.evidenceStatus)).length,
            statusCounts,
            source: 'assignment_catalog_left_join',
        },
        dueWorkProgress: {
            basis: 'due_work_progress',
            status: evidence.length === 0
                ? 'unavailable'
                : (incompleteEvidenceCount > 0 ? 'partial' : 'complete'),
            catalogCount: evidence.length,
            statusCounts,
            categories: Object.fromEntries(
                (Array.isArray(categoryBlocks) ? categoryBlocks : [])
                    .filter((block) => block?.key)
                    .map((block) => [block.key, block.summary]),
            ),
        },
    };
}

export function groupAssignmentEvidence(rows = []) {
    const grouped = {};
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        const category = row.category || 'Uncategorized';
        if (!grouped[category]) grouped[category] = {};
        grouped[category][row.name] = {
            assignmentId: row.assignmentId,
            externalAssignmentId: row.externalAssignmentId,
            student: row.score,
            max: row.maxPoints,
            evidenceStatus: row.evidenceStatus,
            recordedScore: row.recordedScore,
            submissionStatus: row.submissionStatus,
            hasSourceRecord: row.hasSourceRecord,
            hasSubmissionEvidence: row.hasSubmissionEvidence,
            submissionTime: row.submissionTime,
            lateness: row.lateness,
            dueAt: row.dueAt,
            releaseAt: row.releaseAt,
            dueState: row.dueState,
            sourceSyncStatus: row.sourceSyncStatus,
            applicable: row.applicable,
            requestError: row.requestError,
        };
    });
    return grouped;
}

export function sortAssignmentEvidenceByTime(rows = []) {
    return (Array.isArray(rows) ? rows : []).slice().sort((left, right) => {
        const leftTime = left?.submissionTime ? new Date(left.submissionTime).getTime() : Number.NEGATIVE_INFINITY;
        const rightTime = right?.submissionTime ? new Date(right.submissionTime).getTime() : Number.NEGATIVE_INFINITY;
        if (leftTime !== rightTime) return rightTime - leftTime;
        const categoryCompare = String(left?.category || '').localeCompare(String(right?.category || ''), undefined, {
            numeric: true,
            sensitivity: 'base',
        });
        if (categoryCompare !== 0) return categoryCompare;
        return String(left?.name || '').localeCompare(String(right?.name || ''), undefined, {
            numeric: true,
            sensitivity: 'base',
        });
    });
}

export function buildAssignmentEvidenceResponse(rows = []) {
    const evidence = Array.isArray(rows) ? rows : [];
    return {
        schemaVersion: ASSIGNMENT_EVIDENCE_SCHEMA_VERSION,
        basis: ASSIGNMENT_EVIDENCE_BASIS,
        catalogCount: evidence.length,
        catalogIds: evidence.map((row) => row.assignmentId),
        statusCounts: countAssignmentEvidenceStatuses(evidence),
        submissions: evidence,
    };
}

export function assignmentEvidenceRequestError(error) {
    return {
        schemaVersion: ASSIGNMENT_EVIDENCE_SCHEMA_VERSION,
        basis: ASSIGNMENT_EVIDENCE_BASIS,
        evidenceStatus: ASSIGNMENT_EVIDENCE_STATUS.REQUEST_ERROR,
        code: error?.code === 'ASSIGNMENT_EVIDENCE_REQUEST_ERROR'
            ? error.code
            : 'ASSIGNMENT_EVIDENCE_REQUEST_ERROR',
        message: error?.message || 'Failed to load assignment evidence',
    };
}

export function buildStudentAssignmentEvidenceQuery(email, courseId = null) {
    const values = [String(email || '')];
    let courseFilter = '';
    if (courseId !== null && courseId !== undefined && String(courseId).trim()) {
        values.push(String(courseId));
        courseFilter = 'AND (c.id::text = $2 OR c.gradescope_course_id::text = $2)';
    }

    return {
        text: `
            SELECT
                a.id::text AS assignment_pk,
                a.assignment_id AS external_assignment_id,
                a.title AS assignment_name,
                COALESCE(a.category, 'Uncategorized') AS category,
                a.max_points AS assignment_max_points,
                a.assignment_metadata,
                a.last_synced_at AS assignment_last_synced_at,
                c.last_synced_at AS course_last_synced_at,
                c.id::text AS course_id,
                c.gradescope_course_id,
                c.name AS course_name,
                c.semester,
                c.year,
                st.id::text AS student_id,
                st.sid AS student_sid,
                st.email AS student_email,
                st.legal_name AS student_name,
                s.id::text AS submission_pk,
                s.total_score,
                s.max_points AS submission_max_points,
                s.status AS submission_status,
                s.submission_id,
                s.submission_time,
                s.lateness,
                s.submission_count,
                eam.due_at AS exam_due_at,
                eam.release_at AS exam_release_at
            FROM students st
            JOIN courses c ON c.id = st.course_id
            JOIN assignments a ON a.course_id = c.id
            LEFT JOIN submissions s
              ON s.assignment_id = a.id
             AND s.student_id = st.id
            LEFT JOIN exam_attempt_map eam
              ON eam.assignment_id = a.id
             AND eam.course_id = c.id
            WHERE LOWER(st.email) = LOWER($1)
              ${courseFilter}
            ORDER BY c.id, COALESCE(a.category, 'Uncategorized'), a.title, a.id
        `,
        values,
    };
}

export async function queryStudentAssignmentEvidence(pool, {
    email,
    courseId = null,
    now = Date.now(),
} = {}) {
    const query = buildStudentAssignmentEvidenceQuery(email, courseId);
    let result;
    try {
        result = await pool.query(query.text, query.values);
    } catch (error) {
        const wrapped = new Error(error?.message || 'Failed to query assignment evidence');
        wrapped.code = 'ASSIGNMENT_EVIDENCE_REQUEST_ERROR';
        wrapped.status = 503;
        wrapped.cause = error;
        throw wrapped;
    }
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    const catalogRows = rows.map(toCatalogRow);
    const evidenceRows = rows
        .filter((row) => hasSubmissionRecord(row) || row.request_error || row.requestError)
        .map(toEvidenceRow);
    return joinAssignmentCatalogWithEvidence(catalogRows, evidenceRows, { now });
}

export function buildCourseAssignmentCatalogQuery(courseId = null) {
    const values = [];
    let courseFilter = '';
    if (courseId !== null && courseId !== undefined && String(courseId).trim()) {
        values.push(String(courseId));
        courseFilter = 'AND (c.id::text = $1 OR c.gradescope_course_id::text = $1)';
    }

    return {
        text: `
            SELECT
                a.id::text AS assignment_pk,
                a.assignment_id AS external_assignment_id,
                a.title AS assignment_name,
                COALESCE(a.category, 'Uncategorized') AS category,
                a.max_points AS assignment_max_points,
                a.assignment_metadata,
                a.last_synced_at AS assignment_last_synced_at,
                c.last_synced_at AS course_last_synced_at,
                c.id::text AS course_id,
                c.gradescope_course_id,
                c.name AS course_name,
                c.semester,
                c.year,
                eam.due_at AS exam_due_at,
                eam.release_at AS exam_release_at,
                ac.display_order
            FROM assignments a
            JOIN courses c ON c.id = a.course_id
            LEFT JOIN exam_attempt_map eam
              ON eam.assignment_id = a.id
             AND eam.course_id = c.id
            LEFT JOIN assignment_categories ac
              ON ac.course_id = c.id
             AND LOWER(TRIM(ac.name)) = LOWER(TRIM(COALESCE(a.category, 'Uncategorized')))
            WHERE a.title IS NOT NULL
              ${courseFilter}
            ORDER BY ac.display_order NULLS LAST, COALESCE(a.category, 'Uncategorized'), a.title, a.id
        `,
        values,
    };
}

export async function queryCourseAssignmentCatalog(pool, courseId = null) {
    const query = buildCourseAssignmentCatalogQuery(courseId);
    let result;
    try {
        result = await pool.query(query.text, query.values);
    } catch (error) {
        const wrapped = new Error(error?.message || 'Failed to query assignment catalog');
        wrapped.code = 'ASSIGNMENT_EVIDENCE_REQUEST_ERROR';
        wrapped.status = 503;
        wrapped.cause = error;
        throw wrapped;
    }
    const naturalCollator = new Intl.Collator('en', {
        numeric: true,
        sensitivity: 'base',
        ignorePunctuation: true,
    });
    return (Array.isArray(result?.rows) ? result.rows : [])
        .filter(isVisibleCatalogAssignment)
        .map((row) => {
            const dueAt = resolveAssignmentDueAt(row);
            return {
                schemaVersion: ASSIGNMENT_EVIDENCE_SCHEMA_VERSION,
                basis: 'assignment_catalog',
                assignmentId: assignmentKey(row),
                externalAssignmentId: row.external_assignment_id || null,
                category: normalizeCatalogCategory(row.category),
                rawCategory: row.category || 'Uncategorized',
                name: row.assignment_name || '',
                maxPoints: optionalNumber(row.assignment_max_points),
                dueAt,
                releaseAt: resolveAssignmentReleaseAt(row),
                dueState: getAssignmentDueState({ ...row, dueAt }),
                sourceSyncStatus: resolveSourceSyncStatus(row, false),
                courseId: row.course_id == null ? null : String(row.course_id),
                gradescopeCourseId: row.gradescope_course_id == null ? null : String(row.gradescope_course_id),
                displayOrder: optionalNumber(row.display_order),
            };
        })
        .sort((left, right) => {
            const leftOrder = left.displayOrder ?? Number.MAX_SAFE_INTEGER;
            const rightOrder = right.displayOrder ?? Number.MAX_SAFE_INTEGER;
            if (leftOrder !== rightOrder) return leftOrder - rightOrder;
            const categoryOrder = naturalCollator.compare(left.category, right.category);
            if (categoryOrder !== 0) return categoryOrder;
            const nameOrder = naturalCollator.compare(left.name, right.name);
            if (nameOrder !== 0) return nameOrder;
            return naturalCollator.compare(left.assignmentId, right.assignmentId);
        });
}

export function buildCourseAssignmentCatalogResponse(catalogRows = []) {
    const catalog = Array.isArray(catalogRows) ? catalogRows : [];
    const assignments = {};
    const metadata = {};

    catalog.forEach((assignment) => {
        const category = assignment.category || 'Uncategorized';
        const name = assignment.name || assignment.assignmentId;
        if (!assignments[category]) assignments[category] = {};
        if (!metadata[category]) metadata[category] = {};
        assignments[category][name] = assignment.maxPoints;
        metadata[category][name] = {
            assignmentId: assignment.assignmentId,
            externalAssignmentId: assignment.externalAssignmentId,
            maxPoints: assignment.maxPoints,
            dueAt: assignment.dueAt,
            releaseAt: assignment.releaseAt,
            dueState: assignment.dueState,
            sourceSyncStatus: assignment.sourceSyncStatus,
            rawCategory: assignment.rawCategory,
        };
    });

    return {
        schemaVersion: ASSIGNMENT_EVIDENCE_SCHEMA_VERSION,
        basis: 'assignment_catalog',
        catalogCount: catalog.length,
        catalog,
        assignments,
        metadata,
    };
}
