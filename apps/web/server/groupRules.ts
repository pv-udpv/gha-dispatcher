/**
 * groupRules.ts — CRUD + apply logic for gha_dispatcher.group_rules.
 */

import { supabase } from "./supabase.js";
import type {
  GroupRule,
  GroupedWorkflows,
  WorkflowMeta,
} from "@gha-dispatcher/shared";

const TABLE = "group_rules";

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------
export async function getRules(repoFull: string): Promise<GroupRule[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("repo_full", repoFull)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[groupRules] getRules error", error.message);
    return [];
  }
  return (data as GroupRule[]) || [];
}

// ---------------------------------------------------------------------------
// Apply rules to workflows → grouped map
// ---------------------------------------------------------------------------
export function applyRules(
  workflows: WorkflowMeta[],
  rules: GroupRule[],
): GroupedWorkflows {
  const groups: GroupedWorkflows = {};
  const unmatched: WorkflowMeta[] = [];

  for (const wf of workflows) {
    const filename = wf.path.split("/").pop() || wf.path;
    let matched = false;

    for (const rule of rules) {
      try {
        const re = new RegExp(rule.pattern_regex);
        if (re.test(filename) || re.test(wf.name)) {
          if (!groups[rule.label]) groups[rule.label] = [];
          groups[rule.label].push(wf);
          matched = true;
          break;
        }
      } catch {
        // Bad regex — skip this rule
      }
    }

    if (!matched) {
      unmatched.push(wf);
    }
  }

  if (unmatched.length > 0) {
    groups["_unmatched"] = unmatched;
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export async function upsertRule(
  repoFull: string,
  label: string,
  pattern_regex: string,
  sort_order: number,
): Promise<GroupRule | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ repo_full: repoFull, label, pattern_regex, sort_order })
    .select("*")
    .single();

  if (error) {
    console.error("[groupRules] upsertRule error", error.message);
    return null;
  }
  return data as GroupRule;
}

// ---------------------------------------------------------------------------
// Update (patch)
// ---------------------------------------------------------------------------
export async function patchRule(
  id: string,
  patch: Partial<Pick<GroupRule, "label" | "pattern_regex" | "sort_order">>,
): Promise<GroupRule | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.error("[groupRules] patchRule error", error.message);
    return null;
  }
  return data as GroupRule;
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------
export async function deleteRule(id: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) {
    console.error("[groupRules] deleteRule error", error.message);
    return false;
  }
  return true;
}
