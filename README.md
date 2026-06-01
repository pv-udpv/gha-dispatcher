# GHA Dispatcher — single-screen GitHub Actions dispatcher for pv-udpv/pplx-lab

A minimal, zero-friction UI for triggering GitHub Actions `workflow_dispatch` events across the pplx-lab infrastructure. Runs on [pplx.app](https://pplx.app), backed by a Supabase audit log, and requires no user accounts — only a GitHub Personal Access Token held in browser memory for the session lifetime.

---

## Quick Start

**Prerequisites:** Node 20+, pnpm 9+

```bash
# Clone and install all workspaces
git clone <repo-url> gha-dispatcher
cd gha-dispatcher
pnpm install

# Start the dispatcher web app (Vite + Express dev server)
pnpm dev

# Start the docs site (Starlight / Astro)
pnpm dev:docs
```

The web app runs at `http://localhost:5000` by default (Express serves Vite HMR in dev mode). Copy `.env.example` to `.env` and fill in the required Supabase credentials.

---

## Architecture

```
Browser (React + Vite)
  └─► Express API  (Node, tsx in dev / esbuild bundle in prod)
        ├─► GitHub API  (workflow dispatch, run list, branch list)
        └─► Supabase    (dispatch audit log — gha_dispatcher.dispatch_log)
```

**PAT in browser memory only.** The GitHub Personal Access Token is never written to disk, cookies, or localStorage — it lives in a React context (`GithubContext`) for the lifetime of the tab. This keeps the surface area for credential exposure minimal: closing the tab discards the token. The Express server acts as a thin proxy that forwards the PAT as an `Authorization: Bearer` header to the GitHub API; it is never logged or persisted.

**Hosting on pplx.app.** The app is deployed as a single Express process that serves both the compiled React SPA (`dist/public/`) and the API routes (`/api/*`). Vercel edge functions are not used — a long-lived Node process is needed for the WebSocket run-status streaming. The Supabase project lives in the `gha_dispatcher` schema on the shared pplx-lab Supabase instance.

---

## Apps

| App | Path | Description |
|-----|------|-------------|
| `@gha-dispatcher/web` | `apps/web/` | The dispatcher UI — React (Vite) + Express |
| `@gha-dispatcher/docs` | `apps/docs/` | Starlight documentation site (stub, filled by docs subagent) |

### `apps/web/` structure

```
apps/web/
├── client/          # React frontend (Vite root)
│   └── src/
│       ├── components/   # TopBar, PatPanel, DispatchForm, WorkflowTabs, RecentRuns
│       ├── lib/          # GithubContext, ThemeContext, apiRequest helpers
│       └── pages/        # home.tsx, not-found.tsx
├── server/          # Express backend
│   ├── index.ts     # entry point
│   ├── routes.ts    # /api/* handlers
│   ├── supabase.ts  # Supabase client + table constants
│   └── storage.ts   # (legacy stub)
├── shared/          # Local shared folder — @shared/* alias (backwards compat)
└── script/
    └── build.ts     # Vite + esbuild build orchestration
```

---

## Packages

| Package | Path | Description |
|---------|------|-------------|
| `@gha-dispatcher/shared` | `packages/shared/` | Zod schemas, TypeScript types, and `workflowsCatalog` JSON |

See [`packages/shared/README.md`](packages/shared/README.md) for the full export list.

---

## Hosting

The app targets **pplx.app** (Perplexity's internal hosting). Deployment is triggered via GitHub Actions (`workflow_dispatch`) from the dispatcher itself — delightfully recursive.

Environment variables required at runtime:

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/public key |
| `GITHUB_REPO` | Default repo slug (`owner/repo`), e.g. `pv-udpv/pplx-lab` |

---

## Contributing

1. `pnpm install` — installs all workspace dependencies
2. `pnpm dev` — starts the web app with HMR
3. `pnpm build` — builds all packages and apps
4. `pnpm typecheck` — type-checks all workspaces
5. `pnpm lint` — lints all workspaces

PRs require passing CI (lint + typecheck) defined in `.github/workflows/ci.yml`.
