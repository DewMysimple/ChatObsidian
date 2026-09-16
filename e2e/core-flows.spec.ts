import { expect, test } from "@playwright/test";

test("gallery, table and board share the same records; retired tools are absent", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "仓库画廊", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".database-card")).toHaveCount(10);
  await page.getByRole("tab", { name: "表格", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await page.getByRole("tab", { name: "看板", exact: true }).click();
  await expect(page.locator(".board-column")).toHaveCount(3);
  await expect(page.locator(".database-card")).toHaveCount(10);
  await expect(page.getByRole("button", { name: "工具箱" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "同步中心" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("page content, tags, archive and restore persist after reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /灵感与项目/ }).click();
  await page
    .getByRole("button", { name: "新建页面", exact: true })
    .first()
    .click();
  await page.getByLabel("页面标题").fill("本地知识计划");
  await page.getByLabel("页面描述").fill("可恢复、可检索的记录");
  await page.getByLabel("页面标签").fill("研究, 长期");
  await page
    .getByLabel("笔记与想法")
    .fill("写在这里的正文不会覆盖任何 Obsidian 文件。");
  await page.getByRole("button", { name: "保存页面", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: /灵感与项目/ }).click();
  await page
    .getByRole("button", { name: "编辑 本地知识计划", exact: true })
    .click();
  await expect(page.getByLabel("页面标签")).toHaveValue("研究, 长期");
  await expect(page.getByLabel("笔记与想法")).toHaveValue(
    "写在这里的正文不会覆盖任何 Obsidian 文件。",
  );
  await page.getByRole("button", { name: "归档页面", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "编辑 本地知识计划", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "已归档", exact: true }).click();
  await page
    .getByRole("button", { name: "编辑 本地知识计划", exact: true })
    .click();
  await page.getByRole("button", { name: "恢复页面", exact: true }).click();
  await page.getByRole("button", { name: /灵感与项目/ }).click();
  await expect(
    page.getByRole("button", { name: "编辑 本地知识计划", exact: true }),
  ).toBeVisible();
});

test("custom database and typed property values survive a restart", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建数据库", exact: true }).click();
  await page.getByLabel("数据库名称").fill("阅读书架");
  await page.getByRole("button", { name: "创建数据库", exact: true }).click();
  await page.getByLabel("视图设置", { exact: true }).click();
  await page.getByRole("button", { name: "添加属性", exact: true }).click();
  await page.getByLabel("属性名称").fill("评分");
  await page.getByLabel("属性类型").selectOption("number");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "添加属性", exact: true })
    .click();
  await page
    .getByRole("button", { name: "新建页面", exact: true })
    .first()
    .click();
  await page.getByLabel("页面标题").fill("设计心理学");
  await page
    .getByRole("dialog")
    .getByLabel("评分", { exact: true })
    .fill("9.5");
  await page.getByRole("button", { name: "保存页面", exact: true }).click();
  await page.getByRole("tab", { name: "表格", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "9.5", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /阅读书架/ }).click();
  await expect(
    page.getByRole("cell", { name: "9.5", exact: true }),
  ).toBeVisible();
});

test("view filters and preview preferences are saved independently", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("筛选", { exact: true }).click();
  await page.getByLabel("筛选标签").selectOption("常用");
  await expect(page.locator(".database-card")).toHaveCount(4);
  await page.getByLabel("筛选", { exact: true }).click();
  await page.getByLabel("视图设置", { exact: true }).click();
  await page.getByLabel("卡片预览").selectOption("none");
  await expect(page.locator(".database-card .cover-art")).toHaveCount(0);
  await page.getByLabel("视图设置", { exact: true }).click();
  await page.getByRole("tab", { name: "表格", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(10);
  await page.getByRole("tab", { name: "画廊", exact: true }).click();
  await page.reload();
  await expect(page.locator(".database-card")).toHaveCount(4);
  await expect(page.locator(".database-card .cover-art")).toHaveCount(0);
});

test("board drag changes the persisted status", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "看板", exact: true }).click();
  const card = page.locator(".database-card").filter({
    has: page.getByRole("button", { name: "编辑 ChatAgent", exact: true }),
  });
  await card.dragTo(page.getByRole("region", { name: "已完成", exact: true }), {
    sourcePosition: { x: 30, y: 25 },
    targetPosition: { x: 80, y: 100 },
  });
  await expect(
    page
      .getByRole("region", { name: "已完成", exact: true })
      .getByRole("button", { name: "编辑 ChatAgent", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "已完成", exact: true })
      .getByRole("button", { name: "编辑 ChatAgent", exact: true }),
  ).toBeVisible();
});

