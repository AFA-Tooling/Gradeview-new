# GradeView 审计修复基线与统一验收门槛

> 基线日期：2026-07-09（America/Los_Angeles）
> 当前基线提交：`41b3e4b` (`feat: improve assignment due date alerts`)
> 隔离分支：`codex/audit-baseline`
> 隔离 worktree：`/tmp/gradeview-audit-baseline`

## 1. 目的与范围

本文记录 180 项审计问题开始修复前的可复现工程基线，包括：

- 仓库可运行命令、CI 能力和本机工具链；
- 现有测试、Demo/fixture 和 API contract；
- 当前通过/失败结果；
- 最关键的成绩口径与数据完整性风险；
- 审计开始时未提交改动的盘点及其随后进入 `main` 的状态；
- 后续所有修复分支必须满足的统一验收门槛。

完整问题正文见 [`docs/audit-report.md`](./audit-report.md)。原附件已完整读取，共 180 项，已排除 Concept Map，且原文不包含解决方案。

本文不是“问题已解决”证明。构建成功只能证明代码可编译，不能证明成绩正确、角色正确、可访问或交互符合审计要求。

## 2. Git 快照与并发变化

### 2.1 历史起始快照

盘点开始时：

- `main` 与当时的 `origin/main` 均为 `0dd1807`；
- 共享主工作区有 8 个 modified 文件和 2 个 untracked 文件；
- 本分支从该提交创建，未 checkout 或修改共享主工作区。

当时的 10 个 dirty 路径：

```text
api/lib/dbHelper.mjs
api/v2/Routes/admin/assignments/index.js
api/v2/Routes/students/grades/index.js
api/v2/Routes/students/profile/index.js
docs/templates/course-assignments-demo.csv
website/src/components/StudentProfileContent.js
website/src/utils/assignmentDue.js
website/src/utils/studentDataProcessor.js
website/src/utils/studentProfileData.js
website/src/views/alerts.jsx
```

历史 diff 规模为 433 additions / 130 deletions，`git diff --check` 当时通过。

### 2.2 当前快照

盘点期间，上述 10 个路径被完整提交为：

```text
41b3e4b feat: improve assignment due date alerts
```

审计正文也已通过 `517447d` 和合并提交 `c09f259` 进入 `main`。父任务确认后，本隔离分支以 fast-forward 方式更新到 `41b3e4b`。当前共享 `main`、`origin/main` 和本分支基线一致，主工作区 clean。

因此：

- 下文 `0dd1807` 的检查结果仅作为历史对照；
- `41b3e4b` 的检查结果才是后续分支的当前基线；
- 后续分支不能把原 dirty diff 再次当作“待保留的本地改动”重复 cherry-pick；
- 与上述 10 个路径重叠的分支，必须以 `41b3e4b` 为合并起点并逐项复核语义，而不是只处理文本冲突。

## 3. 工具链与仓库脚本

### 3.1 工具链

| 项目 | 本机实际值 | 仓库/CI 值 | 风险 |
| --- | --- | --- | --- |
| Node.js | `v24.14.0` | `.nvmrc`: `v21.2.0`; CI: Node 20 | 三套版本不一致 |
| npm | `11.18.0` | CI 显式 pin `10.8.2` | lock/install 行为可能不一致 |
| Python | `3.9.6` | 未统一声明 runtime 版本 | 本机未安装 pytest |
| CI | GitHub Actions | API Jest + website build | 没有 DB、E2E、a11y 或 Python job |

### 3.2 根目录

- 根目录没有 `package.json`。
- 根目录有 `package-lock.json`，但 `packages` 为空，是一个无可执行脚本的空 lockfile。
- `Makefile` 提供 Docker/dev/preflight 命令：`init`、`dev-up`、`dev-down`、`refresh`、`preflight`、`dev-local`、`docker` 等。
- `make preflight` 会停止/启动 Docker stack、构建镜像、等待健康检查并访问本机端口；它会改变共享 Docker 状态，因此本次只读基线没有执行。

### 3.3 Node API (`api/package.json`)

