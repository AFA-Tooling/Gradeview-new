import React from 'react';
import { render, screen } from '@testing-library/react';
import StudentReviewHeader from './StudentReviewHeader';
import { STUDENT_PERSONA } from '../utils/studentRoutes';

describe('StudentReviewHeader', () => {
  it('keeps staff identity controls without the redundant review navigation strip', () => {
    render(
      <StudentReviewHeader
        persona={STUDENT_PERSONA.STAFF}
        status="success"
        student={{ name: 'Avery Chen', email: 'avery@example.com' }}
        requestedIdentifier="avery@example.com"
        currentCourseLabel="CS10"
        students={[{ name: 'Avery Chen', email: 'avery@example.com' }]}
        onStudentChange={jest.fn()}
      />,
    );

    expect(screen.queryByRole('link', { name: /Back to Class Health/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Staff student review')).not.toBeInTheDocument();
    expect(screen.getByText('Avery Chen')).toBeInTheDocument();
    expect(screen.getByLabelText('Search students by name or email')).toBeInTheDocument();
  });
});
