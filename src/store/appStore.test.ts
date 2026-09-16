import { beforeEach, describe, expect, it, vi } from "vitest";
import { desktop } from "../lib/desktop";
import { useAppStore } from "./appStore";
import { newItem, newView, type Workspace } from "../contracts/workspace";

const workspace = (): Workspace => ({
  revision: 1,
  collections: [
    {
      id: "library",
      name: "资料库",
      icon: "▦",
      description: "",
      properties: [],
    },
  ],
  items: [newItem("library")],
  views: [newView("library")],
});
describe("workspace persistence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({
      workspace: workspace(),
      scanning: false,
      saving: false,
      vaults: [],
      toast: null,
    });
  });
  it("serializes rapid changes against the latest committed revision", async () => {
    const writes: Workspace[] = [];
    vi.spyOn(desktop, "saveWorkspace").mockImplementation(async (next) => {
      writes.push(structuredClone(next));
      return { ...next, revision: next.revision + 1 };
    });
    const first = useAppStore.getState().mutate((w) => {
      w.items[0].title = "新标题";
    });
    const second = useAppStore.getState().mutate((w) => {
      w.items[0].favorite = true;
    });
    await Promise.all([first, second]);
    expect(writes.map((w) => w.revision)).toEqual([1, 2]);
    expect(useAppStore.getState().workspace?.items[0]).toMatchObject({
      title: "新标题",
      favorite: true,
    });
  });
  it("preserves committed data when persistence rejects a conflicting draft", async () => {
    const previous = structuredClone(useAppStore.getState().workspace);
    vi.spyOn(desktop, "saveWorkspace").mockRejectedValue(
      new Error("WORKSPACE_CONFLICT"),
    );
    await expect(
      useAppStore.getState().mutate((w) => {
        w.items[0].body = "未保存正文";
      }),
    ).rejects.toThrow("WORKSPACE_CONFLICT");
    expect(useAppStore.getState().workspace).toEqual(previous);
    expect(useAppStore.getState().saving).toBe(false);
    expect(useAppStore.getState().toast?.tone).toBe("danger");
  });
});
