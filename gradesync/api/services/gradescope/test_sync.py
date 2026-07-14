import html
import json
from datetime import datetime, timezone

import pytest

from api.services.gradescope.sync import parse_assignment_catalog


def assignments_table(rows):
    props = {
        'timezone': {'identifier': 'America/Los_Angeles'},
        'table_data': rows,
    }
    return (
        '<html><body><div data-react-class="AssignmentsTable" '
        f'data-react-props="{html.escape(json.dumps(props), quote=True)}">'
        '</div></body></html>'
    )


def catalog_row(assignment_id='8254649', title='Lab 8'):
    return {
        'id': f'assignment_{assignment_id}',
        'url': f'/courses/1329547/assignments/{assignment_id}',
        'title': title,
        'type': 'assignment',
        'total_points': '10.0',
        'is_published': True,
        'submission_window': {
            'release_date': '2026-07-09T09:00',
            'due_date': '2026-07-13T23:59',
            'hard_due_date': '2026-07-15T23:59',
        },
    }


def test_parse_assignment_catalog_uses_structured_payload_and_course_timezone():
    seen_at = datetime(2026, 7, 14, 12, tzinfo=timezone.utc)
    result = parse_assignment_catalog(assignments_table([catalog_row()]), now=seen_at)

    assert len(result) == 1
    assert result[0]['assignment_id'] == '8254649'
    assert result[0]['title'] == 'Lab 8'
    assert result[0]['max_points'] == 10.0
    assert result[0]['release_at'].isoformat() == '2026-07-09T16:00:00+00:00'
    assert result[0]['due_at'].isoformat() == '2026-07-14T06:59:00+00:00'
    assert result[0]['late_due_at'].isoformat() == '2026-07-16T06:59:00+00:00'
    assert result[0]['catalog_seen_at'] == seen_at
    assert result[0]['course_timezone'] == 'America/Los_Angeles'


def test_parse_assignment_catalog_rejects_duplicate_assignment_ids():
    duplicate = [catalog_row(), catalog_row(title='Duplicate')]
    with pytest.raises(RuntimeError, match='Duplicate assignment ID'):
        parse_assignment_catalog(assignments_table(duplicate))


def test_parse_assignment_catalog_requires_assignments_table():
    with pytest.raises(RuntimeError, match='AssignmentsTable payload was not found'):
        parse_assignment_catalog('<html></html>')
