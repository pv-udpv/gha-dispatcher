import { Moon, Sun, LogOut } from "lucide-react";
import { Logo } from "./Logo";
import { useGithub } from "@/lib/github-context";
import { useTheme } from "@/lib/theme-context";
import { Button } from "@/components/ui/button";

export function TopBar() {
  const { connected, setPat } = useGithub();
  const { theme, toggle } = useTheme();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-foreground">
          <Logo />
        </span>
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-base font-semibold tracking-tight whitespace-nowrap">
            GHA Dispatcher
          </span>
          <span className="text-muted-foreground hidden sm:inline">·</span>
          <span
            className="font-mono text-sm text-muted-foreground hidden sm:inline truncate"
            data-testid="text-repo"
          >
            pv-udpv/pplx-lab
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div
          className="flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1"
          data-testid="chip-pat-status"
          title={connected ? "GitHub PAT connected" : "No PAT — connect to dispatch"}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              connected ? "bg-primary" : "bg-muted-foreground"
            }`}
            aria-hidden="true"
          />
          <span className="font-mono text-xs text-muted-foreground">
            {connected ? "PAT" : "no PAT"}
          </span>
        </div>

        {connected && (
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setPat(null)}
            aria-label="Disconnect PAT"
            data-testid="button-disconnect-pat"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        )}

        <Button
          size="icon"
          variant="ghost"
          onClick={toggle}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          data-testid="button-theme-toggle"
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </Button>
      </div>
    </header>
  );
}
