import React from 'react';
import { render, screen } from '@testing-library/react';
import Login from './login';

jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

describe('login layout', () => {
  test('uses a viewport-centered surface with one page heading', () => {
    render(<Login />);

    expect(screen.getByTestId('login-viewport')).toHaveAttribute('data-layout', 'viewport-centered');
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to GradeView' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Explore Read-only Demo' })).toBeInTheDocument();
  });
});
