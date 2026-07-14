import pytest

from api.core.ingest_optimized import has_submission_evidence


@pytest.mark.parametrize(
    ('submission', 'expected'),
    [
        ({'status': 'Missing'}, False),
        ({'status': '', 'submission_id': '', 'submission_count': 0}, False),
        ({'status': 'Graded', 'total_score': 0}, True),
        ({'status': 'Graded', 'total_score': 8}, True),
        ({'status': 'Ungraded', 'submission_id': '123'}, True),
        ({'status': 'Ungraded', 'submission_count': 1}, True),
        ({'status': 'Excused'}, True),
    ],
)
def test_has_submission_evidence(submission, expected):
    assert has_submission_evidence(submission) is expected
