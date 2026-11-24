import { test, expect } from '@playwright/test';

test('studio shell renders', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Studio', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /Image/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Workflows/ })).toBeVisible();
  await expect(
    page.getByText('Empty, for now — your first creation changes that.'),
  ).toBeVisible();
});

test('image studio exposes every generation knob', async ({ page }) => {
  await page.goto('/image');

  await expect(page.getByRole('heading', { name: 'Image Studio' })).toBeVisible();
  for (const label of [
    'Backend', 'Checkpoint', 'VAE', 'CLIP skip', 'Prompt', 'Negative prompt',
    'Sampler', 'Scheduler', 'Steps', 'CFG', 'Denoise', 'Width', 'Height',
    'Batch', 'Seed',
  ]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
});
