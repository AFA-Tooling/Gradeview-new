import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import AppShell from './AppShell';

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="location">{location.pathname}{location.search}</div>
      <button type="button" onClick={() => navigate('/profile/labs')}>Go to labs</button>
      <Link to="/profile/assignments?filter=missing">Open assignments</Link>
    </>
  );
}

function renderShell(initialEntry) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AppShell navigation={<div>Navigation</div>} footer={<footer>Footer</footer>}>
        <LocationProbe />
      </AppShell>
    </MemoryRouter>,
  );
}

describe('application shell', () => {
  test('provides a single focusable main landmark and skip link', () => {
    renderShell('/profile');

    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
  });

  test('focuses main content after a route change', async () => {
    const user = userEvent.setup();
    renderShell('/profile');

    await user.click(screen.getByRole('button', { name: 'Go to labs' }));

    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
  });

  test('does not render the sidebar or footer on login', () => {
    renderShell('/login');

    expect(screen.queryByTestId('app-navigation')).not.toBeInTheDocument();
    expect(screen.queryByText('Footer')).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveStyle({ marginLeft: '0', padding: '0' });
  });

  test('keeps the footer in the scrollable main content instead of reserving viewport space', () => {
    renderShell('/profile');

    const main = screen.getByRole('main');
    const footer = screen.getByText('Footer');

    expect(main).toContainElement(footer);
    expect(main.nextElementSibling).toBeNull();
  });

  test('keeps staff persona, student, course, and query state for profile links', async () => {
    const user = userEvent.setup();
    renderShell('/students/avery%40example.com/report?course_id=demo-cs10');

    await user.click(screen.getByRole('link', { name: 'Open assignments' }));

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/students/avery%40example.com/assignments?filter=missing&course_id=demo-cs10',
    );
  });

  test('skip link moves focus to the main landmark', async () => {
    const user = userEvent.setup();
    renderShell('/profile');
    const skipLink = screen.getByRole('link', { name: 'Skip to main content' });

    await user.click(skipLink);
    expect(document.querySelector(skipLink.getAttribute('href'))).toBe(screen.getByRole('main'));
    expect(screen.getByRole('main')).toHaveFocus();
  });
});
