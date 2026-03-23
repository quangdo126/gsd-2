---
estimated_steps: 3
estimated_files: 5
skills_used:
  - debug-like-expert
  - test
  - review
---

# T04: Close the slice with integrated regression coverage

**Slice:** S01 — Schema v8 + plan_milestone tool + ROADMAP renderer
**Milestone:** M001

## Description

Run and tighten the targeted S01 regression suite so the slice closes with real integration confidence instead of a pile of uncoordinated edits. This task exists to catch interface mismatches between schema migration, handler behavior, roadmap rendering, prompt contracts, and rogue detection before S02 builds on top of them.

## Steps

1. Review the final S01 test surfaces for gaps introduced by T01-T03 and add any missing assertions needed to keep the slice demo and requirements true.
2. Run the full targeted S01 verification suite and fix test fixtures or expectations that drifted during implementation.
3. Leave the slice with a clean, repeatable targeted proof command set that downstream slices can trust.

## Must-Haves

- [ ] The targeted S01 suite runs green against the final implementation.
- [ ] Test fixtures and expectations match the final roadmap format, tool output, and rogue-detection rules.
- [ ] No S01 requirement is left depending on an unverified behavior.

## Verification

- `node --test src/resources/extensions/gsd/tests/plan-milestone.test.ts src/resources/extensions/gsd/tests/markdown-renderer.test.ts src/resources/extensions/gsd/tests/prompt-contracts.test.ts src/resources/extensions/gsd/tests/rogue-file-detection.test.ts src/resources/extensions/gsd/tests/migrate-hierarchy.test.ts`
- Confirm the suite proves schema migration, handler path, roadmap rendering, prompt migration, and rogue detection together.

## Inputs

- `src/resources/extensions/gsd/tests/plan-milestone.test.ts` — tool-handler contract coverage from T02
- `src/resources/extensions/gsd/tests/markdown-renderer.test.ts` — roadmap rendering and parser round-trip coverage from T01
- `src/resources/extensions/gsd/tests/prompt-contracts.test.ts` — planning prompt contract coverage from T03
- `src/resources/extensions/gsd/tests/rogue-file-detection.test.ts` — rogue planning artifact coverage from T03
- `src/resources/extensions/gsd/tests/migrate-hierarchy.test.ts` — migration/backfill coverage from T01

## Expected Output

- `src/resources/extensions/gsd/tests/plan-milestone.test.ts` — finalized integrated handler assertions
- `src/resources/extensions/gsd/tests/markdown-renderer.test.ts` — finalized roadmap renderer assertions
- `src/resources/extensions/gsd/tests/prompt-contracts.test.ts` — finalized planning prompt assertions
- `src/resources/extensions/gsd/tests/rogue-file-detection.test.ts` — finalized planning rogue-detection assertions
- `src/resources/extensions/gsd/tests/migrate-hierarchy.test.ts` — finalized v8 migration/backfill assertions

## Observability Impact

- Runtime signals: integrated regressions must expose whether failures come from schema migration, milestone planning writes, roadmap rendering, prompt contracts, or rogue-write enforcement rather than collapsing into an opaque suite failure.
- Inspection surfaces: `plan-milestone.test.ts`, `markdown-renderer.test.ts`, `prompt-contracts.test.ts`, `rogue-file-detection.test.ts`, and `migrate-hierarchy.test.ts` together provide the future inspection path for this slice; the integrated proof command must remain runnable and trustworthy.
- Failure visibility: any failing assertion in this task should name the drifted contract directly (render shape, DB write path, prompt text, or rogue path) so a future agent can resume from the exact broken seam without re-research.
- Redaction constraints: none beyond normal repository data; no secrets involved.
