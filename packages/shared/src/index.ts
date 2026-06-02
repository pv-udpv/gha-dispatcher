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
