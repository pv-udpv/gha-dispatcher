/**
 * playbookRunner.ts — v7 in-process DAG executor.
 */
import {
  createRun,
  getRun,
  updateRunStatus,
  updateRunState,
  cancelOrphanRuns,
  getPlaybook,
} from './playbooksStore.js';
import type { Dag, DagNode, NodeState } from '@gha-dispatcher/shared';

const GH_API = 'https://api.github.com';
const MAX_CONCURRENT = 10;
const TOTAL_TIMEOUT_MS = 60 * 60_000;
const DISPATCH_TIMEOUT_MS = 30 * 60_000;
const POLL_INTERVAL_MS = 4_000;

interface Controller {
  runId: string;
  abortController: AbortController;
}

type RunStateMap = Record<string, NodeState>;

const activeRuns = new Map<string, Controller>();

async function ghFetch(
  token: string,
  path: string,
  opts: RequestInit = {},
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${GH_API}${path}`, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'gha-dispatcher',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
    signal: opts.signal,
  });
  if (res.status === 204) return { status: 204, data: null };
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || res.statusText;
    const err: any = new Error(`GitHub ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return { status: res.status, data };
}

async function persistState(runId: string, state: RunStateMap) {
  try { await updateRunState(runId, state as Record<string, unknown>); }
  catch (e: any) { console.error('[runner] persist state error:', e?.message); }
}

function evaluateCondition(
  expr: 'all_success' | 'any_success' | 'always' | 'on_failure',
  parentStatuses: string[],
): boolean {
  switch (expr) {
    case 'all_success': return parentStatuses.every((s) => s === 'succeeded');
    case 'any_success': return parentStatuses.some((s) => s === 'succeeded');
    case 'always':      return true;
    case 'on_failure':  return parentStatuses.some((s) => s === 'failed');
    default:            return false;
  }
}

async function runDispatchNode(
  node: DagNode & { kind: 'dispatch' },
  token: string,
  repoFull: string,
  runId: string,
  state: RunStateMap,
  signal: AbortSignal,
): Promise<void> {
  const data = node.data as { workflow_filename: string; branch: string; inputs: Record<string, string | boolean> };
  const { workflow_filename, branch, inputs } = data;

  state[node.id] = { status: 'running', started_at: new Date().toISOString() };
  await persistState(runId, state);

  const ghInputs: Record<string, string> = {};
  for (const [k, v] of Object.entries(inputs ?? {})) {
    ghInputs[k] = typeof v === 'boolean' ? String(v) : String(v);
  }

  const dispatchedAt = Date.now();

  try {
    await ghFetch(
      token,
      `/repos/${repoFull}/actions/workflows/${encodeURIComponent(workflow_filename)}/dispatches`,
      { method: 'POST', body: JSON.stringify({ ref: branch || 'main', inputs: ghInputs }), signal },
    );
  } catch (e: any) {
    state[node.id] = {
      status: 'failed',
      started_at: state[node.id]?.started_at,
      completed_at: new Date().toISOString(),
      error: e?.message ?? 'dispatch failed',
    };
    await persistState(runId, state);
    throw e;
  }

  const deadline = dispatchedAt + DISPATCH_TIMEOUT_MS;
  let ghRunId: number | undefined;
  let htmlUrl: string | undefined;

  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error('cancelled');
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    try {
      const { data: runsData } = await ghFetch(
        token,
        `/repos/${repoFull}/actions/runs?event=workflow_dispatch&branch=${encodeURIComponent(branch || 'main')}&per_page=20`,
        { signal },
      );
      const runs: any[] = runsData?.workflow_runs ?? [];
      const match = runs.find(
        (r) =>
          r.path?.includes(workflow_filename) &&
          new Date(r.created_at).getTime() >= dispatchedAt - 5_000,
      );
      if (match) {
        ghRunId = match.id;
        htmlUrl = match.html_url;
        state[node.id] = { ...state[node.id], run_id: ghRunId, run_html_url: htmlUrl, status: 'running' };
        await persistState(runId, state);
        break;
      }
    } catch (e: any) {
      if (signal.aborted) throw new Error('cancelled');
      console.error('[runner] poll dispatch error:', e?.message);
    }
  }

  if (!ghRunId) {
    state[node.id] = {
      status: 'failed',
      started_at: state[node.id]?.started_at,
      completed_at: new Date().toISOString(),
      error: 'timeout: could not correlate run_id',
    };
    await persistState(runId, state);
    throw new Error('timeout: run not found');
  }

  const runDeadline = dispatchedAt + DISPATCH_TIMEOUT_MS;
  while (Date.now() < runDeadline) {
    if (signal.aborted) throw new Error('cancelled');
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    try {
      const { data: runData } = await ghFetch(token, `/repos/${repoFull}/actions/runs/${ghRunId}`, { signal });
      const status: string = runData?.status;
      const conclusion: string | null = runData?.conclusion ?? null;

      if (status === 'completed') {
        const terminal = conclusion === 'success' ? 'succeeded' : 'failed';
        state[node.id] = {
          status: terminal,
          run_id: ghRunId,
          run_html_url: htmlUrl,
          started_at: state[node.id]?.started_at,
          completed_at: new Date().toISOString(),
          ...(terminal === 'failed' ? { error: `conclusion: ${conclusion}` } : {}),
        };
        await persistState(runId, state);
        if (terminal === 'failed') throw new Error(`run failed: conclusion=${conclusion}`);
        return;
      }
    } catch (e: any) {
      if (signal.aborted) throw new Error('cancelled');
      console.error('[runner] poll run status error:', e?.message);
    }
  }

  state[node.id] = {
    status: 'failed',
    run_id: ghRunId,
    run_html_url: htmlUrl,
    started_at: state[node.id]?.started_at,
    completed_at: new Date().toISOString(),
    error: 'timeout',
  };
  await persistState(runId, state);
  throw new Error('timeout');
}

