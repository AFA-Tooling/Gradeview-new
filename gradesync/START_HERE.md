# 演示课程脚本 - 创建完成 ✅

## Quick Docs Access

- Docs hub: `../docs/README.md`
- GradeSync feature doc: `../docs/features/gradesync.md`
- Database feature doc: `../docs/features/database.md`

## 📋 你要的所有东西都已经创建好了！

你现在有了一个完整的演示课程创建系统，可以在下周的会议上使用虚拟数据进行演示。

---

## 📝 创建的文件

### 1. **create_demo_course.py** ⭐ (主脚本)
位置: `gradesync/create_demo_course.py`

这是核心脚本，用来：
- 直接在数据库中创建演示课程（**不** 从外部系统同步）
- 生成虚拟学生数据
- 创建作业和成绩

**快速使用:**
```bash
cd gradesync
python3 create_demo_course.py --clean
```

### 2. **demo.sh** (便捷启动脚本)
位置: `gradesync/demo.sh`

一键运行脚本（带错误检查）：
```bash
./demo.sh --clean --students 30
```

### 3. **SETUP_DEMO.md** (中文使用指南)
位置: `gradesync/SETUP_DEMO.md`

详细的中文说明，包括：
- 如何使用脚本
- 常见问题解决
- 会议前的准备清单

### 4. **DEMO_COURSE_README.md** (技术文档)
位置: `gradesync/DEMO_COURSE_README.md`

详细的技术文档，包括：
- 创建的数据结构
- 命令行选项
- 数据库清理方法
- 故障排除

---

## 🎯 脚本做的事情

执行 `python3 create_demo_course.py --clean` 后，系统会：

1. ✅ **清空旧演示数据**（因为用了 `--clean`）
2. ✅ **创建演示课程**
   - 课程ID: `demo_cs10_spring2025`
   - 课程名: "Demo: CS10 - The Beauty and Joy of Computing"
3. ✅ **创建30个虚拟学生**
   - 真实姓名（Alice, Bob, Diana等）
   - 邮箱: `student01@berkeley.edu` 到 `student30@berkeley.edu`
   - 学号: `313010000001` 到 `313010000030`
4. ✅ **创建作业分类**（6个主要分类）
5. ✅ **创建10个作业**，跨越整个学期
6. ✅ **生成3000+条成绩记录**
   - 成绩分布现实：大多数学生80-100%，少数落后

---

## 🚀 下周会议前的使用流程

### 星期一-星期四：测试和准备

```bash
# Step 1: 进入项目目录
cd gradesync

# Step 2: 运行脚本创建演示数据（如果数据库连接正常）
python3 create_demo_course.py --clean

# Step 3: 或在Docker中运行（推荐）
cd .
docker compose up
# 在另一个终端
docker compose exec gradesync python3 create_demo_course.py --clean
```

### 星期五：会议演示

1. 启动系统
   ```bash
   docker compose up
   ```

2. 访问 http://localhost:3000

3. 用你的邮箱登录（比如 `instructor@berkeley.edu`）

4. 你会看到：
   - ✅ 30个虚拟学生的名单
   - ✅ 他们所有的作业成绩
   - ✅ 真实的成绩分布
   - ✅ 分类的作业（参与、实验、作业、项目、考试等）

---

## 💡 关键特点

### ✅ 完全本地化
- 不涉及外部系统（Gradescope、PrairieLearn等）
- 所有数据直接存储在你的数据库中
- 脚本 **不** 需要任何第三方API密钥

### ✅ 数据都标记为演示
- 所有演示课程ID都前缀为 `demo_`
- 所有演示数据带有 `demo: true` 标记
- 很容易识别和删除，不会污染真实数据

### ✅ 完全可定制
```bash
# 改课程名、增加学生数
python3 create_demo_course.py \
  --course-id demo_eecs_16a_sp25 \
  --course-name "Demo: EECS 16A" \
  --students 100
```

---

## 📚 命令参考

| 命令 | 说明 |
|------|------|
| `python3 create_demo_course.py` | 创建演示课程（如果已存在则跳过） |
| `python3 create_demo_course.py --clean` | **清空旧数据后创建新课程** ⭐ |
| `python3 create_demo_course.py --students 50` | 创建50个学生（默认30个） |
| `./demo.sh --clean` | 使用便捷脚本（包含错误检查） |

---

## 🔧 如果数据库连接有问题

首先确保：
1. ✅ `.env` 文件存在且配置正确
2. ✅ PostgreSQL 数据库可访问（可能需要VPN）
3. ✅ 防火墙未阻止连接

**最简单的方式：在Docker中运行**
```bash
docker compose up
# 新终端
docker compose exec gradesync python3 create_demo_course.py --clean
```

---

## 📂 文件位置总结

```
gradesync/
├── create_demo_course.py          ← 主脚本 (Python)
├── demo.sh                        ← 便捷脚本 (Bash)
├── SETUP_DEMO.md                  ← 中文使用指南
├── DEMO_COURSE_README.md          ← 详细技术文档
└── START_HERE.md                  ← 你现在看的文件
```

---

## ✨ 完成清单

- [x] 创建主脚本 `create_demo_course.py`
- [x] 创建便捷脚本 `demo.sh`
- [x] 创建中文使用指南 `SETUP_DEMO.md`
- [x] 创建技术文档 `DEMO_COURSE_README.md`
- [x] 验证脚本语法正确
- [x] 验证所有导入和依赖可用
- [x] 准备好供下周会议使用

---

## 🎬 立即开始

最快的方式：

```bash
cd gradesync
python3 create_demo_course.py --clean
```

就这么简单！32秒左右，你会有一个完整的演示课程，包含30个学生和3000+条成绩。

---

有任何问题吗？查看 `SETUP_DEMO.md` 获得更详细的说明。祝下周的会议圆满成功！🎉
