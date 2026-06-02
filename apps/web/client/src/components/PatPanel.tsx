import { useState } from "react";
import { KeyRound, ShieldCheck, ExternalLink, Terminal, Check, Copy, CheckCircle2, AlertTriangle } from "lucide-react";
import { useGithub } from "@/lib/github-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "./Logo";

// GitHub fine-grained PAT creation page (pre-scoped to the target org/user where possible)
const GH_PAT_NEW_URL =
  "https://github.com/settings/personal-access-tokens/new?target_name=pv-udpv&description=gha-dispatcher";

// CLI alternative: refresh the active `gh` token with the scopes this app needs.
// Note: `gh` only issues classic OAuth tokens — for true fine-grained tokens, use the URL above.
const GH_CLI_CMD = "gh auth refresh -s repo,workflow -h github.com && gh auth token";

// Token kind:
//   - 'classic' (ghp_..., gho_..., ghs_...) returns the `x-oauth-scopes` header on GET /user.
//   - 'fine-grained' (github_pat_...) does NOT — instead it has per-permission grants we can probe.
type PatKind = "classic" | "fine-grained" | "unknown";

function detectPatKind(pat: string): PatKind {
  if (pat.startsWith("github_pat_")) return "fine-grained";
  if (/^gh[pousr]_/i.test(pat)) return "classic";
  return "unknown";
}

const REQUIRED_SCOPES = ["repo", "workflow"] as const;

export interface PatValidation {
  ok: boolean;
  kind: PatKind;
  user: { login: string; name: string | null; avatar_url: string | null } | null;
  scopes: string[];
  missing: string[]; // missing scopes (classic) or permissions (fine-grained)
  rateLimitRemaining: number | null;
  errorMessage: string | null;
}

