import React from 'react';
import { render, screen, within } from '@testing-library/react';
import StudentProfileContent from './StudentProfileContent';

jest.mock('react-chartjs-2', () => ({
  Radar: () => <div data-testid="radar-chart" />,
  Doughnut: () => <div data-testid="doughnut-chart" />,
  Line: ({ data }) => (
    <div data-testid="line-chart">
      <output data-testid="line-labels">{JSON.stringify(data.labels)}</output>
      <output data-testid="line-series">{JSON.stringify(data.datasets[0]?.data || [])}</output>
    </div>
  ),
}));

const assignment = (assignmentId, name, overrides = {}) => ({
  basis: 'assignment_evidence',
  assignmentId,
  category: 'Labs',
  rawCategory: 'Labs',
  name,
  evidenceStatus: 'submitted',
  score: 10,
  recordedScore: 10,
  maxPoints: 10,
  percentage: 100,
  dueAt: '2026-07-08T23:59:00.000Z',
  submissionTime: '2026-07-08T20:00:00.000Z',
  sourceSyncStatus: 'synced',
  ...overrides,
});

describe('StudentProfileContent assignment trend', () => {
  test('shows every catalog assignment and displays missing or unavailable submission evidence as zero', () => {
    const assignmentEvidence = [
      assignment('pub-1', 'Published 1', { dueAt: '2026-07-01T23:59:00.000Z', submissionTime: '2026-07-01T20:00:00.000Z' }),
      assignment('pub-2', 'Published 2', {
        evidenceStatus: 'missing',
        score: null,
        recordedScore: null,
        percentage: null,
        dueAt: '2026-07-02T23:59:00.000Z',
        submissionTime: null,
      }),
      assignment('pub-3', 'Published 3', {
        evidenceStatus: 'not_due',
        score: null,
        recordedScore: null,
        percentage: null,
        dueAt: '2026-07-20T23:59:00.000Z',
        submissionTime: null,
      }),
      assignment('pub-4', 'Published 4', {
        evidenceStatus: 'due_unknown',
        score: null,
        recordedScore: null,
        percentage: null,
        dueAt: null,
        submissionTime: null,
      }),
      assignment('pub-5', 'Published 5', {
        evidenceStatus: 'not_synced',
        score: null,
        recordedScore: null,
        percentage: null,
        dueAt: '2026-07-04T23:59:00.000Z',
        submissionTime: null,
      }),
      assignment('pub-6', 'Published 6', {
        evidenceStatus: 'request_error',
        score: null,
        recordedScore: null,
        percentage: null,
        dueAt: '2026-07-05T23:59:00.000Z',
        submissionTime: null,
      }),
    ];

    render(<StudentProfileContent studentData={{ assignmentEvidence }} hideTopSnapshot />);

    expect(screen.getByText(/Showing all 6 authoritative catalog assignments/)).toBeInTheDocument();
    expect(screen.getByTestId('line-labels')).toHaveTextContent('[1,2,3,4,5,6]');
    expect(screen.getByTestId('line-series')).toHaveTextContent('[100,0,0,0,0,0]');

    const missingRow = screen.getByRole('row', { name: /pub-2/i });
    expect(within(missingRow).getByText('0 / 10')).toBeInTheDocument();
    expect(within(missingRow).getByText('0.00%')).toBeInTheDocument();
    expect(within(missingRow).getByText('Missing')).toBeInTheDocument();

    ['pub-3', 'pub-4', 'pub-5', 'pub-6'].forEach((assignmentId) => {
      const row = screen.getByRole('row', { name: new RegExp(assignmentId, 'i') });
      expect(within(row).getByText('0 / 10')).toBeInTheDocument();
      expect(within(row).getByText('0.00%')).toBeInTheDocument();
    });
  });
});