async function executeDag(
  dag: Dag,
  runId: string,
  pat: string,
  repoFull: string,
  signal: AbortSignal,
): Promise<void> {
  const { nodes, edges } = dag;

  const startNodes = nodes.filter((n) => n.kind === 'start');
  const endNodes = nodes.filter((n) => n.kind === 'end');
  if (startNodes.length !== 1 || endNodes.length !== 1) {
    throw new Error('DAG must have exactly one start and one end node');
  }

  const inEdges = new Map<string, string[]>();
  const outEdges = new Map<string, string[]>();
  for (const n of nodes) { inEdges.set(n.id, []); outEdges.set(n.id, []); }
  for (const e of edges) {
    inEdges.get(e.target)?.push(e.source);
    outEdges.get(e.source)?.push(e.target);
  }

  const state: RunStateMap = {};
  for (const n of nodes) {
    state[n.id] = { status: 'pending' };
  }
  state[startNodes[0].id] = { status: 'succeeded', started_at: new Date().toISOString(), completed_at: new Date().toISOString() };

  await updateRunStatus(runId, 'running');
  await persistState(runId, state);

  const settled = new Set<string>([startNodes[0].id]);
  const inFlight = new Set<string>();
  const endNodeId = endNodes[0].id;
  const totalDeadline = Date.now() + TOTAL_TIMEOUT_MS;

  while (true) {
    if (signal.aborted) {
      await updateRunStatus(runId, 'cancelled', new Date().toISOString());
      return;
    }
    if (Date.now() > totalDeadline) {
      for (const n of nodes) {
        if (state[n.id].status === 'running' || state[n.id].status === 'pending') {
          state[n.id] = { ...state[n.id], status: 'failed', error: 'total timeout', completed_at: new Date().toISOString() };
        }
      }
      await persistState(runId, state);
      await updateRunStatus(runId, 'failed', new Date().toISOString());
      return;
    }

    if (settled.has(endNodeId)) {
      const endStatus = state[endNodeId].status;
      const runStatus = (endStatus === 'succeeded' || endStatus === 'skipped') ? 'succeeded' : 'failed';
      await updateRunStatus(runId, runStatus, new Date().toISOString());
      return;
    }

    const readyNodes: DagNode[] = [];
    for (const n of nodes) {
      if (settled.has(n.id) || inFlight.has(n.id)) continue;
      if (state[n.id].status === 'awaiting_approval') continue;

      const parents = inEdges.get(n.id) ?? [];
      if (parents.length === 0) continue;
      const allParentsDone = parents.every((p) => settled.has(p));
      if (!allParentsDone) continue;

      readyNodes.push(n);
    }

    for (const node of readyNodes) {
      const parents = inEdges.get(node.id) ?? [];
      const parentStatuses = parents.map((p) => state[p].status);

      if (node.kind === 'condition') {
        const condData = node.data as { expr: 'all_success' | 'any_success' | 'always' | 'on_failure' };
        const pass = evaluateCondition(condData.expr, parentStatuses);
        state[node.id] = {
          status: pass ? 'succeeded' : 'skipped',
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        };
        settled.add(node.id);
        await persistState(runId, state);
        continue;
      }

      if (node.kind === 'end') {
        const anyFailed = parentStatuses.some((s) => s === 'failed');
        state[node.id] = {
          status: anyFailed ? 'failed' : 'succeeded',
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        };
        settled.add(node.id);
        await persistState(runId, state);
        continue;
      }

      if (node.kind === 'parallel_group') {
        state[node.id] = {
          status: 'succeeded',
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        };
        settled.add(node.id);
        await persistState(runId, state);
        continue;
      }

      if (node.kind === 'wait_approval') {
        state[node.id] = { status: 'awaiting_approval', started_at: new Date().toISOString() };
        await persistState(runId, state);
        continue;
      }

      if (node.kind === 'dispatch') {
        inFlight.add(node.id);
        const dispatchNode = node as DagNode & { kind: 'dispatch' };
        runDispatchNode(dispatchNode, pat, repoFull, runId, state, signal)
          .then(() => {
            settled.add(node.id);
            inFlight.delete(node.id);
          })
          .catch((e) => {
            if (!state[node.id] || state[node.id].status === 'running') {
              state[node.id] = {
                status: 'failed',
                started_at: state[node.id]?.started_at,
                completed_at: new Date().toISOString(),
                error: e?.message ?? 'unknown error',
              };
            }
            settled.add(node.id);
            inFlight.delete(node.id);
          });
        continue;
      }
    }

    const anyPending = nodes.some(
      (n) => !settled.has(n.id) && !inFlight.has(n.id) && state[n.id].status !== 'awaiting_approval',
    );

    if (!anyPending && inFlight.size === 0 && !settled.has(endNodeId)) {
      const anyAwaiting = nodes.some((n) => state[n.id].status === 'awaiting_approval');
      if (!anyAwaiting) {
        await updateRunStatus(runId, 'failed', new Date().toISOString());
        return;
      }
    }

    await new Promise((r) => setTimeout(r, 1_000));

    // Re-check awaiting_approval nodes to see if they've been approved externally
    for (const n of nodes) {
      if (state[n.id].status === 'awaiting_approval') {
        const freshRun = await getRun(runId).catch(() => null);
        if (freshRun) {
          const freshState = (freshRun.state ?? {}) as RunStateMap;
          if (freshState[n.id]?.status === 'succeeded') {
            state[n.id] = freshState[n.id];
            settled.add(n.id);
          }
        }
      }
    }
  }
}

