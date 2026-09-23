import React, { useEffect, useRef, useState } from "react";
import {
  CreatePlanDialog,
  DirtyRepoDialog,
  AUTO_PROJECT,
  type CreatePlanUpload,
  type SyncRepoPolicy,
} from "@ivy-interactive/components/dialogs";
import type { ProjectSummary, RepoStatus, StartJobArgs, StartJobResponse } from "../types/api";
import { describeBridgeError } from "../types/api";
import { bridge } from "../api/bridge";
import { jobsStore } from "../state/jobsStore";
import { uiStore } from "../state/uiStore";
import { NEW_CHAT_TITLE } from "../state/chatLauncher";
import { CODING_AGENTS } from "./settings/codingAgents";
import { newUploadSessionId } from "./dialogs/useDialogAttachments";

interface NewPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: ProjectSummary[];
  onJobStarted?: (res: StartJobResponse) => void;
  /** Opens project settings, for the picker's "+ Add New Project" entry. Omitted, the entry is not offered. */
  onAddProject?: () => void;
  initialTitle?: string;
  initialDescription?: string;
  initialProject?: string;
  initialSourceUrl?: string;
}

/**
 * V1 `CreatePlanDialog.BuildAgentPrompt`: the seed for "Chat with <agent>". Sent to the agent as the
 * conversation's first message without the operator editing it, so it stays English - it is text
 * Tendril sends on the operator's behalf, not copy on screen.
 */
export function buildCreatePlanAgentPrompt(project: string, description: string): string {
  const trimmed = description.trim();
  if (!project || project === AUTO_PROJECT) {
    return `I want to discuss creating a Tendril plan from this description: "${trimmed}". Determine the most appropriate project for it yourself.`;
  }
  return `I want to discuss creating a Tendril plan for the project ${project} from this description: "${trimmed}"`;
}

/** V1 `AgentBranding.For(settings.CodingAgent).Label`, for "Chat with <agent>". */
function agentLabelFor(agentId: string | undefined): string {
  const id = (agentId ?? "").trim() || "claude";
  return CODING_AGENTS.find((agent) => agent.id === id)?.label ?? id;
}

const combine = (title: string, description: string): string =>
  title ? (description ? `${title}\n\n${description}` : title) : description;

/**
 * The connected half of `CreatePlanDialog`, and V1's `CreatePlanDialogLauncher` around it.
 *
 * The dialog owns the picker, the text and `ContentInput`'s events. What lives here is everything
 * that reaches the daemon:
 *
 * - **The dispatch.** CreatePlan with `priority: 0` (V1's dialog has no priority field), the
 *   caller's `sourceUrl`, and the upload session when anything was attached.
 * - **The dirty-repo preflight** (V1 `UsePreflightCheck`): for a named project, each repo's
 *   uncommitted work is read before the job starts, and a dirty one swaps the dialog for
 *   `DirtyRepoDialog` - "Create Without Syncing", or *Sync Repos*, which chains one SyncRepo job per
 *   dirty repo and has CreatePlan wait for them (`waitForJobs`), as V1's `LaunchWithSync` does.
 *   "Auto" has no repos to check until the agent has picked a project, which is V1's behaviour too
 *   (`GetProject("Auto")` is null). A preflight that fails to answer never blocks the plan.
 * - **Attachments.** `ContentInput` hands over bytes; they are staged under this opening's upload
 *   session (`Attachments/<id>/`), which CreatePlan's `uploadSessionId` promotes into the plan folder.
 * - **Continue in chat.** V1's split-button entry: a new chat seeded with `BuildAgentPrompt`.
 */