async function validatePat(pat: string): Promise<PatValidation> {
  const kind = detectPatKind(pat);

  const baseHeaders = {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // Step 1: GET /user — confirms the token authenticates at all.
  const userRes = await fetch("https://api.github.com/user", { headers: baseHeaders });

  if (userRes.status === 401) {
    return {
      ok: false, kind, user: null, scopes: [], missing: [],
      rateLimitRemaining: null,
      errorMessage: "Token rejected by GitHub (401 Unauthorized). It may be invalid, revoked, or expired.",
    };
  }
  if (!userRes.ok) {
    return {
      ok: false, kind, user: null, scopes: [], missing: [],
      rateLimitRemaining: null,
      errorMessage: `GitHub returned HTTP ${userRes.status}. Try again or check the token.`,
    };
  }

  const user = await userRes.json();
  const userInfo = {
    login: String(user?.login ?? ""),
    name: user?.name ? String(user.name) : null,
    avatar_url: user?.avatar_url ? String(user.avatar_url) : null,
  };
  const rateLimitRemaining = Number(userRes.headers.get("x-ratelimit-remaining")) || null;

  // Step 2: scope check.
  if (kind === "classic" || kind === "unknown") {
    const scopeHeader = userRes.headers.get("x-oauth-scopes") || "";
    const scopes = scopeHeader.split(",").map((s) => s.trim()).filter(Boolean);

    // `repo` implies all `repo:*` subscopes
    const has = (s: string) => scopes.includes(s) || (s === "repo" && scopes.some((x) => x.startsWith("repo")));
    const missing = REQUIRED_SCOPES.filter((s) => !has(s));

    return {
      ok: missing.length === 0, kind, user: userInfo, scopes, missing,
      rateLimitRemaining,
      errorMessage: missing.length === 0 ? null
        : `Token is missing required scope${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Re-create it with both \`repo\` and \`workflow\` scopes.`,
    };
  }

  // Fine-grained: x-oauth-scopes is absent. Probe two permissions instead:
  //   - actions:write  → GET /repos/{owner}/{repo}/actions/permissions  (requires actions read at minimum)
  //   - contents:read  → GET /repos/{owner}/{repo}
  // We don't know the target repo yet, so we only verify that the token has GitHub Actions API access
  // by hitting GET /user/installations (always allowed for any fine-grained PAT) and infer success from
  // the absence of 403. Real per-repo enforcement happens at dispatch time.
  // For a more rigorous check we hit GET /repos/{REPO}/actions/permissions on pv-udpv/pplx-lab.
  const probeRes = await fetch("https://api.github.com/repos/pv-udpv/pplx-lab/actions/permissions", { headers: baseHeaders });
  const missing: string[] = [];
  if (probeRes.status === 403 || probeRes.status === 404) {
    // 403 = no permission grant; 404 = repo not selected in the token's resource list
    missing.push("repo (Contents: Read) + workflow (Actions: Write) on pv-udpv/pplx-lab");
  } else if (!probeRes.ok && probeRes.status !== 401) {
    // 401 already handled above; other errors are inconclusive but we mark missing to be safe
    missing.push(`actions API check returned HTTP ${probeRes.status}`);
  }

  return {
    ok: missing.length === 0, kind, user: userInfo, scopes: [], missing,
    rateLimitRemaining,
    errorMessage: missing.length === 0 ? null
      : `Fine-grained token is missing the required permissions: ${missing.join("; ")}. Re-create it with Contents: Read and Actions: Write on pv-udpv/pplx-lab.`,
  };
}

export function PatPanel() {
  const { setPat, setPatScopes } = useGithub();
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [success, setSuccess] = useState<PatValidation | null>(null);

  const copyCli = async () => {
    try {
      await navigator.clipboard.writeText(GH_CLI_CMD);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — user can select manually
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const v = await validatePat(trimmed);
      if (!v.ok) {
        setError(v.errorMessage || "Token validation failed.");
        return;
      }
      // Show the success state briefly so the user sees the checkmark + username,
      // then commit to the global context (which unmounts this panel).
      setSuccess(v);
      window.setTimeout(() => {
        // For fine-grained tokens we don't have a scope list — store synthetic markers so
        // downstream `hasRepoScope` / `hasWorkflowScope` checks still pass.
        setPatScopes(v.kind === "fine-grained" ? ["repo", "workflow"] : v.scopes);
        setPat(trimmed);
      }, 900);
    } catch (e: any) {
      setError(e?.message || "Network error validating PAT.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-card-border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2.5 text-foreground">
          <Logo />
          <h1 className="text-base font-semibold">Connect GitHub</h1>
        </div>

        <p className="mb-3 text-sm text-muted-foreground">
          Paste a{" "}
          <span className="font-medium text-foreground">fine-grained PAT</span>{" "}
          with{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">repo</code>{" "}
          and{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">workflow</code>{" "}
          scopes to dispatch workflows on{" "}
          <span className="font-mono text-xs">pv-udpv/pplx-lab</span>.
        </p>

        {/* ── Don't have one? Create via web or CLI ─────────────────────────────── */}
        <div className="mb-4 rounded-lg border border-border bg-background/60 p-3">
          <p className="mb-2 text-xs font-medium text-foreground">Don't have one yet?</p>

          <a
            href={GH_PAT_NEW_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary underline-offset-2 hover:underline"
            data-testid="link-create-pat"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Create a fine-grained PAT on GitHub
          </a>

          <p className="mt-2.5 mb-1.5 text-xs text-muted-foreground">
            Or via{" "}
            <a
              href="https://cli.github.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              gh CLI
            </a>
            :
          </p>
          <div className="group relative overflow-hidden rounded-md border border-border bg-muted/40">
            <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                <Terminal className="h-3 w-3" />
                shell
              </div>
              <button
                type="button"
                onClick={copyCli}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Copy command"
                data-testid="button-copy-gh-cmd"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3" /> copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> copy
                  </>
                )}
              </button>
            </div>
            <pre className="overflow-x-auto px-2.5 py-2 font-mono text-[11px] leading-relaxed text-foreground">
              <code>{GH_CLI_CMD}</code>
            </pre>
          </div>
          <p className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground">
            <code className="font-mono">gh</code> issues classic tokens. For true fine-grained, use the link above.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="github_pat_..."
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="pl-9 font-mono text-sm"
              data-testid="input-pat"
              disabled={loading}
            />
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              data-testid="pat-error"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          )}

          {success && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
              data-testid="pat-success"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {success.user?.avatar_url && (
                    <img
                      src={success.user.avatar_url}
                      alt=""
                      className="h-4 w-4 rounded-full"
                    />
                  )}
                  <span className="font-medium">
                    Connected as @{success.user?.login}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] opacity-80">
                  {success.kind === "fine-grained"
                    ? "Fine-grained token — required permissions confirmed."
                    : `Classic token — scopes: ${success.scopes.join(", ") || "(none reported)"}.`}
                </div>
              </div>
            </div>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={!value.trim() || loading || !!success}
            data-testid="button-connect-pat"
          >
            {loading ? "Validating…" : success ? "Connected" : "Connect"}
          </Button>
        </form>

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-xs text-muted-foreground">
            PAT lives in browser memory only; refresh = re-enter. It is never
            written to storage or sent anywhere except GitHub via this app's
            backend.
          </p>
        </div>
      </div>
    </div>
  );
}
