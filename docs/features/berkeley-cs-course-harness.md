# Berkeley CS Course Harness Design

> **Status: background design note.** The authoritative Gradescope-only MVP
> product and integration contract is
> [Course Configuration Control Plane Specification](./course-configuration-control-plane.md).
> Where this document conflicts with that specification, the newer specification
> wins. In particular, the MVP now produces approved assignment actions for an
> external Gradescope Handler instead of stopping at a setup checklist.

## Scope

This note treats "all Berkeley CS courses" as a future addressable universe, but the first production harness should be much narrower:

- Instructors/admins manually enter syllabus/policy details.
- Instructors/admins manually provide the data source configuration.
- MVP supports Gradescope only.
- PrairieLearn, iClicker, bCourses, GitHub Classroom, and automatic syllabus crawling stay as later extensions.

The public syllabus crawl below is useful background for understanding policy variety, but it should not be part of the MVP runtime flow.

## Crawl Findings

Primary sources checked:

- Official CS catalog: https://www2.eecs.berkeley.edu/Courses/CS/
- 2026-2027 draft schedule: https://www2.eecs.berkeley.edu/Scheduling/CS/schedule-draft.html
- Public course resource index: https://github.com/surajrampure/berkeley-cs-courses
- Representative current or recent syllabus and policy pages listed below.

Public syllabus/policy pages found for the common high-enrollment courses:

| Course | Public policy source | Platform signals | Grading shape |
| --- | --- | --- | --- |
| CS 10 | https://cs10.org/sp26/syllabus/ | GradeView, Gradescope, PrairieLearn, iClicker, Ed | Fixed 400 points, explicit bins, lab attendance, exam clobber |
| CS 61A | https://cs61a.org/articles/about-61a/ | Ok, Ed, Gradescope link, extensions, attendance | Fixed 300 points, explicit bins, no curve, exam recovery |
| CS 61B | https://sp26.datastructur.es/policies/ | Gradescope, Beacon, Ed, OH queue, sections | Fixed 3000 points, two tracks, explicit bins, clobber/recovery |
| CS 61C | https://cs61c.org/su26/policies/ | Gradescope, PrairieLearn, Ed, Flextensions | Fixed 300 points, explicit bins, no shifting |
| CS 70 | https://www.eecs70.org/policies/ | Gradescope, Ed, OH queue, attendance form | Percent weights, homework drops, partial exam clobber |
| CS 152 | https://inst.eecs.berkeley.edu/~cs152/sp26/152_policies/ | Gradescope, PrairieLearn, Ed, GitHub | Labs, problem sets, exams, fail rule if labs incomplete |
| CS 161 | https://sp26.cs161.org/policies/ | Gradescope, Ed, autograder, OH queue | Percent weights, tentative bins, project completion gate |
| CS 162 | https://cs162.org/policies/ | GitHub autograder, Ed, group projects | Percent weights, curved, group projects, slip days |
| CS 164 | https://schasins.com/berkeley-cs164-fall-2025/syllabus.html | Gradescope, Ed, autograder, GitHub | Compiler/project-heavy, term-specific |
| CS 168 | https://sp26.cs168.io/policies/ | Ed, autograder, project site | Percent weights, projects-heavy, department curve |
| CS 170 | https://cs170.org/policies/ | Gradescope, Ed | Written homework, oral tests, drops |
| CS 184 | https://cs184.eecs.berkeley.edu/sp26/policies/ | Gradescope auditor code, Ed, forms | 100 points, explicit bins, pair assignments, team project |
| CS 185/285 | https://rail.eecs.berkeley.edu/deeprlcourse/syllabus/ | Gradescope, Ed, GitHub, bCourses | Homework/project/exam mix, grad variant |
| CS 186 | https://cs186berkeley.net/syllabus/ | Gradescope, Ed, GitHub Classroom, OH queue | Vitamins, projects, exams, slip minutes, curved |
| CS 188 | https://inst.eecs.berkeley.edu/~cs188/sp26/policies/ | Gradescope, Ed, Flextensions, autograder | Percent weights, explicit bins, project/homework drops |
| CS 189/289A | https://eecs189.org/sp26/syllabus/ | Gradescope, Ed, autograder | Separate undergrad/grad weights, homework drop |
| CS 195/H195 | https://cs195.org/fa24/syllabus/ | Ed, attendance/readings | Discussion/seminar completion model |
| CS 252A | https://inst.eecs.berkeley.edu/~cs152/sp26/252_policies/ | Ed, project, readings | Graduate paper/project/exam model |
| CS 268 | https://people.eecs.berkeley.edu/~randy/Courses/CS268.F08/syllabus.html | Project, quizzes, participation | Older public syllabus, graduate seminar style |

