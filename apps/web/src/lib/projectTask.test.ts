import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import type { Project } from "../types";
import { buildProjectTaskInput } from "./projectTask";

it("starts a fresh thread with the destination project's model, permissions and workspace defaults", () => {
  const modelSelection = {
    instanceId: ProviderInstanceId.make("codex"),
    model: "project-model",
  };
  const project: Project = {
    id: ProjectId.make("remote-project"),
    environmentId: EnvironmentId.make("remote"),
    title: "Acme",
    workspaceRoot: "/srv/acme",
    defaultModelSelection: modelSelection,
    scripts: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const config = {
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      defaultModelSelection: { instanceId: ProviderInstanceId.make("other"), model: "other-model" },
      projectSettingsOverrides: {
        [project.id]: {
          defaultRuntimeMode: "approval-required" as const,
          defaultModelSelection: modelSelection,
        },
      },
      newWorktreesStartFromOrigin: true,
    },
    providers: [],
  };
  const request = {
    project,
    config,
    status: { isRepo: true, refName: "feature/base" },
    projectFile: { defaultThreadEnvMode: "worktree" as const },
    projectHasThreads: true,
    prompt: "  Fix the report  ",
  };
  const turn = buildProjectTaskInput(request);
  expect(turn).toMatchObject({
    modelSelection,
    runtimeMode: "approval-required",
    interactionMode: "default",
    message: { role: "user", text: "Fix the report", attachments: [] },
    bootstrap: {
      createThread: {
        projectId: project.id,
        modelSelection,
        runtimeMode: "approval-required",
        branch: "feature/base",
        worktreePath: null,
      },
      prepareWorktree: {
        projectCwd: "/srv/acme",
        baseBranch: "feature/base",
        startFromOrigin: true,
      },
      runSetupScript: true,
    },
  });
  expect(buildProjectTaskInput(request).threadId).not.toBe(turn.threadId);

  const checkout = buildProjectTaskInput({
    ...request,
    projectFile: { defaultThreadEnvMode: "local" },
  });
  expect(checkout.bootstrap).not.toHaveProperty("prepareWorktree");
  const nonRepository = buildProjectTaskInput({
    ...request,
    status: { isRepo: false, refName: null },
  });
  expect(nonRepository.bootstrap).not.toHaveProperty("prepareWorktree");
  expect(() =>
    buildProjectTaskInput({ ...request, status: { isRepo: true, refName: null } }),
  ).toThrow("base branch");
  expect(() =>
    buildProjectTaskInput({
      ...request,
      project: { ...project, defaultModelSelection: null },
      config: { ...config, settings: DEFAULT_SERVER_SETTINGS },
    }),
  ).toThrow("Configure a model");
});
