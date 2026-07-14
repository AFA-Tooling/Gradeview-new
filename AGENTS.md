# GradeView Agent Instructions

## Class Health student report interaction

- In **Class Health → Students**, clicking a student's name must open that student's **Student Report in a modal/dialog over the existing Class Health page**.
- Do not navigate to `/students/:studentId/report`, replace the current page, or otherwise change the current Class Health URL when the student name is clicked.
- Closing the Student Report must return the user to the unchanged Class Health Students view, preserving its tab, filters, sorting, and scroll context.
- Treat this as a product interaction invariant. Add or update a regression test whenever this interaction is changed.

## Student report surface synchronization

- `StudentReportContent` is the canonical report body for both standalone Student Report routes and the **Class Health → Students** modal. Do not create a modal-only or route-only copy of report cards, metrics, formulas, labels, or status handling.
- Shared report metrics must come from shared selectors and shared presentation components. In particular, keep progress calculations in `getProgressAnalysis` and render the Overall score / Happy score / Grade safety margin cards through `ProgressAnalysisCards`; do not duplicate that JSX or recompute those values from the Class Health table row.
- The Class Health student row is only an identity/selection source. The modal must fetch the selected student's full profile through `fetchStudentProfileData`, using the same student and course identity as standalone report routes.
- When changing Student Report content, audit every consumer: the self report, staff `/students/:studentId/report`, and the Class Health modal. Also update derived surfaces such as Copy summary and print content when their displayed metrics change.
- Add or update regression coverage that renders the shared report content and verifies the same metric labels and values in standalone and modal contexts. Keep the existing modal URL/state-preservation regression test as part of that coverage.

## Information density and responsive layout

- At 100% browser zoom, do not compress a content block until labels, table columns, or controls become crowded, excessively wrapped, clipped, or visually noisy just to keep more content in the first viewport.
- Prefer natural page height and vertical stacking. It is acceptable for the user to scroll down when that keeps each block readable and clearly separated.
- Give data-heavy tables a comfortable minimum width. When the available container is narrower, preserve column readability with contained horizontal scrolling instead of squeezing every column into the viewport.
- On normal desktop widths, first reclaim decorative space—excess card padding, cell gutters, oversized visual indicators, and redundant empty-state graphics—so all essential table columns can fit before introducing horizontal scrolling. Keep body text readable and do not hide fields to achieve the fit.
