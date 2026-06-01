# @gha-dispatcher/shared

Shared TypeScript types, Zod schemas, and static data for the GHA Dispatcher monorepo.

## Contents

| Export | Description |
|--------|-------------|
| `dispatchInputSchema` | Zod schema for a single `workflow_dispatch` input field |
| `workflowMetaSchema` | Zod schema for a workflow entry in the inventory |
| `dispatchPayloadSchema` | Zod schema for the POST `/api/dispatch` request body |
| `DispatchInput` | TypeScript type inferred from `dispatchInputSchema` |
| `WorkflowMeta` | TypeScript type inferred from `workflowMetaSchema` |
| `DispatchPayload` | TypeScript type inferred from `dispatchPayloadSchema` |
| `RunSummary` | Slimmed GitHub Actions run shape from GET `/api/runs` |
| `DispatchLogRow` | Row shape for `gha_dispatcher.dispatch_log` |
| `WorkflowInventory` | Full bundled inventory shape (owner, repo, groups) |
| `workflowsCatalog` | The bundled `workflows.json` catalog (imported as JSON) |

## No build step

This package is consumed directly as TypeScript source. Both Vite (for the React client) and `tsx` (for the Express server) transpile `.ts` files natively — no `tsc --build` or `dist/` output needed.

## Usage

```ts
import {
  dispatchPayloadSchema,
  type WorkflowMeta,
  workflowsCatalog,
} from "@gha-dispatcher/shared";
```