The active 2026-2027 schedule also includes courses such as CS 171, 172, C176, 180, C182, C249A, 260A, 260B, 261, 262A, 264, 265, 270, 271, C281A/B, 282A, 284B, 286, 287, 288, 302, 365, 375, and many 194/294 topics. For MVP, those courses are supported only when an instructor/admin manually supplies Gradescope and policy details.

## Integration Implications

The current system already has the right landing tables for configured courses:

- `courses`
- `course_configs`
- `assignment_categories`
- `course_policies`
- `course_permissions`

GradeSync already has a working Gradescope path. The missing MVP layer is a course onboarding harness that turns instructor-entered setup into safe DB configuration, then validates it against a Gradescope dry run.

Current friction:

- `course_policies` is active-only per course and lacks clear edit provenance/version history.
- `assignment_categories.patterns` are currently substring-style rules; manual setup needs a preview that shows which Gradescope assignments match each category.
- `courses.gradescope_course_id` is currently the course identity. That is acceptable for the Gradescope-only MVP.
- Multi-platform identity can wait until the product actually supports more sources.

## Proposed Harness

Build a `CourseHarness` service as a pre-sync onboarding and validation layer:

```text
Instructor/admin form
        |
        v
CourseBlueprint draft
        |
        v
Gradescope probe -> visible course + assignments
        |
        v
Validation harness -> assignment classification + policy checks
        |
        v
Review UI/API -> approved write into existing config tables
        |
        v
GradeSyncService
```

### 1. Manual Setup

The instructor/admin enters:

- Course metadata: department, course number, title, term, year, instructor.
- Gradescope course id.
- Optional syllabus URL/file for human reference only.
- Assignment categories and matching patterns.
- Grading policy: point/percent mode, total cap, components, bins, rounding, drops, clobber/recovery, late policy notes.
- Admin/instructor permissions.

Output:

```json
{
  "status": "draft",
  "course": {
    "name": "CS 61B Spring 2026",
    "department": "COMPSCI",
    "course_number": "61B",
    "semester": "Spring",
    "year": 2026,
    "instructor": "Joshua Hug"
  },
  "gradescope": {
    "enabled": true,
    "course_id": "123456"
  },
  "syllabus_url": "https://sp26.datastructur.es/policies/"
}
```

### 2. Syllabus Reference

For MVP, syllabus is a reference field, not an extraction source. Store it so admins can audit where a manually entered policy came from.

Suggested lightweight addition:

```sql
ALTER TABLE course_policies
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS source_notes TEXT,
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
```

If we want a cleaner review workflow, add blueprints without introducing crawler artifacts:

```sql
CREATE TABLE course_blueprints (
  id SERIAL PRIMARY KEY,
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  gradescope_course_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  blueprint JSONB NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  approved_at TIMESTAMPTZ,
  approved_by INTEGER REFERENCES users(id)
);
```

### 3. Policy Entry

Do not infer policy from syllabus in MVP. The form should capture:

- `grading_mode`: `points`, `percent`, `curved`, `p_np`, `completion`, `unknown`
- `total_points_cap`
- component weights/caps
- grade bins
- drops/clobber/recovery rules as structured JSON where possible
- late/slip/extension notes as text in MVP
- attendance/participation notes if relevant

