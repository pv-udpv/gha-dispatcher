import { z } from "zod";

// ---------------------------------------------------------------------------
// GHA Dispatcher shared types + Zod schemas.
// No SQLite tables — persistence lives in Supabase (gha_dispatcher schema).
// ---------------------------------------------------------------------------

// A single workflow_dispatch input as captured in the bundled inventory.
export const dispatchInputSchema = z.object({
  name: z.string(),
  description: z.string().default(""),
  type: z.enum(["string", "boolean", "choice", "environment", "number"]).catch("string"),
  required: z.boolean().default(false),
  // GitHub stores defaults as strings (e.g. "True"/"False" for booleans).
  default: z.union([z.string(), z.boolean()]).optional().nullable(),
  options: z.array(z.string()).default([]),
});
export type DispatchInput = z.infer<typeof dispatchInputSchema>;

// A workflow as bundled in workflows.json.
export const workflowMetaSchema = z.object({
  name: z.string(),
  path: z.string(),
  state: z.string().default("active"),
  dispatch_inputs: z.array(dispatchInputSchema).default([]),
  has_dispatch: z.boolean().default(true),
});
export type WorkflowMeta = z.infer<typeof workflowMetaSchema>;

export type WorkflowGroupKey = "pv-cargo" | "pv-sandbox" | "web";

export interface WorkflowInventory {
  owner: string;
  repo: string;
  default_branch: string;
  groups: Record<WorkflowGroupKey, WorkflowMeta[]>;
}

// Payload the client sends to POST /api/dispatch.
export const dispatchPayloadSchema = z.object({
  workflow_file: z
    .string()
    .min(1)
    .regex(/^[\w.\-]+\.ya?ml$/, "workflow_file must be a .yml/.yaml basename"),
  workflow_name: z.string().optional().default(""),
  group: z.string().optional().default(""),
  ref: z.string().min(1).default("master"),
  environment: z.string().optional().default(""),
  inputs: z.record(z.union([z.string(), z.boolean(), z.number()])).default({}),
  // v4: optional repo override. Falls back to server REPO env var if omitted.
  repo_full: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/)
    .optional(),
});
export type DispatchPayload = z.infer<typeof dispatchPayloadSchema>;

// Slimmed GitHub Actions run shape returned by GET /api/runs.
export interface RunActor {
  login: string;
  avatar_url: string;
}
export interface RunSummary {
  id: number;
  name: string;
  head_branch: string;
  status: string | null; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | null
  actor: RunActor | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  run_started_at: string | null;
}

// A row in gha_dispatcher.dispatch_log.
export interface DispatchLogRow {
  id: number;
  user_login: string | null;
  repo_slug: string | null;
  repo_full: string | null;
  workflow_id: string | null;
  workflow_name: string | null;
  ref: string | null;
  environment: string | null;
  inputs: Record<string, unknown> | null;
  run_id: number | null;
  run_url: string | null;
  status: string;
  error: string | null;
  created_at: string;
}

// Branch query response.
export interface BranchSummary {
  name: string;
}

// ---------------------------------------------------------------------------
// v4 Multi-repo types
// ---------------------------------------------------------------------------

// Validated repo full name (owner/repo).
export const repoFullSchema = z
  .string()
  .regex(/^[\w.-]+\/[\w.-]+$/, "repo_full must be owner/repo");
export type RepoFull = z.infer<typeof repoFullSchema>;

// A row in gha_dispatcher.group_rules.
export const groupRuleSchema = z.object({
  id: z.string().uuid(),
  repo_full: repoFullSchema,
  label: z.string().min(1),
  pattern_regex: z.string().min(1),
  sort_order: z.number().int().default(100),
  created_at: z.string().optional(),
});
export type GroupRule = z.infer<typeof groupRuleSchema>;

// Input schema for creating a new group rule.
export const createGroupRuleSchema = z.object({
  label: z.string().min(1),
  pattern_regex: z.string().min(1),
  sort_order: z.number().int().optional().default(100),
});
export type CreateGroupRule = z.infer<typeof createGroupRuleSchema>;

// Input schema for patching an existing rule.
export const patchGroupRuleSchema = z.object({
  label: z.string().min(1).optional(),
  pattern_regex: z.string().min(1).optional(),
  sort_order: z.number().int().optional(),
});
export type PatchGroupRule = z.infer<typeof patchGroupRuleSchema>;

// Groups map: label → workflow list.
export type GroupedWorkflows = Record<string, WorkflowMeta[]>;

// v2 inventory — per-repo, with dynamic groups from rules.
export const workflowInventoryV2Schema = z.object({
  repo_full: repoFullSchema,
  fetched_at: z.string(),
  default_branch: z.string().default("main"),
  workflows: z.array(workflowMetaSchema),
  groups: z.record(z.array(workflowMetaSchema)),
});
export type WorkflowInventoryV2 = z.infer<typeof workflowInventoryV2Schema>;

// Repo summary returned by GET /api/repos.
export interface RepoSummary {
  full_name: string;
  default_branch: string;
  private: boolean;
}

// Preview request body for POST /api/repos/:owner/:repo/rules/preview
export const previewRulesSchema = z.object({
  rules: z.array(groupRuleSchema),
});
export type PreviewRulesPayload = z.infer<typeof previewRulesSchema>;

// ---------------------------------------------------------------------------
// Run action schemas (rerun / cancel)
// ---------------------------------------------------------------------------

export const rerunRequestSchema = z.object({
  enable_debug_logging: z.boolean().optional().default(false),
});
export type RerunRequest = z.infer<typeof rerunRequestSchema>;

export const cancelRequestSchema = z.object({});
export type CancelRequest = z.infer<typeof cancelRequestSchema>;

export const runActionResponseSchema = z.object({
  ok: z.boolean(),
  run_id: z.number().optional(),
  status: z.number().optional(),
  message: z.string().optional(),
});
export type RunActionResponse = z.infer<typeof runActionResponseSchema>;
