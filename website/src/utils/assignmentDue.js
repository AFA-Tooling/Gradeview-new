export function getDueTimestamp(assignment = {}) {
  const rawDue = assignment?.dueAt
    || assignment?.due_at
    || assignment?.due
    || assignment?.dueDate
    || assignment?.due_date
    || assignment?.deadline
    || assignment?.metadata?.dueAt
    || assignment?.metadata?.due_at
    || assignment?.metadata?.due;

  if (!rawDue) return null;
  const timestamp = new Date(rawDue).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getAssignmentDueState(assignment = {}, now = Date.now()) {
  const dueTimestamp = getDueTimestamp(assignment);
  if (dueTimestamp === null) return 'due_unknown';
  return dueTimestamp <= now ? 'past_due' : 'not_due';
}

export function isAssignmentDue(assignment = {}, now = Date.now()) {
  return getAssignmentDueState(assignment, now) === 'past_due';
}

export function shouldRetainAssignmentEvidence(assignment = {}) {
  if (assignment?.visible === false || assignment?.isVisible === false) return false;
  if (assignment?.metadata?.visible === false || assignment?.metadata?.hidden === true) return false;
  return true;
}

export function filterDueAssignments(assignments = [], now = Date.now()) {
  return (Array.isArray(assignments) ? assignments : []).filter((assignment) => isAssignmentDue(assignment, now));
}

export function filterRetainedAssignmentEvidence(assignments = []) {
  return (Array.isArray(assignments) ? assignments : []).filter(shouldRetainAssignmentEvidence);
}
