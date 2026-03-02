# Demo Course Creation Guide

## Quick Docs Access

- Docs hub: `../docs/README.md`
- GradeSync feature doc: `../docs/features/gradesync.md`
- Database feature doc: `../docs/features/database.md`

## Overview

The `create_demo_course.py` script creates a complete demo course with synthetic student data, assignments, and grades in your PostgreSQL database. This is perfect for demos and testing without using real student data.

## What Gets Created

✅ **Course**: A demo course with metadata
✅ **Students**: 30 synthetic students (configurable)  
✅ **Assignment Categories**: 6 categories (Participation, Labs, Homeworks, Projects, Midterm, Final)
✅ **Assignments**: 10 sample assignments across all categories
✅ **Grades**: Realistic grade distributions for all students across all assignments

## Requirements

1. PostgreSQL database must be running and accessible
2. `.env` file configured with `GRADESYNC_DATABASE_URL` or individual `POSTGRES_*` variables
3. Python 3.8+ with dependencies installed

## Installation

```bash
# From the gradesync directory
cd gradesync

# Install dependencies (if not already installed)
pip install -r api/requirements.txt

# Or install specific packages needed
pip install sqlalchemy python-dotenv
```

## Usage

### Create Demo Course (Basic)

```bash
python create_demo_course.py
```

This creates:
- Course ID: `demo_cs10_spring2025`
- 30 demo students
- All assignments and grades

### Create Course with Custom Settings

```bash
# Custom course name and ID
python create_demo_course.py \
  --course-id demo_physics_10_fa25 \
  --course-name "Demo: Physics 10 - Astrophysics" \
  --students 50

# Clean up old demo data first, then create new one
python create_demo_course.py --clean

# Combine options
python create_demo_course.py \
  --course-id demo_eecs_16a_sp25 \
  --course-name "Demo: EECS 16A - Designing Information Devices and Systems I" \
  --students 100 \
  --clean
```

### Command Line Arguments

| Argument | Default | Description |
|----------|---------|-------------|
| `--course-id` | `demo_cs10_spring2025` | Unique course identifier |
| `--course-name` | `Demo: CS10 - The Beauty and Joy of Computing` | Full course name |
| `--students` | `30` | Number of demo students to create |
| `--clean` | false | Delete existing demo data before creating new course |

## Features of Generated Data

### Student Distribution
- **Names**: Diverse realistic names
- **Student IDs**: Sequential IDs in format `313010000X`
- **Emails**: `studentXX@berkeley.edu`

### Assignment Categories
1. **Participation** - Low-weight items (10 pts each)
2. **Labs** - Regular assignments (20 pts each)
3. **Homeworks** - Medium weight (30 pts each)
4. **Projects** - Higher stakes (50 pts each)
5. **Midterm** - Exam (100 pts)
6. **Final** - Final exam (150 pts)

### Grade Distribution
- **70%** of students: 80-100% (A/B students)
- **20%** of students: 65-80% (B/C students)
- **10%** of students: 40-65% (struggling students)
- **5%** of students: No submission
- **85%** of submissions: On-time, **15%**: Late

## Tips for Demos

### Make It Look Real
- The first time you run this, the data will feel fresh and authentic
- After a few days, you can run `--clean` to reset for the next demo

### Multiple Courses
```bash
# Create multiple demo courses
python create_demo_course.py --course-id demo_cs61c_fa25 --course-name "Demo: CS 61C"
python create_demo_course.py --course-id demo_data100_fa25 --course-name "Demo: Data 100"
python create_demo_course.py --course-id demo_prob140_fa25 --course-name "Demo: Probability 140"
```

### Verify It Worked

```python
# Quick Python script to verify
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path('.').absolute()))
from dotenv import load_dotenv
load_dotenv()

from api.core.db import SessionLocal
from api.core import models

db = SessionLocal()

# Count demo data
demo_courses = db.query(models.Course).filter(
    models.Course.gradescope_course_id.like('demo_%')
).all()

print(f"Demo Courses: {len(demo_courses)}")
for course in demo_courses:
    students = db.query(models.Student).join(models.Submission).join(models.Assignment).filter(
        models.Assignment.course_id == course.id
    ).distinct().count()
    grades = db.query(models.Submission).join(models.Assignment).filter(
        models.Assignment.course_id == course.id
    ).count()
    
    print(f"\n  {course.name}")
    print(f"    Students: {students}")
    print(f"    Grades: {grades}")
```

## Troubleshooting

### "No such module" or Connection Errors

Make sure you're running from the correct directory and have installed dependencies:
```bash
cd /path/to/Grades/gradesync
pip install -r api/requirements.txt
python create_demo_course.py
```

### Database Connection Failed

Check your `.env` file:
```bash
# Should show valid values
grep POSTGRES /path/to/.env
grep GRADESYNC_DATABASE_URL /path/to/.env
```

### Script Hangs on "Creating submissions"

This is normal - it creates a lot of grade entries. Be patient, or reduce `--students`:
```bash
python create_demo_course.py --students 10  # Faster, fewer students
```

## Database Cleanup

To remove all demo data without recreating:

```python
from api.core.db import SessionLocal
from api.core import models

db = SessionLocal()

# Delete all demo data
db.query(models.Submission).delete()
db.query(models.Assignment).delete()
db.query(models.Student).delete()
db.query(models.CourseConfig).delete()
db.query(models.CoursePermission).delete()
db.query(models.AssignmentCategory).delete()
db.query(models.Course).filter(
    models.Course.gradescope_course_id.like('demo_%')
).delete()

db.commit()
print("Demo data cleaned")
```

Or just use the script with `--clean` flag when creating a new course.

## Notes

- **No External Sync**: This script only populates the local database. It does NOT sync from Gradescope, PrairieLearn, or iClicker.
- **Realistic Data**: Grades are generated to look realistic - not perfect distributions.
- **Quick Setup**: Entire demo course created in seconds, ready to show to stakeholders.
- **Safe for Production**: Demo data is clearly marked as synthetic and won't interfere with real courses.

## For Your Demo Meeting Next Week

1. Run the script once to create the demo course:
   ```bash
   python create_demo_course.py --clean
   ```

2. Login to your web app with your instructor account

3. You'll see 30 students with realistic grades across multiple assignments

4. Demo the filtering, grade reports, and other features without worrying about real student data!

---

**Questions?** Check that your PostgreSQL is running and `.env` variables are correct.
