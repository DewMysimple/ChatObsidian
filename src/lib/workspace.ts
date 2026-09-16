import type { DatabaseView, WorkspaceItem } from "../contracts/workspace";

export function selectItems(
  items: WorkspaceItem[],
  view: DatabaseView,
  scope: "all" | "favorites" | "archive" = "all",
) {
  const search = view.search.trim().toLocaleLowerCase();
  return items
    .filter(
      (item) =>
        item.collectionId === view.collectionId &&
        item.archived === (scope === "archive"),
    )
    .filter((item) => scope !== "favorites" || item.favorite)
    .filter((item) => !view.status || item.status === view.status)
    .filter((item) => !view.tag || item.tags.includes(view.tag))
    .filter(
      (item) =>
        !search ||
        [
          item.title,
          item.description,
          item.body,
          ...item.tags,
          ...Object.values(item.values),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(search),
    )
    .sort((a, b) =>
      view.sort === "title"
        ? a.title.localeCompare(b.title, "zh-CN")
        : view.sort === "updated"
          ? b.updatedAt - a.updatedAt
          : view.sort === "created"
            ? b.createdAt - a.createdAt
            : 0,
    );
}

export function readableError(error: unknown) {
  const text = String(error);
  if (text.includes("OBSIDIAN_CLOSE_TIMEOUT"))
    return "Obsidian 窗口未能在 15 秒内正常关闭。请先处理未保存内容，再重试；本次未强制结束进程。";
  return text.replace(/^Error: /, "");
}
