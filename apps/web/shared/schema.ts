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
