// @gha-dispatcher/shared — re-exports all shared types, schemas, and data.

export type {
  DispatchInput,
  WorkflowMeta,
  WorkflowGroupKey,
  WorkflowInventory,
  DispatchPayload,
  RunActor,
  RunSummary,
  DispatchLogRow,
  BranchSummary,
  RerunRequest,
  CancelRequest,
  RunActionResponse,
  // v4 Multi-repo
  RepoFull,
  GroupRule,
  CreateGroupRule,
  PatchGroupRule,
  GroupedWorkflows,
  WorkflowInventoryV2,
  RepoSummary,
  PreviewRulesPayload,
  // v6 Run Intelligence
  SignalKind,
  Signal,
  SuggestedAction,
  InsightAnalysis,
  JobInsight,
  FailureInsight,
  // v7 Playbooks
  NodeKindType,
  DagNode,
  DagEdge,
  Dag,
  Playbook,
  CreatePlaybook,
  NodeState,
  PlaybookRun,
} from "./schemas.js";

export {
  dispatchInputSchema,
  workflowMetaSchema,
  dispatchPayloadSchema,
  rerunRequestSchema,
  cancelRequestSchema,
  runActionResponseSchema,
  // v4 Multi-repo
  repoFullSchema,
  groupRuleSchema,
  createGroupRuleSchema,
  patchGroupRuleSchema,
  workflowInventoryV2Schema,
  previewRulesSchema,
  // v6 Run Intelligence
  signalKindEnum,
  signalSchema,
  suggestedActionSchema,
  insightAnalysisSchema,
  jobInsightSchema,
  failureInsightSchema,
  // v7 Playbooks
  NodeKind,
  dagNodeSchema,
  dagEdgeSchema,
  dagSchema,
  playbookSchema,
  createPlaybookSchema,
  nodeStateSchema,
  playbookRunSchema,
} from "./schemas.js";

export { default as workflowsCatalog } from "./data/workflows.json";
export { default as workflowSchemas } from "./data/workflow-schemas.json";

// Audit/schema bundle types — kept loose because schemas embed Draft 2020-12 docs.
export type AuditFindingKind =
  | "required_without_default"
  | "choice_without_options"
  | "boolean_default_quoted"
  | "undeclared_input_reference";

export interface AuditFinding {
  kind: AuditFindingKind;
  severity: "error" | "warn" | "info";
  input?: string;
  message: string;
}

export interface WorkflowSchemaEntry {
  name: string;
  path: string;
  has_dispatch: boolean;
  declared_inputs: string[];
  input_count: number;
  undeclared_refs: string[];
  findings: AuditFinding[];
  partial_parse: boolean;
  schema: Record<string, unknown> | null;
}

export interface WorkflowSchemasBundle {
  generated_at: string;
  repo: string;
  stats: {
    total_workflow_files: number;
    with_workflow_dispatch: number;
    parse_errors: number;
    total_findings: number;
    findings_by_kind: Record<string, number>;
  };
  workflows: Record<string, WorkflowSchemaEntry>;
}
