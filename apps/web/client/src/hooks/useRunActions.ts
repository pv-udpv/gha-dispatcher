import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useGithub } from "@/lib/github-context";
import { apiRequest } from "@/lib/queryClient";
import { ToastAction } from "@/components/ui/toast";
import type { RunActionResponse } from "@gha-dispatcher/shared";

interface RunActionArgs {
  run_id: number;
  html_url: string;
  enable_debug_logging?: boolean;
}

export function useRunActions() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { authHeader } = useGithub();

  // Invalidate runs list and show success / error toast.
  function onSuccess(
    data: RunActionResponse,
    verb: string,
    html_url: string,
  ) {
    if (!data.ok) {
      toast({
        variant: "destructive",
        title: `${verb} failed`,
        description: data.message || "GitHub returned an error.",
      });
      return;
    }
    qc.invalidateQueries({ queryKey: ["/api/runs"] });
    toast({
      title: `${verb} queued — run #${data.run_id} is restarting.`,
      action: React.createElement(
        ToastAction,
        { altText: "View run", onClick: () => window.open(html_url, "_blank", "noopener") },
        "View",
      ),
    });
  }

  function onCancel(data: RunActionResponse, html_url: string) {
    void html_url;
    if (!data.ok) {
      toast({
        variant: "destructive",
        title: "Cancel failed",
        description: data.message || "GitHub returned an error.",
      });
      return;
    }
    qc.invalidateQueries({ queryKey: ["/api/runs"] });
    toast({ title: `Run #${data.run_id} cancelled.` });
  }

  const rerunMutation = useMutation({
    mutationFn: async ({ run_id, html_url, enable_debug_logging }: RunActionArgs) => {
      const res = await apiRequest(
        "POST",
        `/api/runs/${run_id}/rerun`,
        { enable_debug_logging: enable_debug_logging ?? false },
        authHeader(),
      );
      const data: RunActionResponse = await res.json();
      return { data, html_url };
    },
    onSuccess: ({ data, html_url }) => onSuccess(data, "Re-run", html_url),
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Re-run failed", description: e.message }),
  });

  const rerunFailedMutation = useMutation({
    mutationFn: async ({ run_id, html_url, enable_debug_logging }: RunActionArgs) => {
      const res = await apiRequest(
        "POST",
        `/api/runs/${run_id}/rerun-failed-jobs`,
        { enable_debug_logging: enable_debug_logging ?? false },
        authHeader(),
      );
      const data: RunActionResponse = await res.json();
      return { data, html_url };
    },
    onSuccess: ({ data, html_url }) => onSuccess(data, "Re-run (failed jobs)", html_url),
    onError: (e: Error) =>
      toast({
        variant: "destructive",
        title: "Re-run failed jobs failed",
        description: e.message,
      }),
  });

  const cancelMutation = useMutation({
    mutationFn: async ({ run_id, html_url }: RunActionArgs) => {
      const res = await apiRequest(
        "POST",
        `/api/runs/${run_id}/cancel`,
        undefined,
        authHeader(),
      );
      const data: RunActionResponse = await res.json();
      return { data, html_url };
    },
    onSuccess: ({ data, html_url }) => onCancel(data, html_url),
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Cancel failed", description: e.message }),
  });

  return {
    rerun: (args: RunActionArgs) => rerunMutation.mutate(args),
    rerunFailed: (args: RunActionArgs) => rerunFailedMutation.mutate(args),
    cancel: (args: RunActionArgs) => cancelMutation.mutate(args),
    isPending:
      rerunMutation.isPending ||
      rerunFailedMutation.isPending ||
      cancelMutation.isPending,
    rerunStatus: rerunMutation.status,
    rerunFailedStatus: rerunFailedMutation.status,
    cancelStatus: cancelMutation.status,
  };
}
