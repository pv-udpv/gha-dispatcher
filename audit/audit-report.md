# pv-udpv/pplx-lab — workflow_dispatch audit

- Total workflow files: **72**
- With `workflow_dispatch`: **46**
- Parse errors: **0**
- Total findings: **8**

## Findings by kind

| Kind | Count |
|---|---|
| `required_without_default` | 7 |
| `boolean_default_quoted` | 1 |

## Workflows with issues (7)

### `.github/workflows/agent-fix.yml` — Agent-Fix Chain
- [warn] **required_without_default** `issue_number`: `issue_number` is required:true but has no default — dispatcher UI must require user input.

### `.github/workflows/authorize-sandbox.yml` — Authorize Sandbox Key
- [warn] **required_without_default** `pubkey`: `pubkey` is required:true but has no default — dispatcher UI must require user input.

### `.github/workflows/experiment-engine.yml` — Experiment Engine — Self-Hosted
- [warn] **required_without_default** `task`: `task` is required:true but has no default — dispatcher UI must require user input.

### `.github/workflows/nebula-cert.yml` — Nebula cert — sign sandbox node
- [warn] **required_without_default** `sandbox_id`: `sandbox_id` is required:true but has no default — dispatcher UI must require user input.

### `.github/workflows/release.yml` — Release
- [warn] **required_without_default** `package`: `package` is required:true but has no default — dispatcher UI must require user input.
- [warn] **required_without_default** `version`: `version` is required:true but has no default — dispatcher UI must require user input.

### `.github/workflows/sandbox-provision.yml` — Sandbox SSH Provision
- [warn] **required_without_default** `sandbox_id`: `sandbox_id` is required:true but has no default — dispatcher UI must require user input.

### `.github/workflows/spec-codegen.yml` — Spec Codegen Pipeline
- [info] **boolean_default_quoted** `force_crx_update`: `force_crx_update` boolean default is quoted ('false'); GHA coerces but prefer unquoted true/false.

## Clean dispatchable workflows (39)

- `a2a-agw-fix.yml` — Fix AGW A2A config and deploy CLI runners: deploy_cli_runners
- `adr-055-kg-sync.yml` — ADR-055 KG Sync (0_ protocol): backfill_mode, dry_run
- `agw-bootstrap.yml` — AGW Bootstrap (ZBS-67/69): sandbox_pubkey
- `agw-k8s-bootstrap.yml` — AGW K8s Bootstrap (ADR-097) — lazy validate: intent
- `automerge.yml` — Control Tower — Automerge: dry_run
- `cg-upsert-once.yml` — CG Direct Upsert (one-off): all_nodes, since
- `check-agw.yml` — Check agentgateway version + http target docs: (no inputs)
- `comet-drift.yml` — comet-drift: channels, strict
- `comet-enum-watch.yml` — comet-enum-watch: cdp_host, force_notify
- `comet-pipeline.yml` — comet-pipeline: force_version, skip_ingest
- `comet-preflight.yml` — comet-preflight: force_notify
- `deploy-plugin-mcp.yml` — Deploy plugin-mcp to Supabase: force
- `deploy-pplx-proxy.yml` — Deploy pplx-proxy to Supabase: force
- `deploy-pplx-rest-mcp.yml` — Deploy pplx-rest-mcp to pv-cargo: branch, reload_agentgateway
- `deploy-pv-cargo.yml` — Deploy to pv-cargo: deploy_wave_403
- `discover-pv-cargo.yml` — Discover pv-cargo: (no inputs)
- `embed-backfill-hf.yml` — KG Embeddings Backfill (HF Inference): batch_size, force
- `embed-backfill.yml` — KG Embeddings Backfill: force
- `fleet-e2e.yml` — Fleet E2E (ADR-048): deploy_before_run, include_waven, install_node, pytest_extra, pytest_k
- `hf-artifacts.yml` — hf-artifacts: force-refresh
- `inspect-mcp-app.yml` — Inspect gateway-pplx-tools app.py: (no inputs)
- `inspect-pv-cargo.yml` — Inspect pv-cargo MCP topology: (no inputs)
- `kg-backfill.yml` — KG Embedding Backfill: batch_size
- `kg-curator-promote.yml` — KG Curator Promote: min_confidence
- `ligolo-proxy-start.yml` — ligolo-proxy-start: port
- `load-test.yml` — Load test — llm-proxy: proxy_url, run_time, spawn_rate, users
- `mcp-smoke-pvcargo.yml` — MCP Smoke — pv-cargo: no_tool_call, skip_drift
- `pplx-monitor.yml` — pplx-monitor: dry_run, skip_if_recent, window_days
- `probe-3085-init.yml` — Probe :3085 MCP init (follow redirects): (no inputs)
- `probe-3085.yml` — Probe :3085 MCP server: (no inputs)
- `probe-pv-cargo.yml` — Probe pv-cargo LLM proxy: (no inputs)
- `probe-stdio.yml` — Probe pplx-tools stdio mode: (no inputs)
- `recover-agentgateway.yml` — Break-glass recover agentgateway: probe_after, reason
- `smoke-pplx-tools.yml` — Smoke pplx-tools MCP target: (no inputs)
- `spa-corpus-pipeline.yml` — SPA Corpus — full pipeline: bundle_source, hf_repo, skip_embed, version
- `spa-corpus-upload.yml` — SPA Corpus — upload to HF: hf_repo, version
- `tailscale-acl.yml` — Tailscale ACL: (no inputs)
- `validate-config.yml` — Validate agentgateway config (proposed): branch
- `workflows-mcp-handoff.yml` — workflows-mcp-handoff: hostname, run_minutes, skip_bootstrap, skip_register, tunnel_name, zone