import {
    buildAssignmentEvidenceResponse,
    groupAssignmentEvidence,
    sortAssignmentEvidenceByTime,
} from '../../../../lib/assignmentEvidence.mjs';

export function buildStudentGradesRouteResponse(evidence = [], sort = null) {
    if (sort === 'time') {
        return {
            ...buildAssignmentEvidenceResponse(sortAssignmentEvidenceByTime(evidence)),
            sortBy: 'time',
        };
    }
    return groupAssignmentEvidence(evidence);
}
