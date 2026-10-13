import { expect, test } from '@playwright/test';

test('login, manage a task in table and Kanban, then log out', async ({ page }) => {
  const originalTitle = `E2E 任务 ${Date.now()}`;
  const editedTitle = `${originalTitle}（已编辑）`;

  await page.goto('/login');
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await expect(page.getByRole('heading', { name: '学习仪表盘' })).toBeVisible();

  await page.getByRole('menuitem', { name: '学习任务' }).click();
  await expect(page.getByRole('heading', { name: '学习任务' })).toBeVisible();
  await page.getByRole('button', { name: '新建任务' }).click();
  await page.getByRole('textbox', { name: '任务标题' }).fill(originalTitle);
  await page.getByRole('textbox', { name: '分类' }).fill('E2E');
  await page.getByRole('dialog', { name: '新建学习任务' }).getByRole('button', { name: /保\s*存/ }).click();

  let row = page.getByRole('row').filter({ hasText: originalTitle });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: '编辑' }).click();
  await page.getByRole('textbox', { name: '任务标题' }).fill(editedTitle);
  await page.getByRole('dialog', { name: '编辑学习任务' }).getByRole('button', { name: /保\s*存/ }).click();
  row = page.getByRole('row').filter({ hasText: editedTitle });
  await expect(row).toBeVisible();

  const viewSwitch = page.getByRole('radiogroup', { name: '任务视图' });
  await viewSwitch.getByText('看板', { exact: true }).click();
  const card = page.locator('.task-kanban-card').filter({ hasText: editedTitle });
  const doneColumn = page.getByRole('region', { name: /已完成/ });
  await card.dragTo(doneColumn.locator('.task-kanban-heading'));
  await expect(doneColumn.locator('.task-kanban-card').filter({ hasText: editedTitle })).toBeVisible();

  await viewSwitch.getByText('列表', { exact: true }).click();
  row = page.getByRole('row').filter({ hasText: editedTitle });
  await row.getByRole('button', { name: '删除' }).click();
  await page.getByRole('tooltip').getByRole('button', { name: /删\s*除/ }).click();
  await expect(page.getByRole('row').filter({ hasText: editedTitle })).toHaveCount(0);

  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
