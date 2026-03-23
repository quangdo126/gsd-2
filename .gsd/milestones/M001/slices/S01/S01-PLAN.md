# S01: Schema v8 + plan_milestone tool + ROADMAP renderer

**Goal:** Make milestone planning DB-backed by adding schema v8 storage, a `gsd_plan_milestone` write path, full ROADMAP rendering from DB, and prompt/enforcement updates that stop direct roadmap writes from bypassing state.
**Demo:** Running the milestone-planning handler against structured input writes milestone planning fields into SQLite, renders `.gsd/milestones/M001/M001-ROADMAP.md` from DB state, and tests prove prompt contracts plus rogue-write detection cover the transition path.

## Must-Haves

- Schema v8 stores milestone-planning data plus downstream slice/task planning columns and creates `replan_history` and `assessments` tables without breaking existing DBs.
- `gsd_plan_milestone` validates flat structured input, writes milestone + slice planning data transactionally, renders ROADMAP.md from DB, and clears state/parse caches after render.
- `renderRoadmapFromDb()` emits a complete parser-compatible roadmap including vision, success criteria, risks, proof strategy, verification classes, definition of done, requirement coverage, slices, and boundary map.
- Planning prompts stop instructing direct roadmap writes and rogue detection flags direct `ROADMAP.md` / `PLAN.md` writes that bypass planning tools.
- Migration and renderer/tool tests prove v7→v8 upgrade, roadmap round-trip fidelity, tool-handler behavior, and prompt/enforcement coverage.

## Proof Level

- This slice proves: integration
- Real runtime required: yes
- Human/UAT required: no

## Verification

- `node --test src/resources/extensions/gsd/tests/plan-milestone.test.ts`
- `node --test src/resources/extensions/gsd/tests/markdown-renderer.test.ts`
- `node --test src/resources/extensions/gsd/tests/prompt-contracts.test.ts`
- `node --test src/resources/extensions/gsd/tests/rogue-file-detection.test.ts src/resources/extensions/gsd/tests/migrate-hierarchy.test.ts`
- `node --test src/resources/extensions/gsd/tests/markdown-renderer.test.ts --test-name-pattern="stderr warning|stale"`

## Observability / Diagnostics

- Runtime signals: tool handler returns structured error details for schema validation / render failures; migration and rogue-detection tests expose fallback-path regressions.
- Inspection surfaces: `src/resources/extensions/gsd/tests/plan-milestone.test.ts`, `src/resources/extensions/gsd/tests/markdown-renderer.test.ts`, `src/resources/extensions/gsd/tests/rogue-file-detection.test.ts`, and SQLite rows in milestone/slice/artifact tables.
- Failure visibility: render failures must surface before cache invalidation completes; rogue detection must name the offending roadmap/plan path; migration tests must show whether v8 columns/tables were created.
- Redaction constraints: none beyond normal repository data; no secrets involved.

## Integration Closure

- Upstream surfaces consumed: `src/resources/extensions/gsd/gsd-db.ts`, `src/resources/extensions/gsd/markdown-renderer.ts`, `src/resources/extensions/gsd/bootstrap/db-tools.ts`, `src/resources/extensions/gsd/md-importer.ts`, `src/resources/extensions/gsd/auto-post-unit.ts`, existing parser contracts in `src/resources/extensions/gsd/files.ts`.
- New wiring introduced in this slice: milestone-planning DB accessors, `gsd_plan_milestone` tool registration/handler, full ROADMAP render path, prompt contract migration, and rogue-write detection for planning artifacts.
- What remains before the milestone is truly usable end-to-end: slice/task planning tools, reassess/replan structural enforcement, caller migration to DB reads, and full hot-path parser retirement in later slices.

## Tasks

- [x] **T01: Add schema v8 planning storage and roadmap rendering** `est:1h15m`
  - Why: S01 cannot write milestone planning through tools until SQLite can hold the fields and ROADMAP.md can be regenerated from DB without relying on an existing file.
  - Files: `src/resources/extensions/gsd/gsd-db.ts`, `src/resources/extensions/gsd/markdown-renderer.ts`, `src/resources/extensions/gsd/md-importer.ts`, `src/resources/extensions/gsd/tests/markdown-renderer.test.ts`, `src/resources/extensions/gsd/tests/migrate-hierarchy.test.ts`
  - Do: Add the v7→v8 migration for milestone/slice/task planning columns and `replan_history` / `assessments`; add milestone-planning query/upsert helpers needed by the new tool; implement full `renderRoadmapFromDb()` with parser-compatible output and artifact persistence; extend importer coverage so pre-v8 roadmap content backfills new milestone fields best-effort on migration.
  - Verify: `node --test src/resources/extensions/gsd/tests/markdown-renderer.test.ts src/resources/extensions/gsd/tests/migrate-hierarchy.test.ts`
  - Done when: opening a v7 DB upgrades to v8, roadmap rendering can generate a complete file from DB state, and migration tests prove existing roadmap content still imports cleanly.