| Script | 命令/状态 |
| --- | --- |
| `start` | `node server.js` |
| `dev` | `nodemon server.js` |
| `test` | `jest` |
| `migrateConfigToDb` | 运行 DB 配置迁移 |
| `server` | 同时启动 API 与前端 |
| `testDb` | 指向不存在的 `api/testDb.js` |
| `testApi` | 指向不存在的 `api/testApi.js` |

API 没有 lint、typecheck、contract-test 或 migration-test script。虽然依赖中有 `supertest`，仓库没有任何 Jest/Supertest 测试文件。

### 3.4 React 前端 (`website/package.json`)

| Script | 命令/状态 |
| --- | --- |
| `react` | `react-scripts start` |
| `build` | production build，然后移动/复制到 `website/server/build` 与 `website/build` |
| `start` | 当前写成 `cd ../server && npm run dev`；仓库实际 server 位于 `website/server`，该相对路径可疑 |
| `eject` | CRA eject |

前端没有 `test`、独立 `lint`、typecheck、E2E、visual regression 或 accessibility script。

### 3.5 Website server (`website/server/package.json`)

仅有 `start` 与 `dev`，没有测试。它提供静态文件并把 `/api` 代理到后端。

### 3.6 GradeSync Python 服务

- 有 `gradesync/api/requirements.txt` 和 `gradesync/requirements_db.txt`，没有 `pyproject.toml`、`pytest.ini` 或 tox 配置。
- FastAPI/Pydantic 会提供 GradeSync 自身的 `/openapi.json` 与 `/docs`。
- 两个以 `test_` 命名的脚本实际是人工集成脚本：
  - `gradesync/test_iclicker_ingest_local.py` 依赖本地 PostgreSQL、未纳入仓库的 CSV，并硬编码旧路径 `/Users/zhangweishu/Gradeview-new/.env`；
  - `gradesync/test_iclicker_sync.py` 依赖 Chrome、人工 CalNet/Duo 登录、外部 iClicker 与本地数据库。
- 这两个脚本没有 pytest assertion，不能作为确定性的回归测试。

## 4. 当前可执行检查结果

### 4.1 当前基线：`41b3e4b`

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `cd api && npm ci` | PASS | 安装 560 个包；npm 报告 15 个漏洞（1 low / 7 moderate / 6 high / 1 critical） |
| `cd api && npm test -- --runInBand --passWithNoTests` | PASS（空通过） | 输出 `No tests found`；CI 正在使用这一口径 |
| `cd api && npm test -- --runInBand` | **FAIL** | 46 个源文件被检查，0 个测试匹配，退出码 1 |
| `cd website && npm ci` | PASS | 安装 1391 个包；npm 报告 147 个漏洞（11 low / 112 moderate / 23 high / 1 critical） |
| `cd website && CI=true npm run build` | PASS | 编译成功；main bundle gzip `406.08 kB`；有 `fs.F_OK` deprecated 与 Browserslist 过期警告 |
| `python3 -m pytest --collect-only gradesync` | **FAIL** | 本机 Python 环境没有 pytest |
| `git diff --check` | PASS | 当前 worktree 没有 whitespace error |

上述结果在 fast-forward 到 `41b3e4b` 后重新执行。前端 build 产物与 `node_modules` 均被 `.gitignore` 忽略，没有进入提交。

### 4.2 历史对照：`0dd1807`

在 due-date 改动进入 `main` 前，API 的空 Jest 与前端 build 结果相同：CI 可绿，但没有任何行为断言。前端 gzip main bundle 为 `405.31 kB`。这说明当前 CI 不能识别 `41b3e4b` 引入的成绩口径变化。

## 5. 测试与 fixture 盘点

### 5.1 自动测试现状

- Node API：0 个测试。
- React：0 个测试，且没有 test script。
- GradeSync：0 个确定性 pytest test；只有两个带外部依赖的人工脚本。
- E2E：0。
- API contract test：0。
- DB migration/integration test：0。
- accessibility test：0。
- responsive/visual regression test：0。
- 审计中的 Avery Chen / Jordan Singh 没有 golden snapshot 或 endpoint parity assertion。