export const playbookRunner = {
  async init(): Promise<void> {
    await cancelOrphanRuns();
  },

  async start(playbookId: string, pat: string, triggeredBy?: string): Promise<string> {
    if (activeRuns.size >= MAX_CONCURRENT) {
      throw new Error(`Too many concurrent playbook runs (max ${MAX_CONCURRENT})`);
    }

    const playbook = await getPlaybook(playbookId);
    if (!playbook) throw new Error(`Playbook ${playbookId} not found`);

    const run = await createRun(playbookId, triggeredBy);
    const runId = run.id as string;
    const repoFull = playbook.repo_full;

    const ac = new AbortController();
    activeRuns.set(runId, { runId, abortController: ac });

    executeDag(playbook.dag, runId, pat, repoFull, ac.signal)
      .catch(async (e) => {
        console.error(`[runner] run ${runId} fatal error:`, e?.message);
        try {
          await updateRunStatus(runId, 'failed', new Date().toISOString());
        } catch { /* ignore */ }
      })
      .finally(() => {
        activeRuns.delete(runId);
      });

    return runId;
  },

  async cancel(runId: string): Promise<void> {
    const ctrl = activeRuns.get(runId);
    if (ctrl) {
      ctrl.abortController.abort();
      activeRuns.delete(runId);
    }
    await updateRunStatus(runId, 'cancelled', new Date().toISOString());
  },

  async approve(runId: string, nodeId: string, _pat: string): Promise<void> {
    const run = await getRun(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    const state = (run.state ?? {}) as RunStateMap;
    const nodeState = state[nodeId];
    if (!nodeState || nodeState.status !== 'awaiting_approval') {
      throw new Error(`Node ${nodeId} is not awaiting approval`);
    }

    state[nodeId] = {
      ...nodeState,
      status: 'succeeded',
      completed_at: new Date().toISOString(),
    };
    await updateRunState(runId, state as Record<string, unknown>);
  },

  getStatus(runId: string): boolean {
    return activeRuns.has(runId);
  },
};
