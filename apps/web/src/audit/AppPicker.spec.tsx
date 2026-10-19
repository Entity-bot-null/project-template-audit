import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppPicker } from './AppPicker';
import type { VisibleApp } from './types';

const SHOP: VisibleApp = {
  appId: '0190b6a1-0000-7000-8000-00000000000a',
  slug: 'shop',
  name: 'Shop',
  environment: 'production',
  status: 'active',
  system: false,
};
const HUB: VisibleApp = {
  appId: '0190b6a1-0000-7000-8000-00000000000b',
  slug: 'audit-hub',
  name: 'Audit Hub',
  environment: 'production',
  status: 'active',
  system: true,
};
const optionsOf = (select: HTMLElement) =>
  [...select.querySelectorAll('option')].map((option) => [option.value, option.textContent]);

describe('AppPicker', () => {
  it('lists the applications by name and environment, Audit Hub’s own log by name', () => {
    render(<AppPicker apps={[SHOP, HUB]} value={SHOP.appId} onChange={vi.fn()} />);
    const select = screen.getByRole('combobox', { name: 'Application' });
    expect(optionsOf(select)).toEqual([
      [SHOP.appId, 'Shop (production)'],
      [HUB.appId, 'Audit Hub (its own log)'],
    ]);
    expect(select).toHaveValue(SHOP.appId);
  });

  it('offers every application at once when the page does, under its own label', () => {
    render(
      <AppPicker
        apps={[SHOP]}
        value=""
        onChange={vi.fn()}
        allLabel="All applications"
        label="Show events of"
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Show events of' });
    expect(optionsOf(select)).toEqual([
      ['', 'All applications'],
      [SHOP.appId, 'Shop (production)'],
    ]);
    expect(select).toHaveValue('');
  });

  it('answers the chosen application’s id', async () => {
    const onChange = vi.fn<(appId: string) => void>();
    render(<AppPicker apps={[SHOP, HUB]} value="" onChange={onChange} allLabel="All" />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox'), 'Audit Hub (its own log)');
    expect(onChange).toHaveBeenCalledWith(HUB.appId);
  });
});
