import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { openCommandPalette } from "../commandPaletteBus";
import { useCommandPaletteStore } from "../commandPaletteStore";
import { makeThreadFixture } from "../test-fixtures";
import type { Project, Thread } from "../types";
import { CommandPalette } from "./CommandPalette";

const entities = vi.hoisted(() => ({
  projects: [] as ReadonlyArray<Project>,
  threads: [] as ReadonlyArray<Thread>,
  startTask: vi.fn(async (_project: Project, _prompt: string) => {}),
}));
vi.mock("../hooks/useStartProjectTask", () => ({ useStartProjectTask: () => entities.startTask }));
vi.mock("../state/environments", async (original) => ({
  ...(await original<typeof import("../state/environments")>()),
  useEnvironments: () => ({
    environments: ["local", "remote"].map((id) => ({
      environmentId: id,
      label: id === "local" ? "Laptop" : "Server",
      connection: { phase: "connected" },
      entry: { target: { _tag: "PrimaryConnectionTarget" } },
      serverConfig: null,
    })),
  }),
}));
vi.mock("../state/session", async (original) => ({
  ...(await original<typeof import("../state/session")>()),
  readEnvironmentScope: () => true,
}));
vi.mock("../state/entities", async (original) => ({
  ...(await original<typeof import("../state/entities")>()),
  useProjects: () => entities.projects,
  useVisibleThreadShells: () => entities.threads,
}));

function setup(state: { projects?: ReadonlyArray<Project>; threads?: ReadonlyArray<Thread> } = {}) {
  useCommandPaletteStore.setState(useCommandPaletteStore.getInitialState(), true);
  entities.projects = state.projects ?? [];
  entities.threads = state.threads ?? [];
  entities.startTask.mockReset();
}

describe("CommandPalette open intents", () => {
  it("opens New thread in... with focus in the search input, not the Back button", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ open: "new-thread-in" });

    await expect.element(page.getByPlaceholder("Search...")).toHaveFocus();
  });

  it("opens a search intent with its query in the focused input", async () => {
    setup();
    await using _screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ query: "acme" });

    const input = page.getByPlaceholder("Search commands, projects, and threads...");
    await expect.element(input).toHaveFocus();
    await expect.element(input).toHaveValue("acme");
  });

  it("opens a searched project's latest listed thread, not a newer subagent", async () => {
    const environmentId = EnvironmentId.make("local");
    const projectId = ProjectId.make("acme");
    const parentId = ThreadId.make("parent");
    setup({
      projects: [
        {
          id: projectId,
          environmentId,
          title: "Acme",
          workspaceRoot: "/work/acme",
          repositoryIdentity: null,
          defaultModelSelection: null,
          createdAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-01T00:00:00.000Z",
          scripts: [],
        },
      ],
      threads: [
        makeThreadFixture({
          id: parentId,
          environmentId,
          projectId,
          latestUserMessageAt: "2026-03-02T00:00:00.000Z",
        }),
        makeThreadFixture({
          id: ThreadId.make("subagent"),
          environmentId,
          projectId,
          updatedAt: "2026-03-03T00:00:00.000Z",
          lineage: {
            rootThreadId: parentId,
            parentThreadId: parentId,
            relationshipToParent: "subagent",
          },
        }),
      ],
    });
    await using screen = await render(<CommandPalette>{null}</CommandPalette>);

    openCommandPalette({ query: "Acme" });
    await page.getByRole("option", { name: /Acme/ }).first().click();

    await vi.waitFor(() => expect(screen.router?.state.location.pathname).toBe("/local/parent"));
  });
});

it("keeps new task last and preserves its prompt through project and machine selection", async () => {
  const project: Project = {
    id: ProjectId.make("local-acme"),
    environmentId: EnvironmentId.make("local"),
    title: "Acme",
    workspaceRoot: "/work/acme",
    repositoryIdentity: {
      canonicalKey: "github.com/acme/app",
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: "https://github.com/acme/app.git",
      },
    },
    defaultModelSelection: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    scripts: [],
  };
  const remote = {
    ...project,
    environmentId: EnvironmentId.make("remote"),
    id: ProjectId.make("remote-acme"),
    workspaceRoot: "/srv/acme",
  };
  setup({
    projects: [
      project,
      { ...project, id: ProjectId.make("another-checkout"), workspaceRoot: "/work/another-acme" },
      remote,
    ],
  });
  await using _screen = await render(<CommandPalette>{null}</CommandPalette>);
  openCommandPalette({ query: "usage" });
  await expect
    .element(page.getByRole("option").last())
    .toHaveTextContent("New task: usageChoose a project and send in a new thread");
  await page.getByRole("option", { name: /New task: usage/ }).click();
  await expect.element(page.getByPlaceholder("Choose a project...")).toHaveFocus();
  await page.getByRole("combobox").fill("/srv/acme");
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByPlaceholder("Choose a machine...")).toHaveFocus();
  expect(page.getByRole("option").elements()).toHaveLength(2);
  expect(entities.startTask).not.toHaveBeenCalled();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByPlaceholder("Choose a project...")).toHaveValue("/srv/acme");
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("combobox")).toHaveValue("usage");
  await page.getByRole("option", { name: /New task: usage/ }).click();
  await userEvent.keyboard("{Enter}");
  await page.getByRole("combobox").fill("Server");
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(entities.startTask).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining(remote),
      "usage",
    ),
  );
  await expect.element(page.getByRole("combobox")).not.toBeInTheDocument();
});

it("skips machine selection for a project on one machine and retains the task on failure", async () => {
  const project: Project = {
    id: ProjectId.make("solo"),
    environmentId: EnvironmentId.make("local"),
    title: "Solo",
    workspaceRoot: "/work/solo",
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  };
  setup({ projects: [project] });
  entities.startTask.mockRejectedValueOnce(new Error("Machine disconnected"));
  await using _screen = await render(<CommandPalette>{null}</CommandPalette>);
  openCommandPalette({ query: "Fix the report" });
  await page.getByRole("option", { name: /New task: Fix the report/ }).click();
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() =>
    expect(entities.startTask).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: project.id }),
      "Fix the report",
    ),
  );
  await expect.element(page.getByPlaceholder("Choose a project...")).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("combobox")).toHaveValue("Fix the report");
});
