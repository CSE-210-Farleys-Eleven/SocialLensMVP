# ui: input / output contract

Owner: Yinuo. Source of truth for types: [`src/ui/contract.ts`](../../src/ui/contract.ts).
Schema version: **1**. Status: **draft**: the core contract, glossary and samples exist. The mappers and the renderer don't exist yet (plan: `tasks/plan.md` on branch `ui/dashboard`).

## Two layers

| Layer | Where | What | Depends on |
|---|---|---|---|
| **core** | `src/ui/` | Turns other modules' outputs into a `DashboardModel`: every heading, number, label and note, already formatted. Holds every product rule. | TypeScript only. No DOM, no framework, no new dependencies. Checked by the root `npm run check`. |
| **renderer** | separate package (location to be agreed; proposed `ui-web/`) | Draws a `DashboardModel`. Markup only: no rules, no formatting, no data shaping. | Its own `package.json`. Proposed: React + Vite. Imports only `src/ui/index.ts`. |

Changing the frontend stack means replacing the renderer folder. The core, this contract and the tests stay.

The renderer is not in `src/ui/` because the root tooling treats all of `src/` the same way. The root `tsconfig` has no JSX support, the root `vitest run` collects every `*.test.tsx`, and `scripts/check-boundaries.mjs` walks every folder. Each of these would need edits to files other modules depend on.

## Input: `UiInputs`

The app shell collects these and passes them to the core. A `null` field means its supplier didn't run or failed. The page then says so instead of showing zeros.

| Field | Type | Supplier | On `main`? |
|---|---|---|---|
| `analytics` | `AnalyticsResult` | analytics `analyze()` | No, PR #20. Temporary copy |
| `identity` | `IdentityItem` | adapters | Yes |
| `profile` | `ProfileStatsItem` | adapters | Yes |
| `coverage` | `CoverageEntry[]` (every collection read) | adapters | Yes |
| `issues` | `AdapterIssue[]` | adapters | Yes |
| `accounts` | `AccountsRegistryOutput` without `request` | registry `loadAccounts()` | No, PR #21. Temporary copy |
| `auth` | sign-in state + `SessionInfo` | auth | No module. Temporary |
| `privacy` | privacy observations | none yet | No module. Temporary |
| `extendedActivity` | hours, weekdays, streaks, week-over-week, top posts | analytics, not computed by PR #20 | No. Temporary |

The UI only uses `import type` from other modules' `contract.ts`, and those reach `main` only once a PR merges. So inputs that aren't on `main` yet are typed by local copies.

## Temporary inputs

Each file starts with a `TEMPORARY —` header naming its source and what replaces it. A test fails if a header is missing or a file is not listed here.

| File | Copied from | Replace with | Blocked on |
|---|---|---|---|
| `src/ui/temporary/analytics-pr20.ts` | PR #20 `src/analytics/contract.ts` | `import type { AnalyticsResult } from '../analytics/contract'` | PR #20 merge |
| `src/ui/temporary/accounts-pr21.ts` | PR #21 `src/registry/types.ts` (minus `request`) | `import type` from `src/registry/contract` | PR #21 merge |
| `src/ui/temporary/auth-session.ts` | PR #21 `SessionInfo` + Test_Module `src/auth/contract.ts` | `import type` from `src/auth/contract` | auth module |
| `src/ui/temporary/privacy-observations.ts` | Test_Module `src/analytics/privacy/contract.ts` | the privacy module's contract | no owner yet |
| `src/ui/temporary/extended-activity.ts` | Test_Module `src/analytics/contract.ts` | `import type` from `src/analytics/contract`, or drop | analytics roadmap |

Test_Module = `CSE-210-Farleys-Eleven/Test_Module_SocialLens` at commit `2b2e993`.

## Output: `DashboardModel`

