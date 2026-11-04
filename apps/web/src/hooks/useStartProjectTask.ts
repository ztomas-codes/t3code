import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";

import { buildProjectTaskInput } from "../lib/projectTask";
import { readT3ProjectFile } from "../lib/t3ProjectFileDefaults";
import { readProject, readThreadShells, useServerConfigs } from "../state/entities";
import { useEnvironmentProviders } from "../state/environments";
import { readUnloadedThreadCount } from "../state/olderSettledShelf";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { vcsEnvironment } from "../state/vcs";
import { buildThreadRouteParams } from "../threadRoutes";
import type { Project } from "../types";

export function useStartProjectTask() {
  const navigate = useNavigate();
  const configs = useServerConfigs();
  const providersByEnvironment = useEnvironmentProviders();
  const loadStatus = useAtomCommand(vcsEnvironment.refreshStatus, {
    reportFailure: false,
  });
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });

  return async (project: Project, prompt: string) => {
    const config = configs.get(project.environmentId);
    if (!config || !readProject({ environmentId: project.environmentId, projectId: project.id })) {
      throw new Error("This project is no longer available on the selected machine.");
    }
    const [status, projectFile] = await Promise.all([
      loadStatus({
        environmentId: project.environmentId,
        input: { cwd: project.workspaceRoot, localOnly: true },
      }),
      readT3ProjectFile(project.environmentId, project.workspaceRoot),
    ]);
    if (status._tag === "Failure") throw squashAtomCommandFailure(status);
    const input = buildProjectTaskInput({
      project,
      config: { ...config, providers: providersByEnvironment.get(project.environmentId) ?? [] },
      projectFile,
      status: status.value,
      projectHasThreads:
        readThreadShells().some(
          (thread) =>
            thread.environmentId === project.environmentId && thread.projectId === project.id,
        ) ||
        readUnloadedThreadCount([{ environmentId: project.environmentId, id: project.id }], []) > 0,
      prompt,
    });
    const result = await startTurn({ environmentId: project.environmentId, input });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(project.environmentId, input.threadId)),
    });
  };
}
