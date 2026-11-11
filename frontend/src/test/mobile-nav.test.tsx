import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { expect, test, vi } from 'vitest';

import MobileNav from '@/ds/MobileNav';
import { renderWithProviders } from './test-utils';

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

function renderAt(path: string, onMore = vi.fn()) {
  renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <MobileNav onMore={onMore} />
      <Where />
    </MemoryRouter>,
  );
  return onMore;
}

test('marks the tab of the current page, and only that one', () => {
  renderAt('/clients');
  expect(screen.getByRole('link', { name: 'Clients' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBeNull();
});

test('pages without a tab of their own light up More', () => {
  renderAt('/settings');
  expect(screen.getByRole('button', { name: 'More' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBeNull();
});

test('the centre button starts a new client on the Clients page', () => {
  renderAt('/');
  fireEvent.click(screen.getByRole('link', { name: 'Add Client' }));
  expect(screen.getByTestId('where').textContent).toBe('/clients?new=1');
});

test('More opens the full menu', () => {
  const onMore = renderAt('/');
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(onMore).toHaveBeenCalledTimes(1);
});