```jsonc
{
  "schemaVersion": 1,
  "mode": "demo",                       // "demo" when any coverage source is "fixtures"
  "fetchedAt": "2026-11-10T20:30:00.000Z",
  "subject": { "did": "did:plc:fixture…", "handle": "complete.fixture.test" },
  "views": [                            // navigation order
    {
      "id": "overview", "title": "Overview", "available": true,
      "sections": [
        {
          "id": "activity-summary", "title": "Activity", "description": null,
          "widgets": [
            { "kind": "metric", "metric": {
                "id": "activity.posts", "label": "Posts published",
                "value": 1000, "status": "partial", "isLowerBound": true, "format": "integer",
                "valueText": "At least 1,000", "statusText": "Partial",
                "reason": "The post read stopped at the 1,000-record cap.", "detail": null } }
          ]
        }
      ]
    }
  ],
  "footer": ["Counts are observations, not scores. Times are UTC."]
}
```

### Widget kinds

| `kind` | Shows | Renderer must |
|---|---|---|
| `metric` | One number with its honesty label | Print `valueText` and `statusText` as given. Show the definition from `lookupMetric(id)` |
| `chart` | Stacked bars over UTC days, hours or weekdays | Draw bars **and** offer the same `points` as a data table. A `null` value is unknown: draw no bar and print "Unknown" in the table, never 0. Label only `axisLabelIndices`. Show `emptyText` when there's nothing to draw |
| `table` | Rows of cells | Render cells as text. Link only when `href` is set (core sets it only for https) |
| `facts` | Label/value pairs, e.g. the identity card | Same cell rules as `table` |
| `note` | A sentence. `sample-data` tone marks temporary content | Make `sample-data` notes visually distinct |
| `observation` | A privacy observation: evidence, source, limitation, action | Show all four parts. Render sample URIs as code, never as links |
| anything else | A widget from a newer core | Show `UNKNOWN_WIDGET_TEXT` and keep rendering (`isKnownWidget`) |

### Status vocabulary

| `status` | `valueText` | `statusText` | Meaning |
|---|---|---|---|
| `complete` | `"12"`; `"0"` | `""`; `"Observed zero"` | Fully observed. A 0 is a real zero |
| `complete`, `value: null` | `"No posts"` | `""` | Fully observed, nothing to compute (e.g. an average over zero posts). Not unknown, not 0 |
| `partial` | `"At least 12"` when `isLowerBound`, else `"3.4"` | `"Partial"` | Some data wasn't read. `reason` says what |
| `unknown` | `"Unknown"` | `"Unknown"` | Nothing trustworthy was observed. Never shown as 0 |
| `not-available` | `"Not available"` | `"Not available on this app"` | No supported app can supply it |

`complete`, `partial` and `unknown` are the analytics module's words (PR #20). `not-available` comes from Test_Module.

## Rules the core enforces

- A `null` input value is never printed as `0`. A partial count that can only grow is "At least N".
- Every metric id has a glossary entry (`src/ui/glossary.ts`, tested). There's no score, engagement rate, reach or impressions. Those appear only in the "not available" list with a reason.
- `href` values are https only. Post text, handles, URIs and error messages are plain strings in the model, and renderers must not parse them as markup.
- `mode: 'demo'` whenever data came from fixtures. Renderers then show `DEMO_BANNER_TEXT` on every view.
- Times are UTC and say so.
- Plain JSON only.

## How to add a statistic

1. The supplying module adds the field to its contract (their PR).
2. Add a glossary entry in `src/ui/glossary.ts`.
3. Map the field to a widget in the core mapper, with a test for complete, partial and unknown values.
4. No renderer change, unless it needs a new widget kind. Older renderers show `UNKNOWN_WIDGET_TEXT` for an unknown kind.

## Samples

`SAMPLE_SCENARIOS` (`src/ui/samples/`) holds three synthetic `UiInputs`:

- **complete:** every collection read to the end.
- **partial:** the post read hit its cap, a listing failed and some counters are missing. It includes an HTML-looking post text and a `javascript:` citation URL for safety tests.
- **empty:** observed zeros everywhere.

They use only `did:plc:fixture…` and `*.fixture.test` identities.

## Tests

```
npm run check
```

`src/ui/contract.test.ts` covers:

- the temporary-input headers and this table
- samples being plain JSON, using only fixture identities, and having consistent timelines
- glossary completeness
- the `isKnownWidget` fallback
