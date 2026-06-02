/**
 * repoContext.tsx — v4 multi-repo React context.
 *
 * State lives in URL hash (#repo=owner/name&tab=label) + react state.
 * No localStorage.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { apiRequest } from "./queryClient";
import { useGithub } from "./github-context";
import type { RepoSummary } from "@gha-dispatcher/shared";

const DEFAULT_REPO = "pv-udpv/pplx-lab";

// ---------------------------------------------------------------------------
// Hash param helpers
// ---------------------------------------------------------------------------
function parseHash(): Record<string, string> {
  const raw = window.location.hash.replace(/^#/, "");
  const params: Record<string, string> = {};
  for (const part of raw.split("&")) {
    const [k, v] = part.split("=");
    if (k) params[decodeURIComponent(k)] = v ? decodeURIComponent(v) : "";
  }
  return params;
}

function updateHash(updates: Record<string, string | undefined>): void {
  const current = parseHash();
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined) {
      delete current[k];
    } else {
      current[k] = v;
    }
  }
  const parts = Object.entries(current)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  window.location.hash = parts.join("&");
}

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------
interface RepoContextValue {
  currentRepoFull: string;
  setCurrentRepoFull: (repo: string) => void;
  repos: RepoSummary[];
  reposLoading: boolean;
  refreshRepos: () => void;
  currentTab: string;
  setCurrentTab: (tab: string) => void;
}

const RepoContext = createContext<RepoContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export function RepoProvider({ children }: { children: ReactNode }) {
  const { connected, pat } = useGithub();

  // Init from URL hash, fallback to default
  const [currentRepoFull, setCurrentRepoFullState] = useState<string>(() => {
    const h = parseHash();
    const r = h["repo"];
    return r && /^[\w.-]+\/[\w.-]+$/.test(r) ? r : DEFAULT_REPO;
  });

  const [currentTab, setCurrentTabState] = useState<string>(() => {
    return parseHash()["tab"] || "";
  });

  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [reposLoading, setReposLoading] = useState(false);

  // Sync hash → state when hash changes externally
  useEffect(() => {
    function onHashChange() {
      const h = parseHash();
      const r = h["repo"];
      if (r && /^[\w.-]+\/[\w.-]+$/.test(r)) {
        setCurrentRepoFullState(r);
      }
      if (h["tab"]) {
        setCurrentTabState(h["tab"]);
      }
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Fetch repo list when PAT becomes available
  const fetchRepos = useCallback(async () => {
    if (!connected || !pat) return;
    setReposLoading(true);
    try {
      const res = await apiRequest("GET", "/api/repos", undefined, {
        Authorization: `Bearer ${pat}`,
      });
      const data = await res.json();
      const list: RepoSummary[] = data.repos || [];
      setRepos(list);

      // If current repo not in list, reset to first or default
      const found = list.find((r) => r.full_name === currentRepoFull);
      if (!found && list.length > 0) {
        // Keep whatever is in URL; don't auto-reset so user can still use it
      }
    } catch (e) {
      console.error("[RepoContext] failed to fetch repos", e);
    } finally {
      setReposLoading(false);
    }
  }, [connected, pat]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (connected) {
      void fetchRepos();
    } else {
      setRepos([]);
    }
  }, [connected, fetchRepos]);

  // Setter — also updates hash
  const setCurrentRepoFull = useCallback((repo: string) => {
    setCurrentRepoFullState(repo);
    setCurrentTabState(""); // reset tab when repo changes
    updateHash({ repo, tab: undefined });
  }, []);

  const setCurrentTab = useCallback((tab: string) => {
    setCurrentTabState(tab);
    updateHash({ tab: tab || undefined });
  }, []);

  const value: RepoContextValue = {
    currentRepoFull,
    setCurrentRepoFull,
    repos,
    reposLoading,
    refreshRepos: fetchRepos,
    currentTab,
    setCurrentTab,
  };

  return <RepoContext.Provider value={value}>{children}</RepoContext.Provider>;
}

export function useRepo(): RepoContextValue {
  const ctx = useContext(RepoContext);
  if (!ctx) throw new Error("useRepo must be used within RepoProvider");
  return ctx;
}
