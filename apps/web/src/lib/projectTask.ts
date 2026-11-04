import type { ServerConfig, T3ProjectFile, VcsStatusResult } from "@t3tools/contracts";
import { deriveThreadTitleSeed } from "@t3tools/client-runtime/operations";
import {
  resolveNewThreadEnvMode,
  resolveProjectSettings,
  resolveSendEnvMode,
} from "@t3tools/shared/projectSettings";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";

import { resolveProjectDefaultProviderModelSelection } from "../providerInstances";
import type { Project } from "../types";
import { newMessageId, newThreadId } from "./utils";

export function resolveProjectTaskModel(
  project: Project,
  config: Pick<ServerConfig, "settings" | "providers">,
) {
  const settings = resolveProjectSettings(config.settings, project.id, project).settings;
  return resolveNewThreadModelSelection({
    defaultSelection:
      settings.defaultModelSelection ??
      resolveProjectDefaultProviderModelSelection(config.providers, config.settings, project.id),
    fallbackSelection: config.settings.fallbackModelSelection ?? null,
    providers: config.providers,
    settings: config.settings,
    projectId: project.id,
    now: Date.now(),
  }).selection;
}

export function buildProjectTaskInput(input: {
  readonly project: Project;
  readonly config: Pick<ServerConfig, "settings" | "providers" | "newProjectsRoot">;
  readonly projectFile: T3ProjectFile | null;
  readonly status: Pick<VcsStatusResult, "isRepo" | "refName">;
  readonly projectHasThreads: boolean;
  readonly prompt: string;
}) {
  const { project, config, status } = input;
  const modelSelection = resolveProjectTaskModel(project, config);
  if (!modelSelection)
    throw new Error("Configure a model for this project before starting a task.");
  const resolved = resolveProjectSettings(config.settings, project.id, project, input.projectFile);
  const envMode = resolveSendEnvMode({
    requestedEnvMode: resolveNewThreadEnvMode({
      projectSettings: resolved,
      workspaceRoot: project.workspaceRoot,
      newProjectsRoot: config.newProjectsRoot,
      projectHasThreads: input.projectHasThreads,
    }),
    isGitRepo: status.isRepo,
  });
  const branch = status.refName;
  if (envMode === "worktree" && branch === null) {
    throw new Error(
      "Choose a base branch in the project before starting a task in a new worktree.",
    );
  }
  const text = input.prompt.trim();
  const title = deriveThreadTitleSeed({ text, attachments: [] });
  const runtimeMode = resolved.settings.defaultRuntimeMode;
  const interactionMode = "default" as const;
  const createdAt = new Date().toISOString();
  return {
    threadId: newThreadId(),
    message: { messageId: newMessageId(), role: "user" as const, text, attachments: [] },
    modelSelection,
    titleSeed: title,
    runtimeMode,
    interactionMode,
    bootstrap: {
      createThread: {
        projectId: project.id,
        title,
        modelSelection,
        runtimeMode,
        interactionMode,
        branch,
        worktreePath: null,
        createdAt,
      },
      ...(envMode === "worktree" && branch !== null
        ? {
            prepareWorktree: {
              projectCwd: project.workspaceRoot,
              baseBranch: branch,
              startFromOrigin: resolved.settings.newWorktreesStartFromOrigin,
            },
            runSetupScript: true,
          }
        : {}),
    },
    createdAt,
  };
}
