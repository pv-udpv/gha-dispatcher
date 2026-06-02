/**
 * playbooks.tsx — v7 Playbooks page.
 *
 * Left sidebar: list of playbooks for current repo.
 * Right: DAG canvas for selected playbook.
 * Run panel slides in from the right on active run.
 */
import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Copy, Play, FileDown, Loader2 } from 'lucide-react';
import { TopBar } from '@/components/TopBar';
import { PlaybookCanvas } from '@/components/PlaybookCanvas';
import { PlaybookRunPanel } from '@/components/PlaybookRunPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { useRepo } from '@/lib/repoContext';
import { useGithub } from '@/lib/github-context';
import type { Playbook, PlaybookRun, Dag } from '@gha-dispatcher/shared';

// ---------------------------------------------------------------------------
// Default empty DAG (start + end)
// ---------------------------------------------------------------------------

function emptyDag(): Dag {
  return {
    nodes: [
      { id: 'start-1', kind: 'start', position: { x: 200, y: 50 }, data: {} },
      { id: 'end-1', kind: 'end', position: { x: 200, y: 400 }, data: {} },
    ],
    edges: [],
  };
}

// ---------------------------------------------------------------------------
// PlaybooksPage
// ---------------------------------------------------------------------------

export default function PlaybooksPage() {
  const { currentRepoFull } = useRepo();
  const { pat } = useGithub();
  const { toast } = useToast();

  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Playbook | null>(null);
  const [activeRun, setActiveRun] = useState<{ runId: string; run?: PlaybookRun } | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [newName, setNewName] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ── Fetch list ─────────────────────────────────────────────────────────────
  const fetchPlaybooks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest('GET', `/api/playbooks?repo_full=${encodeURIComponent(currentRepoFull)}`);
      const data = await res.json();
      setPlaybooks(data.playbooks ?? []);
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message ?? 'Failed to load playbooks', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [currentRepoFull, toast]);

  useEffect(() => { fetchPlaybooks(); }, [fetchPlaybooks]);

  // ── Create new ─────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const res = await apiRequest('POST', '/api/playbooks', {
        repo_full: currentRepoFull,
        name,
        dag: emptyDag(),
      });
      const data = await res.json();
      const pb: Playbook = data.playbook;
      setPlaybooks((prev) => [pb, ...prev]);
      setSelected(pb);
      setNewName('');
      setShowNewForm(false);
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message ?? 'Failed to create', variant: 'destructive' });
    }
  };

  // ── Save DAG ───────────────────────────────────────────────────────────────
  const handleSaveDag = useCallback(async (dag: Dag) => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await apiRequest('PUT', `/api/playbooks/${selected.id}`, {
        dag,
        name: selected.name,
        description: selected.description,
        repo_full: selected.repo_full,
      });
      const data = await res.json();
      const updated: Playbook = data.playbook;
      setSelected(updated);
      setPlaybooks((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      toast({ title: 'Saved', description: `Playbook "${selected.name}" saved.` });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message ?? 'Failed to save', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [selected, toast]);

  // ── Duplicate ──────────────────────────────────────────────────────────────
  const handleDuplicate = async (pb: Playbook) => {
    const newPbName = `${pb.name} (copy)`;
    try {
      const res = await apiRequest('POST', '/api/playbooks', {
        repo_full: pb.repo_full,
        name: newPbName,
        description: pb.description,
        dag: pb.dag,
      });
      const data = await res.json();
      const created: Playbook = data.playbook;
      setPlaybooks((prev) => [created, ...prev]);
      toast({ title: 'Duplicated', description: `Created "${newPbName}".` });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message ?? 'Failed to duplicate', variant: 'destructive' });
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async (pb: Playbook) => {
    try {
      await apiRequest('DELETE', `/api/playbooks/${pb.id}`);
      setPlaybooks((prev) => prev.filter((p) => p.id !== pb.id));
      if (selected?.id === pb.id) setSelected(null);
      toast({ title: 'Deleted', description: `"${pb.name}" removed.` });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message ?? 'Failed to delete', variant: 'destructive' });
    }
  };

  // ── Run ────────────────────────────────────────────────────────────────────
  const handleRun = async () => {
    if (!selected || !pat) {
      if (!pat) toast({ title: 'PAT required', description: 'Connect your GitHub PAT first.', variant: 'destructive' });
      return;
    }
    setRunning(true);
    try {
      const res = await apiRequest('POST', `/api/playbooks/${selected.id}/run`, undefined, {
        'x-github-pat': pat,
      });
      const data = await res.json();
      setActiveRun({ runId: data.run_id });
      toast({ title: 'Run started', description: `Run ID: ${data.run_id}` });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message ?? 'Failed to start run', variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  // ── Export PR ──────────────────────────────────────────────────────────────
  const handleExportPr = async () => {
    if (!selected || !pat) {
      if (!pat) toast({ title: 'PAT required', description: 'Connect your GitHub PAT first.', variant: 'destructive' });
      return;
    }
    setExporting(true);
    try {
      const res = await apiRequest('POST', `/api/playbooks/${selected.id}/export-pr`, undefined, {
        'x-github-pat': pat,
      });
      const data = await res.json();
      toast({ title: 'PR opened', description: `PR #${data.pr_number}` });
      window.open(data.pr_url, '_blank');
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message ?? 'Failed to export PR', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <TopBar />

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left sidebar ────────────────────────────────────────────────── */}
        <aside className="w-64 shrink-0 border-r border-border flex flex-col">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <span className="font-semibold text-sm">Playbooks</span>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => setShowNewForm((v) => !v)}
              title="New playbook"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>

          {showNewForm && (
            <div className="px-3 py-2 border-b border-border flex gap-1">
              <Input
                className="h-7 text-xs flex-1"
                placeholder="Playbook name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                autoFocus
              />
              <Button size="sm" className="h-7 text-xs" onClick={handleCreate}>
                Add
              </Button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center p-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && playbooks.length === 0 && (
              <p className="text-xs text-muted-foreground px-3 py-4 text-center">
                No playbooks yet. Click + to create one.
              </p>
            )}
            {playbooks.map((pb) => (
              <div
                key={pb.id}
                className={`group flex items-center gap-1 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors
                  ${selected?.id === pb.id ? 'bg-muted' : ''}`}
                onClick={() => { setSelected(pb); setActiveRun(null); }}
              >
                <span className="flex-1 text-xs truncate">{pb.name}</span>
                <span className="text-[9px] text-muted-foreground font-mono mr-1">v{pb.version}</span>
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => { e.stopPropagation(); handleDuplicate(pb); }}
                  title="Duplicate"
                >
                  <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                </button>
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => { e.stopPropagation(); handleDelete(pb); }}
                  title="Delete"
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground hover:text-red-400" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* ── Canvas area ─────────────────────────────────────────────────── */}
        <div className="flex-1 flex overflow-hidden">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Select a playbook or create a new one.
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Playbook header */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card shrink-0">
                <span className="font-semibold text-sm truncate">{selected.name}</span>
                <span className="text-xs text-muted-foreground font-mono">v{selected.version}</span>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-1" />}
                <div className="ml-auto flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={handleExportPr}
                    disabled={exporting || !pat}
                    title={pat ? 'Export to .github/playbooks/' : 'Connect PAT first'}
                  >
                    {exporting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <FileDown className="h-3 w-3 mr-1" />}
                    Export PR
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs bg-green-700 hover:bg-green-600"
                    onClick={handleRun}
                    disabled={running || !pat}
                    title={pat ? 'Run playbook' : 'Connect PAT first'}
                  >
                    {running ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                    Run
                  </Button>
                </div>
              </div>

              {/* Canvas */}
              <div className="flex-1 overflow-hidden">
                <PlaybookCanvas
                  key={selected.id}
                  initialDag={selected.dag}
                  run={activeRun?.run ?? null}
                  onChange={handleSaveDag}
                />
              </div>
            </div>
          )}

          {/* Run panel */}
          {activeRun && selected && (
            <PlaybookRunPanel
              runId={activeRun.runId}
              dag={selected.dag}
              onClose={() => setActiveRun(null)}
              onRunUpdate={(run) => setActiveRun((prev) => prev ? { ...prev, run } : prev)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
