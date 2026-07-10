import { buildCourseAssignmentCatalogResponse } from '../../../../lib/assignmentEvidence.mjs';

export function buildAdminAssignmentsRouteResponse(catalog = [], includeMetadata = false) {
    const catalogResponse = buildCourseAssignmentCatalogResponse(catalog);
    return {
        body: includeMetadata ? catalogResponse : catalogResponse.assignments,
        catalogResponse,
    };
}
