import { useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { useGithub } from "@/lib/github-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "./Logo";

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

        <p className="mb-4 text-sm text-muted-foreground">
          Paste a{" "}
          <span className="font-medium text-foreground">fine-grained PAT</span>{" "}
          with{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">repo</code>{" "}
          and{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">workflow</code>{" "}
          scopes to dispatch workflows on{" "}
          <span className="font-mono text-xs">pv-udpv/pplx-lab</span>.
        </p>

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