CI 的 API job 使用 `--passWithNoTests`，所以“API Tests”显示成功并不代表执行了测试。

### 5.2 Demo 数据

`gradesync/create_demo_course.py` 是唯一接近完整 fixture 的资产：

- 默认 seed：`20260629`；
- 默认 32 名学生；
- 首两名正是 Avery Chen 与 Jordan Singh；
- 创建 24 个作业：6 Attendance + 8 Labs + 5 Projects + 3 Quest + 1 Midterm + 1 Postterm；
- 为每位学生创建每个作业的 submission 行；
- 另外创建考试 effective score 和 attendance effective score；
- 不会输出或断言任何页面/endpoint 的预期总分。

`docs/templates/course-assignments-demo.csv` 是 7 行的配置示例，日期为 2027 年。它没有被 `create_demo_course.py` 或 CI 自动加载，不能当作当前 Demo 数据的测试 fixture。

## 6. API contracts 与成绩数据流

Node API 根路径为 `/api/v2`。Node API 没有 OpenAPI、JSON Schema、Zod/Joi 或生成类型；当前 contract 只能从 route implementation 与前端读取逻辑推断。

| Endpoint | 当前主要 payload/用途 | 关键风险 |
| --- | --- | --- |
| `GET /admin/studentScores?course_id=` | 全班 raw score matrix + 每人的 `summarySectionTotals` | Class Health/Alerts 的数据入口；raw 与 policy summary 同时存在 |
| `GET /admin/studentScores/summary/:email` | 单人 policy category totals 与 `summaryTotal` | 与 `getStudentPolicySummaries` 同源，较接近 canonical final-policy total |
| `GET /admin/assignments?course_id=` | 默认返回 `category -> assignment -> maxPoints` | 不是 submission ledger，不包含学生状态 |
| `GET /admin/assignments?...&include_metadata=1` | `41b3e4b` 新增 `{ assignments, metadata }`，metadata 含 due/release | 同一 endpoint 有两种顶层 shape，未测试消费者兼容性 |
| `GET /bins?course_id=` | total cap、grade bins、rounding policy、assignment points | policy 展示与 letter grade 的配置源 |
| `GET /students/:email/grades` | grouped assignments；`sort=time` 时返回 submission list | grouped 与 time 两种 shape；time list 只含已有 submission |
| `GET /students/:email/profile` | 聚合 `grades`、`rawGrades`、`bins`、`examPolicy`、`summary`、`categoryBlocks`，可选 `gradeFlow` | 一个 payload 内已经混合 full-policy summary 与 due-filtered blocks |
| `GET /students/:email/grade-flow` | policy lineage/Explain Score 图谱 | 未经过 `41b3e4b` 的 due-only 截断，因此可与 Workspace/Report 冲突 |

前端 `fetchStudentProfileData` 对 aggregate profile 的任意非-cancel error 都退回多个 legacy endpoint。这个 fallback 能维持页面可用，但也会掩盖 aggregate contract regression，并让同一路由在错误情况下走另一套计算路径。

### 6.1 当前存在的多个“总分”实现

至少有以下并行实现：

1. `getStudentPolicySummaries`：后端按课程 policy 计算 category final 与总分；
2. `getStudentGradeFlow`：后端构建 Explain Score 的完整 policy graph；
3. `studentDataProcessor.js`：前端重新缩放、drop、cap，并对 assignment 使用 `Math.ceil`；
4. `applyCanonicalSummaryTotals`：前端再把后端 summary 合并回 categories；
5. `alerts.jsx`：另行计算 due-work cap、due-work score、风险和 letter grade。

默认 grade bins 的区间是双端 inclusive，例如 A+ `390–400` 与 A `370–390`。代码用第一个匹配项消解 390，但 policy 文案本身仍然重叠。前端还在 assignment/category 层使用 `Math.ceil`，与“只在最终总分进行 rounding”的 policy 文案不同。

## 7. `41b3e4b` due-date 提交审计

### 7.1 它实际增加了什么

