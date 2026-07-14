# Query patterns

Use the live catalog when it differs from these examples.

| Question | View | Key fields and controls |
| --- | --- | --- |
| Highest grade fluctuation | `students` | select `student_name`, `average_score`, `score_stddev`; order `score_stddev desc` |
| Hardest assignments | `assignments` | select `assignment_title`, `average_score`, `submission_count`; filter `submission_count gt 0`; order `average_score asc` |
| All student averages | `students` | select `student_name`, `average_score`; order `student_name asc` |
| Latest assignment submissions | `assignments` | select `assignment_title`, `latest_submission_at`; order timestamp descending |
| Projects versus Exams | `categories` | filter `category in ["Projects", "Exams"]` |
| Course statistics | `course_summary` | use its default selection |
| Students below 60 | `students` | filter `average_score lt 60`; order score ascending |
| Activity in the last week | `daily_activity` | filter `activity_date gte YYYY-MM-DD`; order date ascending |
| Most completed assignments | `students` | order `assignment_count desc` |
| Top 10 students | `students` | order `average_score desc`; limit 10 |

Filters use `{ "field": ..., "operator": ..., "value": ... }`. Supported operators are returned by `describe_course_analytics`; `in` accepts 1–50 string values.