export const NewPlanModal: React.FC<NewPlanModalProps> = ({
  isOpen,
  onClose,
  projects,
  onJobStarted,
  onAddProject,
  initialTitle = "",
  initialDescription = "",
  initialProject = "",
  initialSourceUrl = "",
}) => {
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirtyRepos, setDirtyRepos] = useState<RepoStatus[] | null>(null);
  const [pending, setPending] = useState<StartJobArgs | null>(null);
  const [agentLabel, setAgentLabel] = useState<string | undefined>(undefined);
  /**
   * What was submitted, so the dialog comes back with it when the dirty-repo step hands control back
   * after a failed dispatch: the dialog is unmounted while `DirtyRepoDialog` shows, and would
   * otherwise re-seed from the caller's prefill.
   */
  const [draft, setDraft] = useState<{ description: string; project: string } | null>(null);
  const uploadSessionId = useRef(newUploadSessionId());
  const uploaded = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    uploadSessionId.current = newUploadSessionId();
    uploaded.current = false;
    setIsBusy(false);
    setError(null);
    setDirtyRepos(null);
    setPending(null);
    setDraft(null);
    let cancelled = false;
    void Promise.resolve()
      .then(() => bridge.getConfig())
      .then((config) => {
        if (!cancelled) setAgentLabel(agentLabelFor(config?.codingAgent));
      })
      .catch(() => {
        if (!cancelled) setAgentLabel(agentLabelFor(undefined));
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const finish = () => {
    setIsBusy(false);
    setDirtyRepos(null);
    setPending(null);
    onClose();
  };

  /** V1 `LaunchCreatePlan` / the tail of `LaunchWithSync`. */
  const launch = async (args: StartJobArgs, waitForJobs: string[] = []) => {
    setIsBusy(true);
    setError(null);
    try {
      const res = await jobsStore.startJob({
        ...args,
        ...(waitForJobs.length > 0 ? { waitForJobs } : {}),
      });
      onJobStarted?.(res);
      finish();
    } catch (err) {
      // Back to the dialog, carrying the failure, with the operator's text still in it.
      setIsBusy(false);
      setDirtyRepos(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSubmit = async (description: string, project: string) => {
    if (isBusy) return;
    setDraft({ description, project });
    const args: StartJobArgs = {
      type: "CreatePlan",
      project,
      description,
      priority: 0,
      sourceUrl: initialSourceUrl.trim() || undefined,
      ...(uploaded.current ? { uploadSessionId: uploadSessionId.current } : {}),
    };

    if (project && project !== AUTO_PROJECT) {
      setIsBusy(true);
      setError(null);
      let dirty: RepoStatus[] = [];
      try {
        const status = await bridge.getProjectRepoStatus(project);
        dirty = Array.isArray(status) ? status.filter((repo) => repo.isDirty) : [];
      } catch {
        // Unknown is not dirty: the guard never blocks plan creation on an unreadable repo.
      }
      if (dirty.length > 0) {
        setIsBusy(false);
        setPending(args);
        setDirtyRepos(dirty);
        return;
      }
    }
    await launch(args);
  };

  /** V1 `LaunchWithSync`: a SyncRepo per dirty repo, and CreatePlan waiting behind all of them. */
  const handleSyncRepos = async (policy: SyncRepoPolicy) => {
    if (!pending || !dirtyRepos) return;
    setIsBusy(true);
    const syncJobIds: string[] = [];
    try {
      for (const repo of dirtyRepos) {
        const res = await jobsStore.startJob({
          type: "SyncRepo",
          repoPath: repo.path,
          baseBranch: repo.baseBranch ?? "main",
          untrackedChangesPolicy: policy,
        });
        syncJobIds.push(res.jobId);
      }
    } catch (err) {
      setIsBusy(false);
      setDirtyRepos(null);
      setError(describeBridgeError(err));
      return;
    }
    await launch(pending, syncJobIds);
  };

  const handleUploadFile = async (file: CreatePlanUpload): Promise<string> => {
    const staged = await bridge.uploadAttachmentBytes(
      file.name,
      file.base64Data,
      uploadSessionId.current,
    );
    uploaded.current = true;
    return staged.path;
  };

  /** V1 `OnMenuAction` → `ChatLauncher.Open(nav, config, BuildAgentPrompt(...))`. */
  const handleContinueInChat = (description: string, project: string) => {
    const prompt = buildCreatePlanAgentPrompt(project, description);
    onClose();
    uiStore.navigate({ appId: "chat" });
    void import("../state/chatStore").then(async ({ chatStore }) => {
      try {
        await chatStore.createSession(NEW_CHAT_TITLE);
        await chatStore.sendMessage(prompt);
      } catch {
        // The chat view reports its own failures through the store's `error`.
      }
    });
  };

  if (!isOpen) return null;

  if (dirtyRepos && pending) {
    return (
      <DirtyRepoDialog
        isOpen
        purpose="createPlan"
        dirtyRepos={dirtyRepos}
        onClose={() => {
          // V1 drops the pending job with the dialog: Cancel means "do not create it".
          setDirtyRepos(null);
          setPending(null);
          onClose();
        }}
        onProceed={() => void launch(pending)}
        onSyncRepos={(policy) => void handleSyncRepos(policy)}
      />
    );
  }

  return (
    <CreatePlanDialog
      isOpen={isOpen}
      onClose={onClose}
      projects={projects.map((p) => p.name)}
      initialProject={draft?.project ?? initialProject}
      initialDescription={draft?.description ?? combine(initialTitle, initialDescription)}
      onSubmit={handleSubmit}
      onAddProject={onAddProject}
      agentLabel={agentLabel}
      onContinueInChat={handleContinueInChat}
      onUploadFile={handleUploadFile}
      isBusy={isBusy}
      error={error}
    />
  );
};
