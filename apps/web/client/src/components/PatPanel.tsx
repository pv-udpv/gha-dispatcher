import { useState } from "react";
import { KeyRound, ShieldCheck, ExternalLink, Terminal, Check, Copy } from "lucide-react";
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

async function checkPatScopes(
  pat: string,
): Promise<{ ok: boolean; scopes: string[] }> {
  // Validate via GET /user, also check x-oauth-scopes header
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) return { ok: false, scopes: [] };

  const scopeHeader = res.headers.get("x-oauth-scopes") || "";
  const scopes = scopeHeader
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return { ok: true, scopes };
}

export function PatPanel() {
  const { setPat, setPatScopes } = useGithub();
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

    try {
      const { ok, scopes } = await checkPatScopes(trimmed);
      if (!ok) {
        setError("Invalid PAT or GitHub returned an error. Check the token and try again.");
        return;
      }
      setPatScopes(scopes);
      setPat(trimmed);
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
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={!value.trim() || loading}
            data-testid="button-connect-pat"
          >
            {loading ? "Validating…" : "Connect"}
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
