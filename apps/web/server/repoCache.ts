/**
 * repoCache.ts — per-repo workflow inventory cache in gha_dispatcher.repo_cache.
 */

import { supabase } from "./supabase.js";
import type { WorkflowInventoryV2 } from "@gha-dispatcher/shared";

const TABLE = "repo_cache";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Read from cache.
// Returns null if missing or stale (or refresh forced).
// ---------------------------------------------------------------------------
export async function getCachedInventory(
  repoFull: string,
  forceRefresh = false,
): Promise<WorkflowInventoryV2 | null> {
  if (!supabase || forceRefresh) return null;

  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("repo_full", repoFull)
    .maybeSingle();

  if (error || !data) return null;

  const fetchedAt = new Date(data.fetched_at as string).getTime();
  const age = Date.now() - fetchedAt;

  if (age > CACHE_TTL_MS) return null;

  try {
    return data.payload as WorkflowInventoryV2;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Upsert cache row.
// ---------------------------------------------------------------------------
export async function cacheInventory(
  repoFull: string,
  inventory: WorkflowInventoryV2,
): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase.from(TABLE).upsert(
    {
      repo_full: repoFull,
      fetched_at: inventory.fetched_at,
      payload: inventory,
    },
    { onConflict: "repo_full" },
  );

  if (error) {
    console.error("[repoCache] cacheInventory error", error.message);
  }
}
