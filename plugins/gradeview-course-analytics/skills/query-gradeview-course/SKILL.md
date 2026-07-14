---
name: query-gradeview-course
description: Query live GradeView course data through the course-scoped semantic analytics MCP tools. Use when answering questions about student averages or variability, assignment difficulty or timing, category comparisons, submission activity, rankings, or course-wide grade statistics without writing SQL or bypassing GradeView permissions.
---

# Query GradeView Course

Use the GradeView semantic tools as the only data source. Never infer live values from examples or generate SQL.

## Workflow

1. Resolve exactly one `course_id` from the user's context. Ask for it only when neither the request nor `GRADEVIEW_DEFAULT_COURSE_ID` supplies one.
2. Call `describe_course_analytics` before the first query for a course. Treat its catalog as authoritative for available views and fields.
3. Translate the question into a `query_course_analytics` spec using only fields from one catalog view.
4. Keep the smallest useful `select`, filters, and limit. Use a maximum limit of 100.
5. Report the returned `source.course_id` and distinguish zero matching rows from a failed request.

## Guardrails

- Keep every request scoped to one course.
- Do not request or expose email addresses; the semantic catalog intentionally omits them.
- Do not attempt raw SQL, schema mutation, cross-course comparison, or direct database access.
- Preserve GradeView authorization errors. Do not retry against another course.
- Aggregate results when student-level detail is unnecessary.

Read [references/query-patterns.md](references/query-patterns.md) for view selection and concrete specs.
