Skip to content
PrairieLearn Docs
API



logoPrairieLearn Docs
 GitHub
@prairielearn/postgres-tools@2.0.2
449
364
Overview
Getting Started
Getting Started
Requesting your course space
Concepts
Quick start
Workshop
Student Guide
Student Guide
Accessibility
Instructor Guide
Instructor Guide
Installing and running locally
Editing and syncing course content
Course configuration
Course instances
Assessments
Assessments
Overview
Configuration
Access control
Remote exams
Regrading assessments
Questions
Questions
Overview
question.html
server.py
Runtime environment
Accessibility
Elements
Elements
pl-answer-panel
pl-big-o-input
pl-card
pl-checkbox
pl-code
pl-dataframe
pl-drawing
pl-excalidraw
pl-external-grader-results
pl-external-grader-variables
pl-figure
pl-file-download
pl-file-editor
pl-file-preview
pl-file-upload
pl-graph
pl-hidden-hints
pl-hide-in-manual-grading
pl-hide-in-panel
pl-image-capture
pl-integer-input
pl-manual-grading-only
pl-matching
pl-matrix-component-input
pl-matrix-input
pl-matrix-latex
pl-multiple-choice
pl-number-input
pl-order-blocks
pl-overlay
pl-python-variable
pl-question-panel
pl-rich-text-editor
pl-string-input
pl-submission-panel
pl-symbolic-input
pl-template
pl-units-input
pl-variable-output
pl-xss-safe
clientFiles and serverFiles
UUIDs in JSON files
Docker images
External grading
Python autograder
Python autograder
API reference
C/C++ autograder
Java autograder
Python API reference
Python API reference
Colors
Conversion
HTML
Element extensions
Grading
Questions
Numerical precision
Other
SymPy
Timeouts
Workspaces
Manual grading
Content sharing
What to tell students
FAQ
API
Table of contents
API Authentication
Endpoint HTTP methods
Example access script
Endpoints
Course instances
Get single course instance
Get gradebook for course instance
Get access rules for course instance
List assessments for course instance
Assessments
Get single assessment
List access rules for assessment
List assessment instances for assessment
Assessment instances
Get single assessment instance
List instance questions for assessment instance
List submissions for assessment instance
Get event log for assessment instance
Submissions
Get single submission
Course sync
Start a course sync
Check course sync status
LMS Integration
Schema Reference
Schema Reference
 Course
 Question
 Assessment
 Course Instance
 Element
 Element (Course)
 Element Extension
Developer Guide
Developer Guide
Running in Docker
Running natively
Quickstart
Developer Guide
Migrations
Migrations
Server configuration
Building question elements
Building element extensions
Code execution
Contributing
Utility scripts
Utility scripts
LMS question converters
LMS question converters
LON-CAPA conversion tool
Canvas conversion tool
smartPhysics conversion tool
randexam conversion tool
Administrators
Administrators
SAML SSO configuration
LTI 1.3 configuration
Running in Production
Running in Production
Setup
Using Docker Compose
User Authentication
Admin User
Deprecated Features
Deprecated Features
Old v1/v2 question format
Old PrairieDraw graphics
Overview
Instructor Guide
API¶
PrairieLearn contains a limited API for use by instructors that allows programmatic access to assessments, assessment instances, and submissions.

API Authentication¶
PrairieLearn uses personal access tokens for the API. To generate a personal access token, click on your name in the nav bar and click "Settings". Under the section entitled "Personal Access Tokens", you can generate tokens for yourself. These tokens give you all the permissions that your normal user account has.

Provide your token via the Private-Token header:


curl -H "Private-Token: TOKEN" https://us.prairielearn.com/pl/api/v1/<REST_OF_PATH>
Endpoint HTTP methods¶
API endpoints require either a GET request or a POST request. A GET request retrieves information from PrairieLearn, such as gradebook information. A POST request asks PrairieLearn to perform an action, such as syncing a course GitHub repository. For GET requests, you can follow the format in the above example.

Here is an example of using curl for a POST request:


curl -H "Private-Token: TOKEN" -X POST https://us.prairielearn.com/pl/api/v1/<REST_OF_PATH>
Example access script¶
An example script that will download all API data for a course instance is at api_download.py. You can use it like this:


python api_download.py --token 9a6932a1-e356-4ddc-ad82-4cf30ad896ac --course-instance-id 29832 --output-dir tam212fa18
The token is your personal access token described above. The course-instance-id can be obtained by navigating to your course instance in the PrairieLearn web interface and extracting the ID from the URL.

Endpoints¶
All API endpoints are located at /pl/api/v1/. If you're running on production PrairieLearn, that means the API is at https://us.prairielearn.com/pl/api/v1. If you're running it locally at port 3000, the API is accessible via http://localhost:3000/pl/api/v1/.

In the endpoint list below, path components starting with a colon like :course_instance_id should be replaced with the integer IDs.

Course instances¶
Get single course instance¶

GET /pl/api/v1/course_instances/:course_instance_id
Get gradebook for course instance¶

GET /pl/api/v1/course_instances/:course_instance_id/gradebook
Get access rules for course instance¶

GET /pl/api/v1/course_instances/:course_instance_id/course_instance_access_rules
List assessments for course instance¶

GET /pl/api/v1/course_instances/:course_instance_id/assessments
Assessments¶
Get single assessment¶

GET /pl/api/v1/course_instances/:course_instance_id/assessments/:assessment_id
List access rules for assessment¶

GET /pl/api/v1/course_instances/:course_instance_id/assessments/:assessment_id/assessment_access_rules
List assessment instances for assessment¶

GET /pl/api/v1/course_instances/:course_instance_id/assessments/:assessment_id/assessment_instances
Assessment instances¶
Get single assessment instance¶

GET /pl/api/v1/course_instances/:course_instance_id/assessment_instances/:assessment_instance_id
List instance questions for assessment instance¶

GET /pl/api/v1/course_instances/:course_instance_id/assessment_instances/:assessment_instance_id/instance_questions
List submissions for assessment instance¶

GET /pl/api/v1/course_instances/:course_instance_id/assessment_instances/:assessment_instance_id/submissions
Get event log for assessment instance¶

GET /pl/api/v1/course_instances/:course_instance_id/assessment_instances/:assessment_instance_id/log
Submissions¶
Get single submission¶

GET /pl/api/v1/course_instances/:course_instance_id/submissions/:submission_id
Course sync¶
Start a course sync¶

POST /pl/api/v1/course/:course_id/sync
Returns a job_sequence_id that can be used to check on the sync job's status.

Check course sync status¶

GET /pl/api/v1/course/:course_id/sync/:job_sequence_id
Returns the status and output of the sync job.

Still Using Cursor? Fix bugs faster with Augment's full-codebase context. Install Now
Ads by EthicalAds
Previous
FAQ
Next
LMS Integration
Made with Material for MkDocs
Read the Docs