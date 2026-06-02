/**
 * playbooksStore.ts — v7 Playbooks CRUD via Supabase service-role client.
 */
import { supabase } from './supabase.js';
import type { Playbook, CreatePlaybook } from '@gha-dispatcher/shared';

const PLAYBOOKS_TABLE = 'playbooks';
const RUNS_TABLE = 'playbook_runs';

function assertSupabase(): NonNullable<typeof supabase> {
  if (!supabase) throw new Error('Supabase client not configured');
  return supabase;
}

// ---------------------------------------------------------------------------
// Playbooks
// ---------------------------------------------------------------------------

export async function listPlaybooks(repoFull?: string): Promise<Playbook[]> {
  const sb = assertSupabase();
  let q = sb.from(PLAYBOOKS_TABLE).select('*').order('updated_at', { ascending: false });
  if (repoFull) q = q.eq('repo_full', repoFull);
  const { data, error } = await q;
  if (error) throw new Error(`[playbooksStore] list error: ${error.message}`);
  return (data ?? []) as unknown as Playbook[];
}

export async function getPlaybook(id: string): Promise<Playbook | null> {
  const sb = assertSupabase();
  const { data, error } = await sb
    .from(PLAYBOOKS_TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`[playbooksStore] get error: ${error.message}`);
  return data as unknown as Playbook | null;
}

export async function upsertPlaybook(
  playbook: CreatePlaybook & { id?: string; version?: number },
): Promise<Playbook> {
  const sb = assertSupabase();
  const payload: Record<string, unknown> = {
    repo_full: playbook.repo_full,
    name: playbook.name,
    description: playbook.description ?? null,
    dag: playbook.dag,
    updated_at: new Date().toISOString(),
  };
  if (playbook.id) payload.id = playbook.id;
  if (playbook.version != null) payload.version = playbook.version;

  const { data, error } = await sb
    .from(PLAYBOOKS_TABLE)
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw new Error(`[playbooksStore] upsert error: ${error.message}`);
  return data as unknown as Playbook;
}

export async function deletePlaybook(id: string): Promise<void> {
  const sb = assertSupabase();
  const { error } = await sb.from(PLAYBOOKS_TABLE).delete().eq('id', id);
  if (error) throw new Error(`[playbooksStore] delete error: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Playbook Runs
// ---------------------------------------------------------------------------

export async function createRun(playbookId: string, triggeredBy?: string) {
  const sb = assertSupabase();
  const { data, error } = await sb
    .from(RUNS_TABLE)
    .insert({ playbook_id: playbookId, triggered_by: triggeredBy ?? null, status: 'pending', state: {} })
    .select()
    .single();
  if (error) throw new Error(`[playbooksStore] createRun error: ${error.message}`);
  return data;
}

export async function getRun(id: string) {
  const sb = assertSupabase();
  const { data, error } = await sb.from(RUNS_TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`[playbooksStore] getRun error: ${error.message}`);
  return data;
}

export async function updateRunStatus(
  id: string,
  status: string,
  completedAt?: string,
) {
  const sb = assertSupabase();
  const patch: Record<string, unknown> = { status };
  if (completedAt) patch.completed_at = completedAt;
  const { error } = await sb.from(RUNS_TABLE).update(patch).eq('id', id);
  if (error) throw new Error(`[playbooksStore] updateRunStatus error: ${error.message}`);
}

export async function updateRunState(id: string, state: Record<string, unknown>) {
  const sb = assertSupabase();
  const { error } = await sb.from(RUNS_TABLE).update({ state }).eq('id', id);
  if (error) throw new Error(`[playbooksStore] updateRunState error: ${error.message}`);
}

/** Mark any 'running' rows as 'cancelled' — called at startup for orphan recovery. */
export async function cancelOrphanRuns(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from(RUNS_TABLE)
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('status', 'running');
  if (error) console.error('[playbooksStore] cancelOrphanRuns error:', error.message);
}
