import React from 'react';
import { render, screen } from '@testing-library/react';
import GradeDataFlow from './GradeDataFlow';

jest.mock('@xyflow/react', () => ({
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  MarkerType: { ArrowClosed: 'arrow-closed' },
  MiniMap: () => null,
  PanOnScrollMode: { Vertical: 'vertical' },
  Panel: ({ children }) => <div>{children}</div>,
  Position: { Left: 'left', Right: 'right' },
  ReactFlow: ({ children, edges, nodes, nodeTypes }) => (
    <div>
      {children}
      <output data-testid="flow-shape">
        {JSON.stringify({
          edges: edges.map(({ id, source, target }) => ({ id, source, target })),
          nodes: nodes.map(({ id, type }) => ({ id, type })),
        })}
      </output>
      {nodes.map((node) => {
        const Node = nodeTypes[node.type];
        return Node ? <Node key={node.id} data={node.data} /> : null;
      })}
    </div>
  ),
  ReactFlowProvider: ({ children }) => children,
  useReactFlow: () => ({ setViewport: jest.fn() }),
}));

const legacyGraph = {
  student: { email: 'avery@example.com' },
  course: { id: 'demo-course' },
  components: [{ id: 'labs' }],
  nodes: [
    {
      id: 'labs-output',
      type: 'category_output',
      group: 'labs',
      label: 'Labs',
      score: 10,
      maxScore: 20,
      displayValue: '10/20',
      details: { percentage: 50 },
    },
    {
      id: 'course-output',
      type: 'final_output',
      group: 'course',
      label: 'Course Total',
      score: 999,
      maxScore: 150,
      displayValue: '999/150',
      details: { percentage: 666 },
    },
  ],
  edges: [{ id: 'labs-course', source: 'labs-output', target: 'course-output', active: true }],
  total: { score: 999, cap: 150, displayValue: '999/150' },
};

test('canonical standing replaces only the visible legacy course total', () => {
  render(
    <GradeDataFlow
      studentData={{
        gradeFlow: legacyGraph,
        canonicalGrade: {
          basis: 'policy_final',
          exactScore: 317.13,
          displayScore: 317,
          cap: 400,
          percentage: 79.2825,
        },
      }}
    />,
  );

  expect(screen.getAllByText('317.13 / 400')).toHaveLength(2);
  expect(screen.queryByText('999/150')).not.toBeInTheDocument();
  expect(screen.getByText('10/20')).toBeInTheDocument();
  expect(screen.getByTestId('flow-shape')).toHaveTextContent('labs-output');
  expect(screen.getByTestId('flow-shape')).toHaveTextContent('course-output');
  expect(screen.getByTestId('flow-shape')).toHaveTextContent('labs-course');
});

test('grade flow keeps its own total when no canonical contract is available', () => {
  render(<GradeDataFlow studentData={{ gradeFlow: legacyGraph }} />);

  expect(screen.getAllByText('999/150')).toHaveLength(2);
  expect(screen.queryByText('317.13 / 400')).not.toBeInTheDocument();
  expect(screen.getByText('10/20')).toBeInTheDocument();
});
