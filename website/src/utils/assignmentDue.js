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

export function isAssignmentDue(assignment = {}, now = Date.now()) {
  const dueTimestamp = getDueTimestamp(assignment);
  if (dueTimestamp === null) return false;
  return dueTimestamp <= now;
}

export function filterDueAssignments(assignments = [], now = Date.now()) {
  return (Array.isArray(assignments) ? assignments : []).filter((assignment) => isAssignmentDue(assignment, now));
}
