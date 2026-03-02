# Database Migration Standard

## 1) Naming Convention

Use incremental, descriptive SQL files:

- `NNN_<short_action>.sql`
- Examples:
  - `003_add_config_version_to_system_config.sql`
  - `004_add_if_match_lock_columns.sql`

Rules:

- `NNN` must be monotonically increasing.
- File name should explain intent, not implementation detail.
- One migration file = one logical change unit.

## 2) Authoring Rules

Each migration should be:

1. **Idempotent** where possible (`IF NOT EXISTS`, guarded `ALTER` blocks).
2. **Reversible** with documented rollback SQL.
3. **Scoped** to schema/data migration only (no app business logic).

Add a header block:

```sql
-- Migration: <title>
-- Date: YYYY-MM-DD
-- Description: <what/why>
-- Rollback: <manual rollback strategy summary>
```

## 3) Rollback Strategy

For every migration, provide one of:

- `down` SQL section in the same file (commented), or
- a paired rollback file in the same folder.

Rollback guidance:

- For destructive DDL, take backup snapshot first.
- For column drops, stage as:
  - deploy with nullable/new column,
  - migrate reads/writes,
  - remove old column in later release.

## 4) Release Order (mandatory)

Always deploy in this order:

1. **Schema first** (new tables/columns/indexes; backwards compatible).
2. **Application code second** (start using new schema).
3. **Cleanup migration third** (drop deprecated columns/constraints later).

Never deploy code that requires a schema change that is not already applied.

## 5) Local/CI/Prod Promotion Flow

1. Apply migration on local isolated DB.
2. Run smoke queries for new constraints and indexes.
3. Run API integration tests.
4. Apply to staging.
5. Apply to production in maintenance window or guarded rollout.

## 6) Minimal Migration Checklist

- [ ] Naming follows `NNN_<action>.sql`
- [ ] Has rollback instructions
- [ ] No breaking change in same release without compatibility bridge
- [ ] Indexes added for new high-cardinality query paths
- [ ] Verified on local isolated Postgres
