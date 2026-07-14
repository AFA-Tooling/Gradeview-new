# Feature: Config & Settings

## Product Specification

- Course configuration control plane:
  [course-configuration-control-plane.md](./course-configuration-control-plane.md)

## Source Files

- Config routes: [../../api/v2/Routes/config/index.js](../../api/v2/Routes/config/index.js)
- Runtime settings tables: `gradeview_config`, `system_config`, `course_configs`, `assignment_categories`

## Current Shape

- `gradeview`: auth/UI-level config
- `gradesync`: per-course sync settings + global sync settings

## Notes

- Keep permissions in DB tables, not in config files.
- Keep config API payload format stable and versioned for safer rollout.
