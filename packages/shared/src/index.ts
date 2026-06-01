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
} from "./schemas.js";

export {
  dispatchInputSchema,
  workflowMetaSchema,
  dispatchPayloadSchema,
  rerunRequestSchema,
  cancelRequestSchema,
  runActionResponseSchema,
} from "./schemas.js";

export { default as workflowsCatalog } from "./data/workflows.json";