- [x] **T02: Wire gsd_plan_milestone through the DB-backed tool path** `est:1h15m`
  - Why: The slice promise is a real planning tool, not just storage and renderer primitives. The handler must establish the validate → transaction → render → invalidate pattern downstream slices will reuse.
  - Files: `src/resources/extensions/gsd/tools/plan-milestone.ts`, `src/resources/extensions/gsd/bootstrap/db-tools.ts`, `src/resources/extensions/gsd/tests/plan-milestone.test.ts`, `src/resources/extensions/gsd/gsd-db.ts`, `src/resources/extensions/gsd/markdown-renderer.ts`
  - Do: Implement the milestone-planning handler using the existing completion-tool pattern; ensure it performs structural validation on flat tool params, upserts milestone and slice planning rows in one transaction, renders/stores ROADMAP.md after commit, and explicitly calls `invalidateStateCache()` and `clearParseCache()` after successful render; register canonical + alias tool definitions in `db-tools.ts`.
  - Verify: `node --test src/resources/extensions/gsd/tests/plan-milestone.test.ts`
  - Done when: the handler rejects invalid payloads, writes valid planning data to DB, renders the roadmap artifact, stores rendered content, and tests prove cache invalidation and idempotent reruns.
- [x] **T03: Migrate planning prompts and enforce rogue-write detection** `est:50m`
  - Why: The tool path is incomplete if prompts still tell the model to write roadmap files directly or if direct writes can bypass DB state silently.
  - Files: `src/resources/extensions/gsd/prompts/plan-milestone.md`, `src/resources/extensions/gsd/prompts/guided-plan-milestone.md`, `src/resources/extensions/gsd/prompts/plan-slice.md`, `src/resources/extensions/gsd/prompts/replan-slice.md`, `src/resources/extensions/gsd/prompts/reassess-roadmap.md`, `src/resources/extensions/gsd/auto-post-unit.ts`, `src/resources/extensions/gsd/tests/prompt-contracts.test.ts`, `src/resources/extensions/gsd/tests/rogue-file-detection.test.ts`
  - Do: Rewrite planning prompts so they instruct tool calls instead of direct roadmap/plan file writes while preserving existing planning context variables; extend `detectRogueFileWrites()` to flag direct `ROADMAP.md` and `PLAN.md` writes for planning units; add contract tests that prove the new instructions and enforcement paths hold.
  - Verify: `node --test src/resources/extensions/gsd/tests/prompt-contracts.test.ts src/resources/extensions/gsd/tests/rogue-file-detection.test.ts`
  - Done when: planning prompts name the DB tools, direct file-write instructions are gone, and rogue detection tests fail if roadmap/plan files appear without matching DB state.
- [x] **T04: Close the slice with integrated regression coverage** `est:40m`
  - Why: S01 crosses schema migration, tool registration, markdown rendering, prompt contracts, and migration fallback. The slice is only done when those surfaces pass together, not as isolated edits.
  - Files: `src/resources/extensions/gsd/tests/plan-milestone.test.ts`, `src/resources/extensions/gsd/tests/markdown-renderer.test.ts`, `src/resources/extensions/gsd/tests/prompt-contracts.test.ts`, `src/resources/extensions/gsd/tests/rogue-file-detection.test.ts`, `src/resources/extensions/gsd/tests/migrate-hierarchy.test.ts`
  - Do: Fill remaining regression gaps discovered during implementation, keep test fixtures aligned with the final roadmap format/tool output, and run the full targeted S01 suite so downstream slices inherit a stable baseline.
  - Verify: `node --test src/resources/extensions/gsd/tests/plan-milestone.test.ts src/resources/extensions/gsd/tests/markdown-renderer.test.ts src/resources/extensions/gsd/tests/prompt-contracts.test.ts src/resources/extensions/gsd/tests/rogue-file-detection.test.ts src/resources/extensions/gsd/tests/migrate-hierarchy.test.ts`
  - Done when: the combined targeted suite passes against the final implementation and demonstrates the slice demo truthfully.

## Files Likely Touched

- `src/resources/extensions/gsd/gsd-db.ts`
- `src/resources/extensions/gsd/markdown-renderer.ts`
- `src/resources/extensions/gsd/tools/plan-milestone.ts`
- `src/resources/extensions/gsd/bootstrap/db-tools.ts`
- `src/resources/extensions/gsd/md-importer.ts`
- `src/resources/extensions/gsd/auto-post-unit.ts`
- `src/resources/extensions/gsd/prompts/plan-milestone.md`
- `src/resources/extensions/gsd/prompts/guided-plan-milestone.md`
- `src/resources/extensions/gsd/prompts/plan-slice.md`
- `src/resources/extensions/gsd/prompts/replan-slice.md`
- `src/resources/extensions/gsd/prompts/reassess-roadmap.md`
- `src/resources/extensions/gsd/tests/plan-milestone.test.ts`
- `src/resources/extensions/gsd/tests/markdown-renderer.test.ts`
- `src/resources/extensions/gsd/tests/prompt-contracts.test.ts`
- `src/resources/extensions/gsd/tests/rogue-file-detection.test.ts`
- `src/resources/extensions/gsd/tests/migrate-hierarchy.test.ts`
