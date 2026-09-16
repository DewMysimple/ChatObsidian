import { describe, expect, it } from "vitest";
import { newItem, newView } from "../contracts/workspace";
import { selectItems } from "./workspace";

describe("database views", () => {
  it("combines filters without mutating records or leaking archived items", () => {
    const items = [
      {
        ...newItem("library"),
        title: "Alpha",
        status: "active" as const,
        tags: ["研究"],
        favorite: true,
      },
      {
        ...newItem("library"),
        title: "Beta",
        status: "active" as const,
        tags: ["研究"],
        archived: true,
      },
      { ...newItem("other"), title: "Alpha", tags: ["研究"] },
    ];
    const view = {
      ...newView("library"),
      search: "alpha",
      status: "active" as const,
      tag: "研究",
    };
    expect(selectItems(items, view).map((i) => i.title)).toEqual(["Alpha"]);
    expect(
      selectItems(items, { ...view, search: "" }, "archive").map(
        (i) => i.title,
      ),
    ).toEqual(["Beta"]);
    expect(
      selectItems(items, { ...view, search: "" }, "favorites"),
    ).toHaveLength(1);
    expect(items).toHaveLength(3);
  });
  it("searches custom values and sorts only the selected view", () => {
    const items = [
      { ...newItem("library"), title: "Zeta", values: { topic: "React" } },
      { ...newItem("library"), title: "Alpha" },
    ];
    expect(
      selectItems(items, { ...newView("library"), search: "react" }),
    ).toHaveLength(1);
    expect(
      selectItems(items, { ...newView("library"), sort: "title" })[0].title,
    ).toBe("Alpha");
    expect(items[0].title).toBe("Zeta");
  });
});
