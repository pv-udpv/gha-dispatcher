import { createContext, useContext, useState, type ReactNode } from "react";
import type { WorkflowMeta } from "@gha-dispatcher/shared";

export type EditorSource = "pplx-lab" | "gha-dispatcher";

// In-memory only — never persisted. Refresh = re-enter the PAT.
interface GithubContextValue {
  pat: string | null;
  connected: boolean;
  setPat: (pat: string | null) => void;
  authHeader: () => Record<string, string>;
  patScopes: string[] | null;
  setPatScopes: (scopes: string[] | null) => void;
  hasRepoScope: boolean;
  // Editor state
  editingWorkflow: WorkflowMeta | null;
  setEditingWorkflow: (w: WorkflowMeta | null) => void;
  editorSource: EditorSource;
  setEditorSource: (s: EditorSource) => void;
}

const GithubContext = createContext<GithubContextValue | null>(null);

export function GithubProvider({ children }: { children: ReactNode }) {
  const [pat, setPatState] = useState<string | null>(null);
  const [patScopes, setPatScopes] = useState<string[] | null>(null);
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowMeta | null>(null);
  const [editorSource, setEditorSource] = useState<EditorSource>("pplx-lab");

  const hasRepoScope = patScopes
    ? patScopes.some((s) => s === "repo" || s === "public_repo")
    : true; // assume ok if not yet checked

  const value: GithubContextValue = {
    pat,
    connected: !!pat,
    setPat: (next) => {
      setPatState(next ? next.trim() : null);
      if (!next) setPatScopes(null);
    },
    authHeader: (): Record<string, string> =>
      pat ? { Authorization: `Bearer ${pat}` } : {},
    patScopes,
    setPatScopes,
    hasRepoScope,
    editingWorkflow,
    setEditingWorkflow,
    editorSource,
    setEditorSource,
  };

  return <GithubContext.Provider value={value}>{children}</GithubContext.Provider>;
}

export function useGithub(): GithubContextValue {
  const ctx = useContext(GithubContext);
  if (!ctx) throw new Error("useGithub must be used within GithubProvider");
  return ctx;
}
