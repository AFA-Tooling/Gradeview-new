import {
  STUDENT_PERSONA,
  buildStudentExperiencePath,
  getStudentRouteCourseId,
  isValidStudentIdentifier,
  mergeStudentRouteQuery,
  normalizeStudentOptions,
  parseStudentExperiencePath,
  scopeProfileHrefForStaff,
} from './studentRoutes';

describe('student route contract', () => {
  test('parses student self pages without a staff identifier', () => {
    const route = parseStudentExperiencePath('/profile/exams/quest');

    expect(route.persona).toBe(STUDENT_PERSONA.SELF);
    expect(route.identifier).toBe('');
    expect(route.page).toMatchObject({ key: 'quest', kind: 'singleExam', examKey: 'quest' });
  });

  test('parses a staff deep link and preserves the stable course query', () => {
    const route = parseStudentExperiencePath('/students/avery%40example.com/labs');

    expect(route).toMatchObject({
      persona: STUDENT_PERSONA.STAFF,
      identifier: 'avery@example.com',
      identifierValid: true,
      page: { key: 'labs', kind: 'category' },
    });
    expect(getStudentRouteCourseId('?course_id=demo-cs10')).toBe('demo-cs10');
  });

  test('builds every staff page with an encoded identifier', () => {
    expect(buildStudentExperiencePath({
      persona: STUDENT_PERSONA.STAFF,
      identifier: 'avery+review@example.com',
      page: 'postterm',
      search: '?course_id=demo-cs10',
    })).toBe('/students/avery%2Breview%40example.com/exams/postterm?course_id=demo-cs10');
  });

  test.each([
    'workspace',
    'report',
    'attendance',
    'labs',
    'projects',
    'exams',
    'quest',
    'midterm',
    'postterm',
    'assignments',
    'explain',
    'concepts',
    'policy',
  ])('round-trips the %s staff subpage', (page) => {
    const path = buildStudentExperiencePath({
      persona: STUDENT_PERSONA.STAFF,
      identifier: 'avery@example.com',
      page,
      search: '?course_id=demo-cs10',
    });

    expect(parseStudentExperiencePath(path.split('?')[0]).page.key).toBe(page);
  });

  test('treats the legacy staff root as report for canonical replacement', () => {
    expect(parseStudentExperiencePath('/students/avery%40example.com').page.key).toBe('report');
  });

  test('rejects invalid identifiers instead of falling back to hidden state', () => {
    expect(isValidStudentIdentifier('not-an-email')).toBe(false);
    expect(parseStudentExperiencePath('/students/not-an-email/report').identifierValid).toBe(false);
    expect(buildStudentExperiencePath({
      persona: STUDENT_PERSONA.STAFF,
      identifier: 'not-an-email',
      page: 'report',
    })).toBe('');
  });

  test('merges course and future tab/filter query state without dropping either', () => {
    const search = mergeStudentRouteQuery('?tab=list&filter=missing', {
      course_id: 'demo-cs10',
      filter: 'late',
    });

    expect(new URLSearchParams(search).get('tab')).toBe('list');
    expect(new URLSearchParams(search).get('filter')).toBe('late');
    expect(new URLSearchParams(search).get('course_id')).toBe('demo-cs10');
  });

  test('scopes existing profile links to the active staff review URL', () => {
    const scoped = scopeProfileHrefForStaff('/profile/assignments?filter=missing', {
      pathname: '/students/avery%40example.com/report',
      search: '?course_id=demo-cs10',
    });

    expect(scoped).toBe(
      '/students/avery%40example.com/assignments?filter=missing&course_id=demo-cs10',
    );
  });

  test('normalizes searchable selector options with email and optional section', () => {
    expect(normalizeStudentOptions([
      ['Jordan Singh', 'jordan@example.com', 'Lab 102'],
      { legal_name: 'Avery Chen', email: 'avery@example.com' },
    ])).toEqual([
      { name: 'Avery Chen', email: 'avery@example.com', section: '' },
      { name: 'Jordan Singh', email: 'jordan@example.com', section: 'Lab 102' },
    ]);
  });
});
