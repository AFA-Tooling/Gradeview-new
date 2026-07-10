import {
  filterDueAssignments,
  filterRetainedAssignmentEvidence,
  getAssignmentDueState,
  isAssignmentDue,
  shouldRetainAssignmentEvidence,
} from './assignmentDue';

const NOW = Date.parse('2026-07-09T12:00:00.000Z');

describe('assignment timing and evidence retention', () => {
  test.each([
    ['past due', { dueAt: '2026-07-01T00:00:00.000Z' }, 'past_due'],
    ['future due', { dueAt: '2026-07-20T00:00:00.000Z' }, 'not_due'],
    ['missing due', {}, 'due_unknown'],
    ['invalid due', { dueAt: 'not-a-date' }, 'due_unknown'],
    ['metadata due', { metadata: { due_at: '2026-07-01T00:00:00.000Z' } }, 'past_due'],
  ])('%s has an explicit due state', (_label, assignment, expected) => {
    expect(getAssignmentDueState(assignment, NOW)).toBe(expected);
    expect(isAssignmentDue(assignment, NOW)).toBe(expected === 'past_due');
  });

  test('strict due filtering and catalog evidence retention are separate operations', () => {
    const rows = [
      { id: 'past', dueAt: '2026-07-01T00:00:00.000Z' },
      { id: 'future', dueAt: '2026-07-20T00:00:00.000Z' },
      { id: 'unknown' },
      { id: 'hidden', dueAt: '2026-07-01T00:00:00.000Z', visible: false },
    ];
    expect(filterDueAssignments(rows, NOW).map((row) => row.id)).toEqual(['past', 'hidden']);
    expect(filterRetainedAssignmentEvidence(rows).map((row) => row.id)).toEqual([
      'past', 'future', 'unknown',
    ]);
  });

  test.each([
    [{ visible: false }, false],
    [{ isVisible: false }, false],
    [{ metadata: { visible: false } }, false],
    [{ metadata: { hidden: true } }, false],
    [{ dueAt: '2027-01-01T00:00:00.000Z' }, true],
    [{}, true],
  ])('visibility metadata controls retention for %j', (assignment, expected) => {
    expect(shouldRetainAssignmentEvidence(assignment)).toBe(expected);
  });
});
