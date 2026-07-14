import {
  SHELL_PERMISSION_STATUS,
  SHELL_PERSONA,
  SHELL_UI_CAPABILITIES_STORAGE_KEY,
  buildNavigationModel,
  buildLoginUiCapabilities,
  buildShellRenderModel,
  clearShellSession,
  createInitialPermissionState,
  deriveShellCapabilities,
  getCourseControlModel,
  parseStoredPermissions,
  persistShellLoginSession,
  permissionStateReducer,
} from './personaNavigation';

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

describe('persona navigation matrix', () => {
  it('shows only Student navigation to a student viewing their own workspace', () => {
    const capabilities = deriveShellCapabilities({ has_student: true });
    const model = buildNavigationModel(capabilities, '/profile');

    expect(model.persona).toBe(SHELL_PERSONA.STUDENT_SELF);
    expect(model.sections.map((section) => section.title)).toEqual(['STUDENT']);
    expect(model.sections[0].items.some((item) => item.name === 'Class Health')).toBe(false);
  });

  it('shows Student and Admin navigation to staff, including Demo staff', () => {
    const staff = buildNavigationModel(
      deriveShellCapabilities({ has_course_admin: true }),
      '/admin',
      { selectedStudentIdentifier: 'avery@example.com', courseId: 'demo-cs10' },
    );
    const demo = buildNavigationModel(
      deriveShellCapabilities({ has_course_admin: true, is_demo: true }),
      '/admin',
      { selectedStudentIdentifier: 'avery@example.com', courseId: 'demo-cs10' },
    );

    expect(staff.persona).toBe(SHELL_PERSONA.STAFF_CLASS);
    expect(demo.persona).toBe(SHELL_PERSONA.STAFF_CLASS);
    expect(staff.sections.map((section) => section.title)).toEqual(['STUDENT', 'ADMIN']);
    expect(staff.sections[0].items.find((item) => item.name === 'Workspace')?.href).toBe(
      '/students/avery%40example.com/workspace?course_id=demo-cs10',
    );
    expect(staff.sections[1].items.some((item) => item.name === 'Class Health')).toBe(true);
    expect(demo.sections.map((section) => section.title)).toEqual(['STUDENT', 'ADMIN']);
  });

  it('uses the current route student before persisted selection and keeps course scope', () => {
    const model = buildNavigationModel(
      deriveShellCapabilities({ has_instructor: true }),
      '/students/avery%40example.com/report',
      { selectedStudentIdentifier: 'old@example.com', courseId: 'demo-cs61c' },
    );

    expect(model.persona).toBe(SHELL_PERSONA.STAFF_STUDENT_REVIEW);
    expect(model.personaLabel).toBe('Student review');
    expect(model.reviewContext.identifier).toBe('avery@example.com');
    expect(model.sections.map((section) => section.title)).toEqual(['STUDENT', 'ADMIN']);
    expect(model.sections[0].items.map((item) => item.href)).toEqual(
      expect.arrayContaining([
        '/students/avery%40example.com/report?course_id=demo-cs61c',
        '/students/avery%40example.com/labs?course_id=demo-cs61c',
      ]),
    );
    expect(model.sections[0].items.some((item) => item.href.includes('old%40example.com'))).toBe(false);
  });

  it('provides an explained Class Health fallback instead of staff self-profile links', () => {
    const model = buildNavigationModel(
      deriveShellCapabilities({ has_instructor: true }),
      '/admin',
    );

    expect(model.sections.map((section) => section.title)).toEqual(['STUDENT', 'ADMIN']);
    expect(model.sections[0].description).toMatch(/select a student/i);
    expect(model.sections[0].items).toEqual([
      expect.objectContaining({ name: 'Select student', href: '/admin?tab=students' }),
    ]);
    expect(model.sections[0].items.some((item) => item.href.startsWith('/profile'))).toBe(false);
  });
});

