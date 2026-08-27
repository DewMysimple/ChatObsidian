import { expect, test } from '@playwright/test';

test('vault center loads and exposes core navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('仓库中心', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('已管理仓库')).toBeVisible();
  await expect(page.getByPlaceholder('搜索仓库、分组、标签或路径')).toBeVisible();
});

test('workspace and mirror synchronization are opt-in', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '同步中心' }).click();
  await expect(page.getByRole('checkbox', { name: /工作区状态/ })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /高级完整镜像/ })).not.toBeChecked();
});

test('quick switcher supports title search and keyboard selection', async ({ page }) => {
  await page.goto('/?quick=1');
  const search = page.getByLabel('搜索仓库或笔记标题');
  await search.fill('Agent');
  await expect(page.getByRole('option').filter({ has: page.locator('strong', { hasText: 'Agent 设计' }) })).toBeVisible();
  await expect(page.getByRole('option').first()).toContainText('仓库');
  await expect(page.getByRole('option').nth(1)).toContainText('笔记');
  await search.press('ArrowDown');
  await expect(page.getByRole('option').filter({ hasText: 'Agent 设计' })).toBeVisible();
});

test('quick switcher type filters can isolate notes', async ({ page }) => {
  await page.goto('/?quick=1');
  const search = page.getByLabel('搜索仓库或笔记标题');
  await page.getByRole('button', { name: '仓库' }).click();
  await search.fill('Agent');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option').first()).toContainText('笔记');
});

test('toolbox requires a detailed confirmation before launching', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '工具箱' }).click();
  const row = page.locator('.script-row').filter({ hasText: '.Synchronize.py' });
  await row.getByRole('button', { name: /运行/ }).click();
  await expect(page.getByText('确认运行工具')).toBeVisible();
  await expect(page.getByText('D:\\03_Python\\Python\\python.exe')).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByText('确认运行工具')).not.toBeVisible();
});

test('preferences use autosave without a save button', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '偏好设置' }).click();
  await expect(page.getByRole('status')).toContainText('已自动保存');
  await expect(page.getByRole('button', { name: '保存偏好设置' })).toHaveCount(0);
});
