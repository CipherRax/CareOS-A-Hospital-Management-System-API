import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '@/components/ui/button';

/**
 * Behaviour tests, not snapshot tests. A snapshot of class strings would lock in
 * the current styling and would not catch the regressions that matter: a missing
 * type, a broken accessible name, a disabled control that still fires.
 */
describe('Button', () => {
  it('defaults to type="button" so it cannot submit a form by accident', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('submits when explicitly asked to', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Save</Button>
      </form>,
    );
    screen.getByRole('button', { name: 'Save' }).click();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('does not fire onClick while disabled', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('exposes aria-disabled separately from the disabled attribute', () => {
    // Needed for controls that must stay focusable to explain why they are inert.
    render(<Button aria-disabled="true">Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
  });

  it('renders the child element when asChild is set', () => {
    render(
      <Button asChild variant="tertiary">
        <a href="/design-system">Design system</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Design system' });
    expect(link.tagName).toBe('A');
    expect(link).not.toHaveAttribute('type');
  });
});

describe('class-name merging', () => {
  // Regression guard. tailwind-merge cannot see our `@theme`, so it used to treat
  // `text-on-fill` (colour) and `text-meta` (font size) as the same utility and
  // drop the colour. The class vanished from the DOM and every filled button fell
  // back to the inherited text colour — invisible in unit tests, obvious in axe.
  it('keeps both the font size and the text colour when variant and size both set them', () => {
    render(
      <Button variant="primary" size="sm">
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.className).toContain('text-on-fill');
    expect(button.className).toContain('text-meta');
  });

  it('lets a caller override a variant class without !important', () => {
    render(
      <Button variant="primary" className="text-tertiary">
        Save
      </Button>,
    );
    const className = screen.getByRole('button', { name: 'Save' }).className;
    expect(className).toContain('text-tertiary');
    expect(className).not.toContain('text-on-fill');
  });
});
