import html
import json
from datetime import datetime, timezone

import pytest

from api.core import ingest_optimized
from api.services.gradescope.sync import is_published_assignment, parse_assignment_catalog
from api.services.gradescope.sync import GradescopeSync


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


@pytest.mark.parametrize(
    ('published', 'expected'),
    [
        (True, True),
        (False, False),
        (None, False),
        ('true', False),
    ],
)
def test_only_explicitly_published_assignments_are_syncable(published, expected):
    assert is_published_assignment({'is_published': published}) is expected


def test_course_sync_downloads_and_ingests_only_published_assignments(monkeypatch):
    sync = GradescopeSync('staff@example.edu', 'secret')
    public = {'assignment_id': '100', 'title': 'Public Lab', 'is_published': True}
    unpublished = {'assignment_id': '200', 'title': 'Future Lab', 'is_published': False}
    captured_catalog = []
    ingested_catalog = []

    monkeypatch.setattr(sync, '_get_course_assignments', lambda _course_id: [public, unpublished])
    monkeypatch.setattr(sync.gs_client, 'log_in', lambda _email, _password: True)
    monkeypatch.setattr(sync.gs_client, 'logout', lambda: None)

    gradebook_csv = (
        'Name,SID,Email,Public Lab,Public Lab - Max Points,'
        'Public Lab - Submission Time,Public Lab - Lateness (H:M:S)\n'
        'Student,1,s@example.edu,1,1,,\n'
    )

    monkeypatch.setattr(sync.gs_client, 'download_gradebook', lambda course_id: gradebook_csv)
    monkeypatch.setattr(
        sync.gs_client,
        'download_scores',
        lambda *_args: pytest.fail('Per-assignment downloads must not be used'),
    )

    def capture_catalog(**kwargs):
        captured_catalog.extend(kwargs['catalog'])
        return {'catalog_count': len(kwargs['catalog'])}

    def capture_ingest(**kwargs):
        ingested_catalog.extend(kwargs['catalog'])
        assert kwargs['csv_content'] == gradebook_csv
        return {
            'success': True,
            'students_processed': 1,
            'assignments_processed': 1,
            'submissions_processed': 1,
            'unmatched_assignment_titles': [],
        }

    monkeypatch.setattr(ingest_optimized, 'upsert_gradescope_assignment_catalog', capture_catalog)
    monkeypatch.setattr(ingest_optimized, 'write_course_gradebook_optimized', capture_ingest)

    result = sync.sync_course('1329547', save_to_db=True)

    assert [row['assignment_id'] for row in captured_catalog] == ['100']
    assert [row['assignment_id'] for row in ingested_catalog] == ['100']
    assert result['assignments_synced'] == 1
    assert result['assignments_discovered'] == 2
    assert result['unpublished_skipped'] == 1
    assert result['submissions_synced'] == 1
