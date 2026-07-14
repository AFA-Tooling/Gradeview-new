from unittest.mock import patch
from datetime import datetime, timezone

import pytest

from api.core.ingest_optimized import (
    has_submission_evidence,
    parse_gradescope_course_gradebook,
    write_assignment_scores_optimized,
)


@pytest.mark.parametrize(
    ('submission', 'expected'),
    [
        ({'status': 'Missing'}, False),
        ({'status': '', 'submission_id': '', 'submission_count': 0}, False),
        ({'status': 'Graded', 'total_score': 0}, True),
        ({'status': 'Graded', 'total_score': 8}, True),
        ({'status': 'Ungraded', 'submission_id': '123'}, False),
        ({'status': 'Ungraded', 'submission_count': 1}, False),
        ({'status': 'Excused'}, False),
        ({'submission_time': datetime(2026, 7, 14, tzinfo=timezone.utc)}, True),
    ],
)
def test_has_submission_evidence(submission, expected):
    assert has_submission_evidence(submission) is expected


def test_course_gradebook_parser_uses_only_score_or_submission_time_as_evidence():
    csv_content = (
        'Name,SID,Email,Lab 1,Lab 1 - Max Points,Lab 1 - Submission Time,'
        'Lab 1 - Lateness (H:M:S)\n'
        'Ada,1,ada@example.edu,0,10,,\n'
        'Grace,2,grace@example.edu,,10,2026-07-14 09:30:00 -0700,00:00:00\n'
        'Linus,3,linus@example.edu,,10,,\n'
    )
    catalog = [
        {'assignment_id': '100', 'title': 'Lab 1', 'max_points': 10, 'is_published': True},
        {'assignment_id': '200', 'title': 'Missing Header', 'max_points': 5, 'is_published': True},
    ]

    result = parse_gradescope_course_gradebook(csv_content, catalog)

    assert len(result['students']) == 3
    assert len(result['matched_assignments']) == 1
    assert result['unmatched_assignment_titles'] == ['Missing Header']
    assert len(result['submissions']) == 2
    assert result['submissions'][0]['total_score'] == 0
    assert 'status' not in result['submissions'][0]
    assert 'submission_count' not in result['submissions'][0]
    assert result['submissions'][1]['total_score'] is None
    assert result['submissions'][1]['submission_time'].isoformat() == '2026-07-14T09:30:00-07:00'


def test_unpublished_assignment_is_rejected_before_database_access():
    with patch('api.core.ingest_optimized.SessionLocal') as session_factory:
        result = write_assignment_scores_optimized(
            course_gradescope_id='1329547',
            assignment_id='8254655',
            assignment_name='Future assignment',
            csv_content='Name,Email,Total Score\n',
            catalog_entry={'is_published': False},
        )

    assert result == {
        'success': False,
        'error': 'Refusing to ingest an unpublished Gradescope assignment',
    }
    session_factory.assert_not_called()
