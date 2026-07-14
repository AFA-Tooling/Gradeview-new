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
        return Node ? (
          <div key={node.id} data-testid={`flow-node-${node.id}`} data-render-height={node.data.renderHeight}>
            <Node data={node.data} />
          </div>
        ) : null;
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

test('expanded policy rows wrap long assignment names instead of truncating them', () => {
  const longAssignmentName = 'Lab 9: Algorithms (Binary) / Algorithmic Complexity';
  const detailInputs = [
    {
      id: 'lab-9',
      type: 'raw',
      group: 'labs',
      label: longAssignmentName,
      displayValue: 'not passed',
      status: 'missing',
    },
    ...Array.from({ length: 25 }, (_, index) => ({
      id: `lab-${index + 10}`,
      type: 'raw',
      group: 'labs',
      label: `Lab ${index + 10}: Assignment ${index + 10}`,
      displayValue: 'not passed',
      status: 'missing',
    })),
  ];
  const graphWithFilterDetails = {
    student: { email: 'avery@example.com' },
    course: { id: 'demo-course' },
    components: [{ id: 'labs' }],
    nodes: [
      ...detailInputs,
      {
        id: 'labs-filter',
        type: 'logical',
        subtype: 'filter',
        group: 'labs',
        label: 'FILTER Lab Completion',
        details: { operator: 'filter' },
      },
    ],
    edges: detailInputs.map((input) => ({
      id: `${input.id}-filter`,
      source: input.id,
      target: 'labs-filter',
      active: true,
    })),
    total: {},
  };

  render(<GradeDataFlow studentData={{ gradeFlow: graphWithFilterDetails }} />);

  const wrappedDetailLabel = screen
    .getAllByText(longAssignmentName)
    .find((element) => !element.classList.contains('MuiTypography-noWrap'));

  expect(wrappedDetailLabel).toHaveStyle({
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
  });
  expect(screen.getAllByText('not passed')).toHaveLength(52);
  expect(Number(screen.getByTestId('flow-node-labs-filter').dataset.renderHeight)).toBeGreaterThan(760);
});