- 后端从 assignment metadata 或 `exam_attempt_map` 解析 `dueAt` / `releaseAt`；
- student grades/profile 和 admin assignments 可以返回这些字段；
- Profile/Report/Ledger 的前端数据处理只保留 `isAssignmentDue(...) === true` 的条目；
- Profile API 的 category block 只统计有且已到期的条目，并在没有 due item 时把 score 归零；
- Alerts 改为按 due assignments 重算 score、cap 和风险；
- Student Profile 的趋势表固定为按提交时间排序；
- 加入一个 2027 assignment CSV 模板。

### 7.2 关键因果链：Demo 的 19 个非考试作业会被排除

静态代码可以直接推出：

1. `isAssignmentDue` 在没有 due date 时返回 `false`；它没有“未知/沿用旧逻辑”状态。
2. Demo 生成器创建 24 个作业，但只为 5 个考试写 `exam_attempt_map.due_at`。
3. 其余 19 个 Attendance/Labs/Projects 作业的 `assignment_metadata` 没有 due 字段。`create_submissions` 虽然用局部变量计算 due time，却没有把它存入 assignment。
4. 因而 Profile、raw ledger 与 Alerts 会保留 5 个考试，排除 19 个非考试。
5. Alerts 中原先可依据“班级是否已有 score”判断 published assignment 的 fallback，位于 `if (!isAssignmentDue(...)) return false` 之后；对无 due metadata 的作业实际上不可达。

这与审计证据高度吻合：Ledger 恰好只有 5 个考试，Category 下拉只剩 Quest/Midterm/Postterm，Workspace/Report 只得到考试小计，而 Explain Score/后端 policy summary 仍有完整总分。

### 7.3 审计编号映射

从静态路径看，`41b3e4b` 提供的是 due/release metadata 基础能力，最多只能视为以下问题的“部分基础”，不能判定关闭：

- #70：Top Actions 需要 assignment 与截止时间，但 UI 仍未展示具体 deadline；
- #100：Projects 需要真实时间/状态，但 extension、resubmission、late penalty 仍无 contract；
- #124：已有 due/release 字段，但审计要求的是 Submitted 日期的年份与时区，仍未修复。

相反，当前“无 due = 排除”语义直接影响或可解释以下问题：

- 总分与数据可信度：#1–#11、#16、#18–#19；
- Workspace：#66–#70；
- Student Report：#78–#80；
- Attendance：#83、#86；
- Labs：#88–#89、#94–#95；
- Projects：#98–#102；
- Assignments/Ledger：#117–#120；
- Explain Score 冲突：#127、#137；
- 空数据/0/失败混淆：#163。

其中 #7/#8/#117/#118 的“恰好 5 条考试记录”与 Demo 的 5 个带 due exam 是强对应关系。#2/#4–#6/#79 的非考试类别归零，则与 Profile 的 due filter 和 summary clamp 强对应。

### 7.4 “当前成绩”口径被改变，但没有统一定义

`41b3e4b` 同时产生至少三种语义：

- 后端 policy summary / Grade Flow：完整 policy earned points / 400；
- Profile：due-filtered numerator，但仍可能使用 400 作为 denominator 和 grade bin；
- Alerts：due-filtered numerator / due-filtered cap，再把该百分比缩放到 course cap 查 letter grade。

这不是单纯“增加 due date”。它改变了 Current Grade 的数学定义，并可能让早期课程或 metadata 不完整的课程显示 F、N/A 或仅考试成绩。修复分支在写代码前必须明确并测试三种产品概念：final-policy standing、due-work progress、projected final；不同概念不能继续共享无标签的 `totalScore` / `totalCap`。

## 8. 关键测试缺口

按审计风险排序，当前缺少：

