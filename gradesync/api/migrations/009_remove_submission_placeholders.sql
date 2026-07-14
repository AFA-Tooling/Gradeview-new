-- Migration: Remove roster placeholder rows from submissions.
-- A submission row must carry real evidence; absence is represented by the
-- assignment catalog LEFT JOIN at read time.

DELETE FROM submissions
WHERE LOWER(TRIM(COALESCE(status, ''))) IN (
        'missing',
        'not submitted',
        'not_submitted',
        'unsubmitted'
    )
  AND total_score IS NULL
  AND submission_time IS NULL
  AND COALESCE(submission_id, '') = ''
  AND COALESCE(submission_count, 0) = 0
  AND COALESCE(view_count, 0) = 0
  AND COALESCE(lateness, '') = ''
  AND COALESCE(scores_by_question::text, '{}') IN ('{}', 'null');

COMMENT ON TABLE submissions IS
    'Actual student submission, manual score, or applicability evidence; missing work is derived from catalog LEFT JOIN';