The output should be a `CourseBlueprint` that maps cleanly to existing config:

```json
{
  "course": {
    "name": "CS 61C Summer 2026",
    "department": "COMPSCI",
    "course_number": "61C",
    "semester": "Summer",
    "year": 2026,
    "instructor": "Justin Yokota"
  },
  "gradescope": {
    "enabled": true,
    "course_id": "123456",
    "sync_interval_hours": 24
  },
  "assignment_categories": [
    { "name": "Labs", "patterns": ["\\blab\\s*\\d+", "\\blabs?\\b"] },
    { "name": "Homework", "patterns": ["\\bhomework\\s*\\d+", "\\bhw\\s*\\d+"] },
    { "name": "Projects", "patterns": ["\\bproject\\s*\\d+"] },
    { "name": "Quest", "patterns": ["\\bquest\\b"] },
    { "name": "Midterm", "patterns": ["\\bmidterm\\b"] },
    { "name": "Final", "patterns": ["\\bfinal\\b"] }
  ],
  "policy": {
    "policy_version": "manual:2026-07-01",
    "total_points_cap": 300,
    "components": [
      { "key": "labs", "label": "Labs", "type": "labs", "cap": 24, "summary_source": "Labs" },
      { "key": "homework", "label": "Homework", "type": "homework", "cap": 36, "summary_source": "Homework" },
      { "key": "projects", "label": "Projects", "type": "projects", "cap": 90, "summary_source": "Projects" },
      { "key": "quest", "label": "Quest", "type": "exam", "cap": 25, "exam_type": "quest" },
      { "key": "midterm", "label": "Midterm", "type": "exam", "cap": 50, "exam_type": "midterm" },
      { "key": "final", "label": "Final", "type": "exam", "cap": 75, "exam_type": "final" }
    ],
    "rules": {
      "grading_mode": "points",
      "bins_shift": "none",
      "rounding": "none",
      "late_policy": { "summary": "Instructor-entered policy notes" }
    }
  }
}
```

### 4. Gradescope Probing

The harness should verify the instructor-entered Gradescope id with staff credentials:

- Can authenticate to Gradescope.
- Course id is visible to the configured account.
- Course name/term roughly matches the instructor-entered metadata.
- Assignment list can be fetched.
- Optional roster sample can be fetched.

Binding states:

- `draft`: entered but not checked.
- `verified`: dry run fetched course and assignments.
- `enabled`: approved and written to `course_configs`.
- `failed`: probe could not verify the course id.

### 5. Gradescope Setup Pack

Gradescope setup can be partly scripted, but the official public workflow still expects instructors to create courses and assignments through the web UI. Gradescope does support roster import/update by CSV, and our existing client can log in, read assignments, and download grade CSVs. Treat setup automation as a progressive ladder:

1. `setup_manifest.csv`: teacher/admin fills one CSV with course metadata, policy components, grade bins, categories, staff, roster rows, and expected assignments.
2. GradeView imports the manifest and creates a draft blueprint.
3. GradeView emits:
   - a normalized GradeView config preview;
   - an official Gradescope roster CSV for the instructor to upload;
   - an assignment setup checklist for Gradescope;
   - a post-setup validation report after the instructor creates assignments in Gradescope.
4. Optional later: use Playwright/Selenium browser automation to click through Gradescope assignment creation from the same manifest. This should be opt-in because it depends on UI stability, login/SSO/2FA state, and Gradescope terms.
5. Avoid relying on private/unofficial Gradescope mutation endpoints for core product behavior.

Suggested manifest template: [gradescope-setup-manifest-template.csv](../templates/gradescope-setup-manifest-template.csv).

The manifest parser can split rows by `record_type`:

- `course`: writes course metadata and Gradescope course id.
- `staff`: prepares instructor/TA access instructions.
- `roster`: generates a Gradescope roster CSV.
- `category`: writes `assignment_categories`.
- `component`: writes `course_policies.components`.
- `bin`: writes `course_policies.grade_bins`.
- `assignment`: creates expected assignment records for validation and a Gradescope setup checklist.

For MVP, the system does not need to create Gradescope assignments. It only needs to say: "these are the assignments the teacher declared; these are the assignments currently visible in Gradescope; here is what matches/misses."

### 6. Sheet-Backed Policy Source

The better long-term editing surface is likely Google Sheets, not another in-app gradebook UI. GradeView should treat Sheets as an upstream policy editor, then publish a validated snapshot into Postgres.

```text
Google Sheet template
        |
        v
Sheet importer/parser
        |
        v
CourseBlueprint draft
        |
        v
Validate against visible Gradescope assignments
        |
        v
Diff + warnings in GradeView
        |
        v
Publish snapshot into course_policies + assignment_categories
        |
        v
Reclassify existing assignments + refresh summaries
```

Important rule: runtime should not read Google Sheets directly. Student pages, sync jobs, distribution queries, and policy rollups should read only the last published DB snapshot. This keeps the product stable when a sheet is private, temporarily broken, mid-edit, or rate-limited.

Recommended sheet tabs:

| Tab | Purpose | Example columns |
| --- | --- | --- |
| `Course` | course metadata and Gradescope id | `key`, `value` |
| `Categories` | assignment categorization rules | `category_key`, `label`, `display_order`, `match_type`, `pattern`, `priority`, `exclude`, `component_key` |
| `Components` | score components/summary cards | `component_key`, `label`, `type`, `cap`, `weight`, `summary_source`, `exam_type` |
| `GradeBins` | letter-grade bins | `grade`, `min`, `max`, `inclusive_min`, `inclusive_max` |
| `Rules` | policy options | `scope`, `key`, `value_json`, `notes` |
| `ExpectedAssignments` | optional setup/validation list | `key`, `title`, `category_key`, `max_points`, `due_at`, `assignment_type` |
| `Overrides` | precise fixes for edge cases | `gradescope_assignment_id`, `title_pattern`, `category_key`, `component_key`, `max_points_override`, `ignore` |

This keeps the web UI small:

- connect/select sheet;
- show last imported version/hash;
- show validation errors and warnings;
- preview category assignment matches;
- publish, rollback, or disable sheet sync.

Avoid building spreadsheet editing in GradeView. If the teacher needs to edit rows, send them to the sheet. GradeView should be the compiler, validator, and release manager.

Suggested DB additions:

```sql
CREATE TABLE course_policy_sources (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL DEFAULT 'google_sheet',
  source_url TEXT,
  sheet_id TEXT,
  sync_mode TEXT NOT NULL DEFAULT 'manual_publish',
  last_import_hash TEXT,
  last_imported_at TIMESTAMPTZ,
  last_published_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft',
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE course_policy_revisions (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  source_id INTEGER REFERENCES course_policy_sources(id) ON DELETE SET NULL,
  revision_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  blueprint JSONB NOT NULL,
  validation_report JSONB,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  published_at TIMESTAMPTZ,
  published_by INTEGER REFERENCES users(id)
);
```

Category matching should also become more explicit than today's substring fallback:

```json
{
  "category_key": "projects",
  "label": "Projects",
  "rules": [
    { "match_type": "regex", "pattern": "\\bproject\\s*\\d+\\b", "priority": 100 },
    { "match_type": "contains", "pattern": "final project", "priority": 90 }
  ],
  "exclude": [
    { "match_type": "contains", "pattern": "practice" }
  ]
}
```

When a new policy snapshot is published, run the existing reclassification flow: update assignment categories from the new rules, then refresh summary rows and derived rollups. Policy changes should be visible as revisions, not silent mutations.

### 7. Validation

Before activation, run a dry-run validation:

- Fetch assignment list from Gradescope.
- Categorize every assignment using proposed `assignment_categories`.
- Compare Gradescope assignment totals to instructor-entered `course_policies`.
- Flag orphan assignments, duplicate categories, policy total mismatch, missing exams, and suspicious zero caps.
- Produce a review report for course admins.

Useful thresholds:

- Allow apply without warnings only when total component caps/weights match exactly and at least 90% of current assignments classify.
- Require review when grading is curved, percent-based with hidden bins, team/contribution-based, or category classification coverage is low.
- Never overwrite an active policy without showing a diff.

### 8. Persistence

Short-term, keep compatibility:

- Require a Gradescope course id for MVP course activation.
- Continue using `courses.gradescope_course_id` as the course identity.
- Write `gradescope_enabled = true` and the verified id into `course_configs`.
- Continue writing instructor-entered policy into `course_policies`.
- Continue writing categories into `assignment_categories`.

Medium-term schema cleanup, only when adding non-Gradescope sources:

```sql
CREATE TABLE course_sources (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  external_course_id TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  binding_status TEXT NOT NULL DEFAULT 'detected',
  confidence NUMERIC,
  evidence JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (course_id, source_type, external_course_id)
);
```

Long-term, make `courses` independent from Gradescope:

- Add `canonical_key`.
- Allow `gradescope_course_id` to be nullable or move it entirely to `course_sources`.
- Keep a compatibility view for existing GradeSync code until the sync layer reads `course_sources`.

### 9. API Surface

Proposed endpoints:

```text
POST /v2/admin/course-harness/blueprints
GET  /v2/admin/course-harness/blueprints
GET  /v2/admin/course-harness/blueprints/:id
POST /v2/admin/course-harness/blueprints/import-sheet
POST /v2/admin/course-harness/blueprints/:id/probe-gradescope
POST /v2/admin/course-harness/blueprints/:id/validate
GET  /v2/admin/course-harness/blueprints/:id/setup-pack
GET  /v2/admin/course-harness/blueprints/:id/diff
POST /v2/admin/course-harness/blueprints/:id/apply
POST /v2/admin/course-harness/blueprints/:id/rollback
```

Only course admins or system admins should be allowed to apply blueprints. Draft creation can be available to instructors, but applying should require manage permission.

### 10. Course Type Hints

These are form/template hints for instructors, not automatic extraction behavior:

- Fixed-point large courses: CS 10, 61A, 61B, 61C. Offer point-cap and bin templates that instructors can edit.
- Percent-weight project/exam courses: 70, 161, 162, 168, 170, 184, 186, 188, 189. Make weight entry easy and warn that hidden curves make final letter projection uncertain.
- Courses that use several platforms in reality: 10, 61C, 152. MVP should still sync only Gradescope; PrairieLearn/iClicker rows remain disabled until later support exists.
- Group/project courses: 162, 184, 185/285, 260A, 294 topics. Sync raw Gradescope grades, but treat contribution adjustments and final team project grading as instructor-owned policy notes.
- Seminar/completion courses: 195, H195, 302, 365, 375. Allow completion/P-NP style setup, but do not force a point projection when the instructor does not provide one.
- Special topics: 194/294. Require explicit title/term/instructor entry; never rely on course number alone because the suffix is the real offering.

## Rollout

1. Add a manual blueprint form in the admin settings area.
2. Add `course_blueprints` or reuse a draft JSON payload if we want the smallest possible DB change.
3. Add a Gradescope probe/dry-run button that fetches course metadata and assignments.
4. Add assignment category preview: matched, unmatched, duplicate/ambiguous.
5. Add policy/category/config diff preview.
6. Apply approved blueprints into existing `courses`, `course_configs`, `assignment_categories`, and `course_policies`.
7. Add Google Sheets import as an alternate blueprint source.
8. Add policy revisions, rollback, and reclassification on publish.

The most important design choice for MVP: teacher input is the source of truth; the harness is the guardrail that verifies Gradescope access, catches category/policy mistakes, and writes the existing config tables consistently.