describe('permission resolution without persona flicker', () => {
  it('creates a persistent UI capability only from an explicit Demo login response', () => {
    expect(buildLoginUiCapabilities({ demo: true })).toEqual({
      demo: true,
      read_only: true,
      source: 'demo-login',
    });
    expect(buildLoginUiCapabilities({ status: true })).toBeNull();
  });

  it('never assumes Student while a token with unknown capabilities is resolving', () => {
    const initial = createInitialPermissionState({ token: 'Bearer unresolved' });
    const navigation = buildNavigationModel(initial.capabilities, '/admin');

    expect(initial.status).toBe(SHELL_PERMISSION_STATUS.RESOLVING);
    expect(navigation.persona).toBe(SHELL_PERSONA.RESOLVING);
    expect(navigation.sections).toEqual([]);
  });

  it('keeps a trusted Demo capability when a refresh omits the Demo claim', () => {
    const initial = createInitialPermissionState({
      token: 'Bearer demo',
      storedPermissions: { has_course_admin: true },
      storedUiCapabilities: { demo: true, read_only: true },
    });
    const refreshed = permissionStateReducer(initial, {
      type: 'permissions-resolved',
      permissions: { has_course_admin: true },
    });

    expect(refreshed.status).toBe(SHELL_PERMISSION_STATUS.READY);
    expect(refreshed.capabilities).toMatchObject({ isStaff: true, isDemo: true, isReadOnly: true });
  });

  it('clears a stale Demo capability when an ordinary login succeeds', () => {
    const storage = createMemoryStorage({
      [SHELL_UI_CAPABILITIES_STORAGE_KEY]: JSON.stringify({ demo: true, read_only: true }),
      selectedCourseId: 'old-course',
      selectedStudentEmail: 'old-student@example.com',
    });

    persistShellLoginSession(storage, {
      loginData: {
        status: true,
        token: 'Bearer staff',
        permissions: { has_course_admin: true },
      },
      identity: { email: 'staff@example.com', name: 'Course Staff' },
    });

    expect(storage.getItem(SHELL_UI_CAPABILITIES_STORAGE_KEY)).toBeNull();
    expect(storage.getItem('selectedCourseId')).toBeNull();
    expect(storage.getItem('selectedStudentEmail')).toBeNull();
    expect(storage.getItem('email')).toBe('staff@example.com');
    expect(parseStoredPermissions(storage.getItem('permissions'))).toEqual({ has_course_admin: true });
  });

  it('persists explicit Demo login capability across initial permission resolution', () => {
    const storage = createMemoryStorage();
    persistShellLoginSession(storage, {
      loginData: {
        status: true,
        demo: true,
        token: 'Bearer demo',
        permissions: { has_course_admin: true },
      },
      identity: { email: 'demo@example.com', name: 'GradeView Demo' },
      selectedCourseId: 'demo-course',
    });

    const initial = createInitialPermissionState({
      token: storage.getItem('token'),
      storedPermissions: parseStoredPermissions(storage.getItem('permissions')),
      storedUiCapabilities: parseStoredPermissions(
        storage.getItem(SHELL_UI_CAPABILITIES_STORAGE_KEY),
      ),
    });

    expect(initial.status).toBe(SHELL_PERMISSION_STATUS.READY);
    expect(initial.capabilities).toMatchObject({ isStaff: true, isDemo: true, isReadOnly: true });
    expect(storage.getItem('selectedCourseId')).toBe('demo-course');
  });

  it('removes identity, capability, course, and student state on logout', () => {
    const storage = createMemoryStorage({
      token: 'Bearer demo',
      permissions: '{}',
      [SHELL_UI_CAPABILITIES_STORAGE_KEY]: '{}',
      email: 'demo@example.com',
      name: 'GradeView Demo',
      profilepicture: 'avatar.png',
      selectedCourseId: 'demo-course',
      selectedStudentEmail: 'student@example.com',
    });

    clearShellSession(storage);

    expect([
      'token',
      'permissions',
      SHELL_UI_CAPABILITIES_STORAGE_KEY,
      'email',
      'name',
      'profilepicture',
      'selectedCourseId',
      'selectedStudentEmail',
    ].map((key) => storage.getItem(key))).toEqual(Array(8).fill(null));
  });
});

describe('course and shell controls', () => {
  const longName = 'Introduction to Data Structures and Responsible Computing — Extended Studio Section';

  it('uses a static full course label for one course', () => {
    const model = getCourseControlModel([
      { id: '1', year: 2026, semester: 'Fall', name: longName },
    ], '1');

    expect(model.kind).toBe('static');
    expect(model.label).toContain(longName);
    expect(model.accessibleName).toBe(`Current course: 2026 Fall ${longName}`);
  });

  it('uses an accessible selector only when multiple courses exist', () => {
    const model = getCourseControlModel([
      { id: '1', name: 'Course One' },
      { id: '2', name: 'Course Two' },
    ], '2');

    expect(model.kind).toBe('select');
    expect(model.value).toBe('2');
    expect(model.accessibleName).toBe('Current course');
  });

  it('shows Demo status only for an explicit Demo capability', () => {
    const demoState = createInitialPermissionState({
      token: 'Bearer demo',
      storedPermissions: { has_course_admin: true },
      storedUiCapabilities: { demo: true, read_only: true },
    });
    const staffState = createInitialPermissionState({
      token: 'Bearer staff',
      storedPermissions: { has_course_admin: true },
    });

    expect(buildShellRenderModel({ loggedIn: true, permissionState: demoState }).showDemoBanner).toBe(true);
    expect(buildShellRenderModel({ loggedIn: true, permissionState: staffState }).showDemoBanner).toBe(false);
  });

  it('never renders a sidebar or navigation model while signed out', () => {
    const guestState = createInitialPermissionState();
    const model = buildShellRenderModel({ loggedIn: false, permissionState: guestState });

    expect(model.showSidebar).toBe(false);
    expect(model.navigation.persona).toBe(SHELL_PERSONA.GUEST);
    expect(model.navigation.sections).toEqual([]);
  });
});
