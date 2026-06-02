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
} from "./schemas.js";

export { default as workflowsCatalog } from "./data/workflows.json";
