# Semantic Data Detective

## Outcome

Semantic Data Detective uses one read-only semantic query layer from three surfaces:

1. The GradeView web client sends a natural-language question to `POST /api/v2/admin/ai-query`.
2. The API maps the question to a structured query spec, validates it, and compiles parameterized SQL.
3. The `gradeview-course-analytics` MCP plugin calls the same API through `describe_course_analytics` and `query_course_analytics`.

The model never generates or executes SQL. The browser and MCP server never receive database credentials.

## Live schema findings

The implementation was checked against the running PostgreSQL `information_schema`. Analytics currently use `courses`, `students`, `assignments`, and `submissions`; the live schema also exposes course policy, effective exam score, and effective attendance score tables for future semantic views.

The schema endpoint returns both the current database column shape and the safe semantic catalog. It omits student email and does not return table rows.

## Query contract

`POST /api/v2/admin/ai-query/execute?course_id=<id>` accepts:

```json
{
  "view": "students",
  "select": ["student_name", "average_score"],
  "filters": [{ "field": "average_score", "operator": "lt", "value": 60 }],
  "order_by": [{ "field": "average_score", "direction": "asc" }],
  "limit": 10
}
```

Supported views are `students`, `assignments`, `categories`, `submissions`, `daily_activity`, and `course_summary`. The live catalog is authoritative for fields and operators.

## Security boundaries

- Existing GradeView session authentication and staff/course authorization run before either analytics route.
- Every compiled base query binds the authorized course as `$1` and joins student identity through that course.
- View names, selected fields, filters, operators, and ordering are allowlisted.
- Filter values use PostgreSQL parameters. Limit is an integer capped at 100.
- The semantic API is read-only and contains no mutation grammar.
- The MCP server requires `GRADEVIEW_API_TOKEN`; it calls GradeView HTTP APIs instead of PostgreSQL.

## Plugin configuration

The repo-local plugin is in `plugins/gradeview-course-analytics`. Before launching Codex with it, provide:

```text
GRADEVIEW_API_TOKEN=<valid GradeView session token>
GRADEVIEW_API_BASE_URL=http://localhost
GRADEVIEW_DEFAULT_COURSE_ID=1329547
```

`GRADEVIEW_DEFAULT_COURSE_ID` is optional. Without it, tool calls must include `course_id`.

## Extension path

Add future metrics as new fields or views in `semanticQuery.js`, then expose them automatically through the live catalog. Keep policy-aware grade calculations in shared GradeView domain helpers rather than reproducing policy formulas in prompts or MCP code.
