# GradeView Student Experience V2 Plan

This plan defines the product logic for the next version of the student-facing GradeView experience. It intentionally avoids visual styling decisions and focuses on page structure, information hierarchy, and interaction flows.

## Core Positioning

GradeView should support two student-centered modes that use the same underlying data but serve different jobs.

| Mode | Primary user | Job |
| --- | --- | --- |
| Student Workspace | Student | Understand current standing, identify the most important category, and decide what to do next. |
| Student Report | Instructor, TA, support OH staff | Review a complete one-page student status report for diagnosis, meetings, and intervention. |

The current heavy `StudentProfileContent` should not be discarded. It should be repositioned as the one-page `Student Report`. The student's default experience should become a lighter workspace that routes into focused category pages.

## Route Structure

```txt
/profile
  Student Workspace home

/profile/report
  Student Report one-page view

/profile/attendance
/profile/labs
/profile/projects
/profile/exams
/profile/exams/quest
/profile/exams/midterm
/profile/exams/postterm
/profile/assignments
/profile/explain
/profile/concepts
/profile/policy
```

When a student signs in, the default destination should be:

```txt
/profile
```

When staff opens a student from Admin, Alerts, or Students, the default destination should be:

```txt
/students/:email/report
```

## Student Workspace Home

The workspace home should answer three questions only:

1. What is my current standing?
2. Which grading area most affects me right now?
3. What should I do next?

### Content

- Final standing: total points, total cap, and current letter grade.
- Next grade gap: points needed for the next grade bin.
- Six category summary cards:
  - Attendance / Participation
  - Labs
  - Projects
  - Quest
  - Midterm
  - Postterm
- Top actions: up to three highest-signal recommended actions.
- Recent signals: missing, late, zero, clobber change, or sync issue.

### Interactions

- Click total score: open `/profile/explain`.
- Click category card: open the category page.
- Click action: deep-link to the relevant assignment, category, or exam topic.
- Do not show the full assignment table, full Grade Flow, full concept map, or all exam charts on this page.

## Category Pages

Each grading category should use the same information template:

```txt
Summary
Evidence
Policy Applied
Impact
Action
```

### Attendance Page

Purpose: explain how participation credit was earned.

Content:

- Final attendance score and cap.
- Sessions attended vs total.
- Open or missing sessions.
- Lecture, discussion, and lab attendance groups.
- Make-up submissions.
- Dropped or forgiven absences where applicable.

Interactions:

- Filter by `Lecture`, `Discussion`, `Lab`, `Missing`, and `Make-up`.
- Click a session to view raw attendance evidence.
- Click `Explain attendance score` to show the attendance policy calculation.

### Labs Page

Purpose: explain completion, drops, and scaling.

Content:

- Final labs score and cap.
- Submitted count.
- Raw score and raw max.
- Dropped labs.
- Code and conceptual portion status.
- Recent missing or zero lab items.

Interactions:

- Tabs: `Overview`, `Lab List`, `Policy`.
- Filters: `All`, `Missing`, `Dropped`, `Kept`.
- Click a lab row to open the assignment drawer.
- Policy flow:

```txt
Raw lab points -> completion check -> drop lowest -> scale to cap -> final
```

### Projects Page

Purpose: explain the highest-weight coursework area.

Content:

- Final projects score and cap.
- Project timeline.
- Each project score.
- Missing or resubmission items.
- Late or extension status.
- Final project status.

Interactions:

- Expand each project for score evidence.
- Filters: `Submitted`, `Missing`, `Resubmission`, `Late`.
- Click a project to view artifact status, score breakdown, and policy state.
- Workspace actions related to projects should deep-link here.

## Exams And Clobber

Exam policy should not rely on a single table or a single radar chart. It should use three coordinated views:

```txt
Topic Mastery Radar
Clobber Ladder
Question Best Matrix
```

### Exams Overview Page

Purpose: explain Quest, Midterm, and Postterm policy outcomes together.

Content:

- Quest final score.
- Midterm final score.
- Postterm final score.
- Raw exam total.
- Total after question-best or retake-best logic.
- Total after clobber.
- Net clobber gain.
- Which exams were affected by later exams.

Interactions:

- Toggle: `Raw`, `Question Best`, `After Clobber`.
- Click Quest, Midterm, or Postterm to open the single-exam page.
- Click a clobber badge to open the clobber explanation drawer.

### Single Exam Page

Purpose: explain one exam's final score.

Example layout logic:

```txt
Header: Midterm 50 / 50

Left:
Topic Mastery Radar

Right:
Clobber Ladder

Bottom:
Question Best Matrix
```

The radar chart should explain topic mastery and growth over attempts. It should not be the only clobber explanation.

The clobber ladder should explain score transformation:

```txt
Midterm raw          41 / 50
Question best        46 / 50
Clobbered by Post    50 / 50
Net gain             +9
```

The question best matrix should explain which attempt or topic score was selected:

```txt
Topic        Attempt 1   Attempt 2   Attempt 3   Best Used
Functions   70%         90%         85%         90%
Booleans    60%         100%        100%        100%
```

View responsibilities:

- Radar: shows mastery shape and growth.
- Ladder: shows which score replaced which score.
- Matrix: shows why a specific topic/question score was used.

## Assignments Page

Purpose: hold the full raw assignment ledger that currently makes the profile page heavy.

Content:

- Assignment name.
- Category.
- Score and max.
- Submitted time.
- Lateness.
- Policy status.
- Whether the score was used in the final policy total.

Interactions:

- Search.
- Sort.
- Filter chips: `Category`, `Missing`, `Late`, `Zero`, `Dropped`, `Clobbered`.
- Group by: `Category`, `Time`, `Policy Status`.
- Click a row to open the assignment drawer.

## Explain Score

`/profile/explain` and the explain drawer should use the same core logic.

Default flow:

```txt
Raw scores
-> policy transformations
-> category final
-> course total
-> rounding
-> grade bin
```

Node types:

- raw
- best
- drop
- filter
- scale
- cap
- clobber
- final output

Interactions:

- Click a node to show input, rule, and output.
- When opened from a specific score, focus the relevant node immediately.
- Student-facing labels should use natural language.
- Staff can optionally view technical policy labels.

## Assignment Drawer

All assignment clicks should open the same drawer.

Content:

- Assignment name.
- Category.
- Score and max.
- Submission time.
- Lateness.
- Policy status.
- Whether it contributed to the final score.
- Related concept or exam topic.
- Suggested action where relevant.

Policy statuses:

```txt
used
dropped
missing
late
clobbered
scaled source
raw only
```

## Concepts Page

Purpose: connect grade outcomes to learning diagnosis.

Content:

- Concept map.
- Student mastery level.
- Taught vs not taught status.
- Related exams.
- Related assignments.

Interactions:

- Click a concept to view related topics, exam questions, assignments, and review suggestions.
- Exam topic pages should be able to deep-link into the relevant concept.

## Policy Page

Purpose: separate course policy from personal analytics.

Content:

- Grading breakdown.
- Grade bins.
- Rounding policy.
- Exam clobber policy.
- Lab, project, and attendance policy.

Interactions:

- Click a policy item to view examples.
- Optional grade calculator.
- Do not mix personal assignment analysis into this page.

## Student Report

The one-page report should preserve the value of the current heavy profile for staff review.

### Report Order

1. Student header
   - Name
   - Email
   - Course
   - Last sync

2. Final Policy Snapshot
   - Total score
   - Letter grade
   - Next grade gap
   - Quest, Midterm, and Postterm chips

3. Category Summary
   - Six component cards
   - Score and cap
   - Raw evidence
   - Missing, late, or clobber signals

4. Exam Policy Report
   - Topic radar
   - Clobber ladder
   - Question-best summary
   - Clobber gain

5. Trend and Recent Signals
   - Score trend
   - Recent zeros
   - Missing work
   - Late submissions
   - Changes since last sync

6. Assignment Ledger
   - Full raw assignment table
   - Search, filter, and sort

7. Explainability Summary
   - Drops
   - Scale
   - Cap
   - Clobber
   - Rounding
   - Deep link to Grade Flow

8. Concept Diagnosis
   - Weak topics summary
   - Deep link to full Concept Map

### Report Interactions

- Page anchor navigation.
- Category click: jump to the report section.
- Score click: open explain drawer.
- Assignment click: open assignment drawer.
- Export: print, PDF, or copy summary.
- Staff actions: reviewed, notes, draft check-in.

## Admin And Staff Entry

Staff should enter the one-page report, not the student's workspace.

Flow:

```txt
Class Health
-> Alert or Student row
-> Student Report
-> Evidence
-> Action
```

Staff actions:

- Open student report.
- Draft check-in.
- Mark reviewed.
- Export student report.
- Copy summary.

## Shared Modules

The current profile should be split into reusable modules:

```txt
FinalPolicySnapshot
CategorySummary
CategoryCard
CategoryDetailPage
ExamPolicyReport
TopicMasteryRadar
ClobberLadder
QuestionBestMatrix
AssignmentLedger
AssignmentDrawer
ExplainScoreDrawer
ScoreTrend
ConceptDiagnosis
PolicyReference
StudentReportContent
StudentWorkspaceHome
```

Student Workspace and Student Report should reuse these modules with different composition.

## Implementation Priority

### Phase 1

- Reposition the current heavy `Performance Analytics` page as `Student Report`.
- Add a lighter `/profile` workspace home.
- Make category cards the main workspace navigation.

### Phase 2

- Add Attendance, Labs, and Projects category pages.
- Move `Detailed Assignment Scores` into `/profile/assignments`.

### Phase 3

- Build Exam Policy Report.
- Add Clobber Ladder.
- Add Question Best Matrix.
- Keep the radar as the topic mastery view.

### Phase 4

- Build Explain Score drawer.
- Make any score click-to-explain.

### Phase 5

- Open Student Report by default from Admin and Alerts.
- Add export, notes, reviewed state, and draft check-in actions.

## Success Criteria

Student-facing success:

```txt
I know where I stand.
I know which category matters most.
I know what to do next.
```

Staff-facing success:

```txt
I can understand the student's full situation in one page.
I can verify how the policy was applied.
I can decide whether intervention is needed.
```
