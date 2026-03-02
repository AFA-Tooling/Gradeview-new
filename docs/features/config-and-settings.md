# Feature: Config & Settings

## Source Files

- Config routes: [../../api/v2/Routes/config/index.js](../../api/v2/Routes/config/index.js)
- Unified config helpers: [../../api/lib/unifiedConfig.mjs](../../api/lib/unifiedConfig.mjs)
- Runtime config template: [../../config.example.json](../../config.example.json)

## Current Shape

- `gradeview`: auth/UI-level config
- `gradesync`: per-course sync settings + global sync settings

## Notes

- Keep permissions in DB tables, not in config files.
- Keep config format stable and versioned for safer rollout.
