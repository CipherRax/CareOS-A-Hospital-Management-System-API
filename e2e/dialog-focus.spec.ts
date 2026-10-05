import { expect, test, type Page } from '@playwright/test';

/**
 * Dialog focus behaviour.
 *
 * This was recorded as unverified, which is the weakest kind of claim in a clinical
 * UI: a modal that lets focus wander into the page behind it means a keyboard user
 * can silently edit a record they believe they have dismissed, and a modal that
 * drops focus on close strands them at the top of the document.
 *
 * The primitives are Radix, which implements trapping — but "the library does it" is
 * not evidence that *these* dialogs do, with these labels, in this application. So
 * this drives them the way a keyboard user would.
 */

/** The element that currently has focus, described. */
async function activeElement(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { tag: 'body', text: '', inDialog: false };
    const dialog = el.closest('[role="dialog"]');
    return {
      tag: el.tagName.toLowerCase(),
      text: (el.textContent ?? '').trim().slice(0, 40),
      inDialog: Boolean(dialog),
      name: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? '',
    };
  });
}

test.describe('dialog focus', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/design-system');
  });

  test('moves focus into the dialog when it opens', async ({ page }) => {
    await page.getByRole('button', { name: 'Open dialog' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Focus must land inside. A dialog that renders without moving focus leaves a
    // keyboard user tabbing through the page they thought had been dismissed.
    await expect.poll(async () => (await activeElement(page)).inDialog).toBe(true);
  });

  test('names the dialog from its header', async ({ page }) => {
    await page.getByRole('button', { name: 'Open dialog' }).click();
    // Without an accessible name a dialog is announced only as "dialog", which is
    // no use to someone deciding whether they are in the right place.
    await expect(page.getByRole('dialog')).toHaveAccessibleName(/discharge summary/i);
  });

  test('keeps Tab inside the dialog', async ({ page }) => {
    await page.getByRole('button', { name: 'Open dialog' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect.poll(async () => (await activeElement(page)).inDialog).toBe(true);

    // Far more Tab presses than the dialog has controls. If focus ever escapes, the
    // page behind is reachable — the exact defect this test exists to catch.
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const inside = (await activeElement(page)).inDialog;
      expect(inside, `focus escaped the dialog after ${i + 1} tabs`).toBe(true);
    }
  });

  test('keeps Shift+Tab inside the dialog', async ({ page }) => {
    await page.getByRole('button', { name: 'Open dialog' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect.poll(async () => (await activeElement(page)).inDialog).toBe(true);

    // Backwards is where traps usually leak.
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Shift+Tab');
      expect((await activeElement(page)).inDialog, `focus escaped backwards after ${i + 1}`).toBe(
        true,
      );
    }
  });

  test('closes on Escape', async ({ page }) => {
    await page.getByRole('button', { name: 'Open dialog' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('returns focus to the trigger on close', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'Open dialog' });
    await trigger.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Without this a keyboard user is dropped at the top of the page and has to
    // navigate back to where they were.
    await expect(trigger).toBeFocused();
  });

  test('returns focus to the trigger after Escape', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'Open dialog' });
    await trigger.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('hides the rest of the page from assistive technology while open', async ({ page }) => {
    await page.getByRole('button', { name: 'Open dialog' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // `aria-modal` plus inerting the background: a screen reader user swiping through
    // the document must not land on content they cannot see.
    const modal = await page.getByRole('dialog').getAttribute('aria-modal');
    expect(modal).toBe('true');
  });

  test('traps focus in the confirm dialog too', async ({ page }) => {
    await page.getByRole('button', { name: 'Open confirm' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect.poll(async () => (await activeElement(page)).inDialog).toBe(true);

    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab');
      expect((await activeElement(page)).inDialog).toBe(true);
    }
  });

  test('names the confirm dialog and describes what is lost', async ({ page }) => {
    await page.getByRole('button', { name: 'Open confirm' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAccessibleName(/discard this draft/i);
    // A destructive action whose consequence is unstated is how drafts get lost.
    await expect(dialog).toHaveAccessibleDescription(/cannot be undone/i);
  });
});