test("unsaved edits require an explicit discard", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "编辑 ChatAgent", exact: true })
    .click();
  await page.getByLabel("页面标题").fill("未保存的标题");
  await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "继续编辑", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "编辑 ChatAgent", exact: true }),
  ).toBeVisible();
});

test("quick switcher finds notes, supports keyboard and remembers filters", async ({
  page,
}) => {
  await page.goto("/?quick=1");
  const search = page.getByLabel("搜索仓库或笔记标题");
  await search.fill("Agent");
  await expect(page.getByRole("option")).toHaveCount(2);
  await search.press("ArrowDown");
  await expect(page.getByRole("option").nth(1)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: /仓库，共/ }).click();
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option")).toContainText("Agent 设计");
  await page.reload();
  await expect(page.getByRole("button", { name: /仓库，共/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("settings autosave and render the dark theme", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /设置 0/ }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("默认打开方式").selectOption("single");
  await expect(page.getByRole("status")).toContainText("所有设置已自动保存");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: /设置 0/ }).click();
  await expect(page.getByLabel("默认打开方式")).toHaveValue("single");
});

test("saved views can be created and searched without changing the original", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("添加视图", { exact: true }).click();
  await page.getByLabel("视图名称").fill("学习资料");
  await page.getByRole("button", { name: "创建视图", exact: true }).click();
  await page.getByLabel("搜索当前数据库").fill("数学");
  await page.getByLabel("搜索当前数据库").press("Enter");
  await expect(page.locator(".database-card")).toHaveCount(2);
  await page.getByRole("tab", { name: "画廊", exact: true }).click();
  await expect(page.locator(".database-card")).toHaveCount(10);
  await page.getByRole("tab", { name: "学习资料", exact: true }).click();
  await expect(page.locator(".database-card")).toHaveCount(2);
});

test("uploaded covers are stored locally and can fit inside gallery cards", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "编辑 ChatAgent", exact: true })
    .click();
  await page
    .getByLabel("上传封面图片")
    .setInputFiles("src-tauri/icons/128x128.png");
  await expect(
    page.locator(".page-editor .cover-uploaded img"),
  ).toHaveAttribute("src", /^data:image\/webp;base64,/);
  await page.getByRole("button", { name: "保存页面", exact: true }).click();
  await page.reload();
  await expect(page.locator(".database-card .cover-uploaded img")).toHaveCount(
    1,
  );
  await page.getByLabel("视图设置", { exact: true }).click();
  await page
    .getByRole("checkbox", { name: "完整显示封面", exact: true })
    .check();
  await expect(page.locator(".database-card .cover-uploaded img")).toHaveCSS(
    "object-fit",
    "contain",
  );
});

test("workspace export includes pages and schema in a portable JSON snapshot", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /设置 0/ }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出工作台", exact: true }).click();
  const artifact = await download;
  expect(artifact.suggestedFilename()).toBe("ChatObsidian-workspace.json");
  const stream = await artifact.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(exported.format).toBe("chatobsidian.workspace.v1");
  expect(exported.workspace.items).toHaveLength(13);
  expect(exported.workspace.collections).toHaveLength(2);
  expect(exported.workspace.views).toHaveLength(6);
});
