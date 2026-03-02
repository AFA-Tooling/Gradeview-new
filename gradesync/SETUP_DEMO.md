# Demo 课程创建 - 使用指南

## Quick Docs Access

- Docs hub: `../docs/README.md`
- GradeSync feature doc: `../docs/features/gradesync.md`
- Database feature doc: `../docs/features/database.md`

## 脚本概览

我已经为你创建了 `create_demo_course.py` 脚本，用来在数据库中快速生成一个完整的演示课程，包括学生和成绩数据。这样你就可以在下周的会议演示中使用虚拟数据，而不用担心学生隐私问题。

## 脚本位置

```
gradesync/create_demo_course.py
```

## 功能

✅ **创建演示课程** - 带有完整的课程元数据  
✅ **生成虚拟学生** - 30个带有真实名字的学生（可配置）  
✅ **创建作业** - 10个跨越6个分类的作业  
✅ **生成成绩** - 3000多个成绩记录，分布真实且合理  

## 使用方法

### 基础使用（推荐用于演示）

```bash
cd gradesync
python3 create_demo_course.py --clean
```

这会：
1. 清空之前的演示数据
2. 创建一个演示课程：CS10 - The Beauty and Joy of Computing
3. 生成30个虚拟学生
4. 创建10个作业
5. 为每个学生生成现实的成绩分布

### 自定义演示课程

```bash
# 修改课程名称和ID
python3 create_demo_course.py \
  --clean \
  --course-id demo_mybigclass_fa25 \
  --course-name "Demo: My Big Course - Spring 2025" \
  --students 50
```

## 命令行参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--course-id` | `demo_cs10_spring2025` | 课程ID（唯一标识） |
| `--course-name` | `Demo: CS10 - The Beauty and Joy of Computing` | 课程名称 |
| `--students` | `30` | 要创建的虚拟学生数 |
| `--clean` | (无) | 先清空旧的演示数据 |

## 脚本创建的数据

### 作业分类
1. **Participation** - 课堂参与（10分）
2. **Labs** - 实验（20分每个）
3. **Homeworks** - 作业（30分每个）
4. **Projects** - 项目（50分）
5. **Midterm** - 期中考试（100分）
6. **Final** - 期末考试（150分）

### 成绩分布
- **70%** 的学生：80-100% (优秀)
- **20%** 的学生：65-80% (良好)
- **10%** 的学生：40-65% (需要改进)
- **5%** 的学生：没有提交作业
- **85%** 的作业：按时提交，**15%** 迟交

## 演示会议前的准备

### 1. 在本地或Docker中测试脚本

**选项A：在本地Mac上运行（需要能连接到云端数据库）**
```bash
cd gradesync
python3 create_demo_course.py --clean
```

**选项B：在Docker中运行（推荐）**
```bash
# 从项目根目录
cd .

# 启动Docker容器
docker compose up

# 在新的终端标签页中，进入API容器
docker compose exec gradesync python3 create_demo_course.py --clean
```

### 2. 验证数据已创建

```bash
# 或从Python REPL检查
python3 << 'EOF'
from pathlib import Path
import sys
sys.path.insert(0, 'gradesync')

from api.core.db import SessionLocal
from api.core import models

db = SessionLocal()

# 检查演示课程
courses = db.query(models.Course).filter(
    models.Course.gradescope_course_id.startswith('demo_')
).all()

print(f"演示课程数: {len(courses)}")
for course in courses:
    students_count = db.query(models.Submission).join(models.Assignment).filter(
        models.Assignment.course_id == course.id
    ).distinct(models.Submission.student_id).count()
    
    grades_count = db.query(models.Submission).join(models.Assignment).filter(
        models.Assignment.course_id == course.id
    ).count()
    
    print(f"  • {course.name}")
    print(f"    - 学生数: {students_count}")
    print(f"    - 成绩记录: {grades_count}")

db.close()
EOF
```

### 3. 在演示中登录

使用你的Berkeley邮箱（比如 `instructor@berkeley.edu`）登录系统，你就能看到所有的虚拟学生和他们的成绩。

## 常见问题

### 数据库连接超时？

如果看到 "timeout expired" 错误，这通常是网络问题。有几个解决方案：

1. **使用Docker运行**（最简单）
   ```bash
   docker compose up
   # 在另一个终端
   docker compose exec gradesync python3 create_demo_course.py --clean
   ```

2. **检查VPN连接** - 如果你在校研连接，可能需要启用VPN访问云数据库

3. **检查防火墙** - 确保你的Mac防火墙没有阻止数据库连接

### 脚本运行很慢？

创建3000多条成绩记录需要时间。这是正常的。如果太慢，可以用较少的学生：
```bash
python3 create_demo_course.py --students 10  # 更快，但数据较少
```

### 想清空所有演示数据？

```bash
python3 create_demo_course.py --clean  # 这会先清空再重建
```

或者如果你想完全删除而不重建：

```bash
python3 << 'EOF'
from api.core.db import SessionLocal
from api.core import models

db = SessionLocal()

# 删除所有演示数据
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
print("✅ 所有演示数据已删除")
EOF
```

## 演示脚本工作原理

1. **初始化数据库** - 创建必要的表（如果不存在）
2. **创建教师用户** - 使用你的邮箱地址
3. **创建课程** - 带有演示标记，不会与真实数据冲突
4. **设置作业分类** - 创建标准的作业分类
5. **生成虚拟学生** - 30个不同的学生记录
6. **创建作业** - 10个跨越不同难度的作业
7. **生成成绩** - 每个学生的每个作业都有一个成绩，分布合理

## 技术细节

- **编程语言**: Python 3
- **依赖**: SQLAlchemy, python-dotenv, psycopg2
- **数据库**: PostgreSQL（你的云数据库）
- **代码位置**: `gradesync/create_demo_course.py`

所有的虚拟数据都在生成时标记为 `demo: true`，所以非常容易识别和清理。

## 下周会议的完整计划

```
周一-周三: 在Docker中本地测试脚本
python3 create_demo_course.py --clean
✅ 验证所有学生和成绩都正确显示

周四: 最后检查
- 确认web UI能够加载演示数据
- 测试过滤功能、查看成绩单等功能
- 记录任何看起来不对的地方

周五: 会议演示
- 使用你的邮箱登录
- 展示30个虚拟学生和他们的成绩
- 演示系统功能（不再需要担心学生隐私！）
```

---

有问题？在 `gradesync/DEMO_COURSE_README.md` 中有更详细的技术文档。