1. 同一学生跨 Class Health、Workspace、Report、Alerts、Explain Score 的 total/category parity test；
2. Avery/Jordan 的 deterministic golden fixture 与已知 400-point expected result；
3. 0、missing、not synced、category absent、future/not due 五种状态的 contract test；
4. due metadata 缺失时的 backward-compatibility test；
5. Demo 24 assignments / 32 students 在所有列表与 selector 中的 count parity test；
6. rounding 与 grade-bin boundary test，尤其 240/280/290/310/320/330/350/360/370/390；
7. aggregated profile 与 legacy fallback 的同 payload parity test；
8. role/navigation/impersonation/demo-read-only E2E；
9. URL deep link、history、tab/filter state retention E2E；
10. 13-inch viewport、table overflow、footer overlap、modal scroll visual test；
11. keyboard、accessible name、heading、chart text alternative 与 color-only state checks；
12. AI request course ID、真实/样例结果分层和失败状态 test；
13. Settings/Sync 的 empty/error/read-only state test。

## 9. 后续分支统一验收门槛

以下是合并到 `main` 的最低门槛；只满足现有 CI 不足以验收。

### 9.1 分支与变更安全

- 每个 subagent 必须使用独立 worktree 与 `codex/*` 分支。
- 开始和交付前都记录 base SHA；合并前更新到最新 `main`。
- 不得覆盖共享主工作区或复用其他 agent 的未提交文件。
- 与 `41b3e4b` 的 10 个路径重叠时，必须说明保留、替换或回退了哪些 due semantics。
- `git diff --check` 必须通过，且提交中不得包含 build、node_modules、凭据或本机路径。

### 9.2 每个代码分支的命令门槛

```bash
cd api && npm test -- --runInBand
cd website && CI=true npm run build
git diff --check <merge-base>...HEAD
```

当前第一条会因 0 tests 失败。任何涉及 API、policy、profile、alerts 或数据 contract 的分支，必须先补充有意义的测试，不能使用 `--passWithNoTests` 作为验收证据。

Python/GradeSync 变更还必须在隔离环境安装锁定依赖后运行目标 pytest；人工 Chrome/DB 脚本不能替代 assertion test。

### 9.3 成绩可信度硬门槛

任何涉及审计 #1–#20、#66–#70、#78–#80、#83–#127、#137、#139–#146、#163 的分支，至少提供：

- 同一 fixture 的 endpoint contract assertion；
- Workspace、Report、Class Health、Alerts、Explain Score 的 score-basis 对照；
- 六个 policy category 均存在且合计 cap 为 400；
- 0 / missing / unsynced / absent / not-due 不互相冒充；
- no-due metadata 不得静默删除已有 assignment；
- 最终 rounding 仅在 policy 指定阶段发生；
- grade bins 在每个边界只匹配一个等级；
- raw ledger 的 row/category 数与 fixture 一致；
- Demo 至少验证 32 students、24 assignments、6 categories、5 exam assignments，而不是只看页面可渲染。

### 9.4 UI/交互分支证据

- 对实际路由运行浏览器验证，而非只提交组件代码；
- 记录 desktop 13-inch 等价 viewport 与窄屏截图；
- 验证 URL、back/forward、refresh 后 student/tab/filter 状态；
- 验证 keyboard-only 流程、heading 结构、accessible names、focus 与可读 chart summary；
- 验证 loading、empty、error、not-synced、demo-read-only 状态；
- 修复角色问题时必须分别验证 student、instructor/course admin、demo 三种身份。

### 9.5 验收判定

分支只有在以下条件同时成立时才能标记通过：

1. 目标审计编号逐项有可观察证据；
2. 新增测试在修复前能失败、修复后通过；
3. 当前基线构建没有退化；
4. 没有制造新的 score basis 或 API shape 分叉；
5. 与并发分支的语义冲突已经解决，而非仅完成 Git merge；
6. 文档明确列出仍未解决的编号，不以“部分基础能力”冒充完成。

## 10. 当前结论

`41b3e4b` 可以编译，但现有 CI 没有任何行为测试。更重要的是，due-date 过滤与 Demo 数据 contract 不兼容：24 个作业中只有 5 个考试具有可解析 due date，足以静态解释审计中大批“非考试为 0、Ledger 只剩 5 条、Explain Score 与其他页面冲突”的现象。

因此，后续修复的首要验收前置不是继续调整页面展示，而是先固定“当前成绩”的 score basis、为 Demo 建立 golden contract，并确保缺失 due metadata 不会被解释为 0 分或不存在。
