# GradeView 审计修复与 UI 恢复交付报告

> 报告日期：2026-07-14（America/Los_Angeles）
> 审计起始与 UI 参考基线：`41b3e4b`（`feat: improve assignment due date alerts`）
> 本报告核对的主线提交：`9a33472`（`merge: improve Class Health internal usability`）
> 问题来源：[audit-report.md](./audit-report.md)；基线与门禁：[audit-baseline.md](./audit-baseline.md)；原执行拆分：[audit-triage.md](./audit-triage.md)

## 1. 交付结论

本轮已经把成绩契约、assignment evidence、课程 roster、Demo/课程权限边界、认证错误、平台状态和前端测试门禁等底层修复保留在主线，同时将此前大幅改版的主要页面重新收回到 `41b3e4b` 的视觉结构与密度。恢复范围包括全局导航、Student Workspace/Report、AI Analytics、Grade Sync、Settings；Class Health 只做了搜索、链接语义、排序、窄屏和控制区密度等内部可用性改进，没有再次重做产品结构。

管理员现在按用户最新要求，在同一个紧凑左侧栏中同时看到 `STUDENT` 和 `ADMIN` 两组入口，以便管理员查看学生视图；普通学生只看到 `STUDENT`。这项要求取代了原审计 #21、#168 中“管理员不应同时看到两组导航”的旧判断，因此这两个编号不能继续按旧验收口径直接标记为关闭，后续审计应以“分组清楚、目标学生清楚、空间占用可接受”为准。

本报告不是“180 项全部解决”的声明。180 项已全部记录和映射，但当前没有逐编号完成最终集成环境复验，也没有覆盖所有真实数据库、外部 GradeSync、所有角色、所有 viewport 和全部键盘/屏幕阅读器路径。可以确认的是：下述修复已进入主线，相关 contract/component 测试资产存在，恢复分支经过主代理逐分支审阅后才合并；最终主线的 Website、API、build 和目标 Browser 汇总结果已记录在第 7 节。

Concept Map 不在本次审计和本报告范围内，本报告不提供其解决方案。

## 2. 判定口径

为避免把“有代码”写成“已解决”，本报告使用以下口径：

- **已合并**：对应提交已存在于 `main@9a33472`。
- **有持久测试资产**：仓库中存在针对该 contract 或交互的自动化断言；这不等同于本报告已重新执行全部测试。
- **已做分支验收**：主代理在开发分支合并前审阅范围、实现与浏览器表现，并在发现问题时退回原 agent 继续修改。
- **最终集成证据**：所有分支合并后，在 `main@9a33472` 上重新运行的结果，逐项记录在第 7 节；这些结果只证明已执行的门禁和场景。
- **关闭审计项**：必须有目标编号、可观察结果、自动化或浏览器证据及最终集成回归结果。仅有共享根因修复或页面看起来正常，均不足以关闭编号。

## 3. 此前已合并并保留的数据、API 与 CI 修复

以下内容早于本轮 UI 恢复进入主线。UI 恢复没有整体回退这些底层修复。

| 主线提交 | 已合并内容 | 仓库中的持久证据 | 当前可以下的结论与限制 |
| --- | --- | --- | --- |
| `41ed498` | AI Analytics 请求按选中课程携带并约束 `course_id` | AI service、course-scope route 与测试 | 已有 course scope 实现与断言，最终 Browser 的真实查询返回统计表；生产 AI/数据库环境仍需单独验证。 |
| `5fee798` | 建立 canonical grade contract，统一 exact/display score、cap、percentage、letter、category 和 grade-bin 处理 | `canonicalGrade.test.js`、`policySummaryBuilder.test.js`、`questPolicyScore.test.js`、前端 adapter tests | Avery/Jordan fixture、边界、missing due date、Quest 与小数取整有自动化断言；不能据此宣称所有真实课程跨页值均已复验。 |
| `4513f01` | 建立 route-driven student review 与稳定学生 deep link | `studentRoutes.test.js`、`studentProfile.test.jsx` | direct load、history、旧请求覆盖和 policy 课程上下文有测试；所有页面 filter/scroll 恢复尚未逐项复验。 |
| `42adcfb` | assignment catalog 与 evidence 分离，保留无 submission/no-due 行；统一 enrolled roster authority | `assignmentEvidence.test.js`、`courseRoster.test.js`、`routeResponseWiring.test.js`、前端 adapter tests | 24 个 catalog 行/5 个 evidence 行、32 人 roster、状态区分和 LEFT JOIN contract 有断言；生产数据库行为与全部异常数据仍需运行验证。 |
| `e5685ce` | 服务端 Demo 写屏障、身份 capability、课程授权和 AI 查询边界 | `accessPolicyMatrix.test.js`、`writeBarrierRoutes.test.js`、`sessionCapabilities.test.js`、`aiQueryRoutes.test.js` | 主要权限负向路径有 API 测试；不能替代真实 token、真实数据库和外部同步服务的端到端审计。 |
| `afa104f` | admin student score 响应暴露课程级 assignment evidence contract | `courseWideAssignmentEvidence.test.js`、`studentScores.test.js` | Class Health 有权消费 authoritative evidence；页面所有统计口径仍须与真实课程联合核验。 |
| `8cdd013` | 认证失败统一为安全、稳定的错误 contract | `authErrorNormalization.test.js` | Google/JWT 解析失败及 401 语义有断言；第三方认证服务现场故障不在本轮实测范围。 |
| `8a545f2` | Student 页面改为消费 canonical grade/evidence model | `studentExperienceModel.test.js`、`studentExperienceV2.test.js` | 数据模型和状态表达被保留；该提交的大幅视觉重写随后由 `769ed70` 收回。 |
| `57cffee` | AI、Grade Sync、Settings 的 loading/empty/error/demo 状态与前端 CI 门禁 | 页面 component tests、`website` 的 `test:ci` script、GitHub Actions 的 API/Website/build jobs | CI 已不再以 Website “只 build 不测试”作为唯一门禁，API job 也不使用 `--passWithNoTests`；本报告未填写远端 CI run 结果。 |

上述修复直接改善了原审计中的成绩口径、0/缺失/未同步区分、Ledger/roster 完整性、AI course scope、Demo 写保护和错误状态等共享根因，但不能据此把相关的所有编号批量关闭。

## 4. 本轮 UI 恢复与内部可用性改进

### 4.1 分支与合并记录

| 独立分支 | 开发提交 | 主线合并提交 | 交付范围 |
| --- | --- | --- | --- |
| `codex/restore-original-shell` | `1ddaff2` | `8fd36b9` | 恢复紧凑双 persona 左侧栏与原始壳层密度。 |
| `codex/restore-original-platform-ui` | `89b00b8` | `8ed57f2` | 恢复 AI、Grade Sync、Settings 的原始页面结构，同时保留诚实的请求状态。 |
| `codex/platform-narrow-polish` | `a0ac437` | `b6364b1` | 限制超长课程 ID 与宽 AI 结果表在窄屏内溢出。 |
| `codex/restore-original-student-ui` | `059c9c1` | `769ed70` | 恢复 Student Report/Workspace 的原始图表、卡片和信息层级，并继续使用 canonical contract。 |
| `codex/admin-internal-ux` | `af7e899` | `9a33472` | Class Health 内部可用性和可访问语义改进，不改成绩模型和 CSV 导出范围。 |

每个开发 agent 使用独立 worktree 与 `codex/*` 分支；开发 agent 只提交自己的范围，不自行合并。主代理负责查看 diff、检查测试与浏览器表现、退回修改、最终合并并处理冲突。恢复过程中发现的可见精度、unavailable 被显示为 0、exam attempt 丢失、staff 链接丢失 student/course、AI 窄屏溢出和 CSV 搜索改变导出范围等问题，均要求原 agent 在同一分支继续修正后再验收。

### 4.2 已恢复或改进的页面结果

| 区域 | 已进入主线的结果 | 对应持久测试/验收点 | 仍不能宣称的范围 |
| --- | --- | --- | --- |
| 全局导航 | 回到约 244px sidebar / 42px topbar 的紧凑布局；管理员同时看到 Student/Admin 分组；普通学生只见 Student；Demo 状态降为低干扰提示；登录页不保留空侧栏 | `NavBar.test.js`、`personaNavigation.test.js` 覆盖直接刷新、当前/已选学生、course scope、mobile 分组、Settings 不重复、单课程标签和登出 | 未在本报告内完成所有角色 × 所有 viewport 的最终集成矩阵。 |
| Staff 查看学生视图 | Student 链接优先使用 URL 中的学生，其次使用已选学生；保留 `course_id`；无学生时回到 Class Health 选择学生；Class Health 姓名为语义化 report link | route、NavBar、student profile、admin component tests | 所有来源页面的 back/forward、scroll 和 filter 恢复没有逐项关闭。 |
| Student Workspace/Report | 恢复原始 Overall、Performance、类别、考试趋势、score trend 与 assignment detail 结构；保留 canonical exact value，不再以 legacy `/150` 可见总分覆盖 `/400` contract | `GradeDataFlow.test.js`、`studentExperienceModel.test.js`、`studentExperienceV2.test.js` | 未对 180 项中每个 Student 子页面进行最终真实数据视觉复验。 |
| Student 状态可信度 | canonical category 为 `unavailable`/`not_synced`/`request_error` 时不伪装成 0；原始 evidence 仍可见；部分类别不可用时显示 `Partial data` 警告；exam attempt 与 clobber 语义有专门断言 | 状态矩阵、partial warning、canonical precision、attempt grammar、Ledger URL/CSV/date tests | partial data 本身仍是上游数据限制；UI 只诚实披露，没有伪造缺失分数。 |
| AI Analytics | 恢复原始多模块页面层级；只把 live request/result 作为真实课程结果；失败后清除旧结果；不恢复 Zhang/Li、example.com 或跨课程主题等伪真实样例 | `aiAnalytics.test.jsx` 覆盖 course scope、success/empty/object result、403、retry、无静态跨课样例和窄屏长 ID | 真实模型质量、外部模型可用性和生产 course data 未在本报告内验证。 |
| Grade Sync | 恢复原始紧凑卡片、课程、启动/刷新、进度和 source result 结构；Demo 启动在发请求前禁用；不增加第二个课程 selector | `GradeSyncControl.test.jsx` 覆盖 refresh、retry、Demo write barrier、timeout 和 empty detail | 未执行真实 CalNet/Duo/iClicker 人工流程。 |
| Settings | 保留原始长表单；错误显示原因、Retry 和恢复路径；Demo 写操作禁用；显式数值 `0` 不被默认值替换 | `settings.test.jsx` 覆盖保存、retry、Demo、explicit zero 和 timeout | 未在真实配置数据库上执行所有 mutation。 |
| Class Health Students | 新增 name/email 搜索与明确空状态；姓名是保留 course 的键盘可达链接；排序有 accessible name/`aria-sort`；Raw Columns 使用可折叠 disclosure，窄屏默认收起；表格溢出被限制在容器；搜索不会改变原有“导出完整 roster”语义 | `admin.test.jsx` 覆盖 URL tab、搜索、link、CSV、排序和窄屏 disclosure | Assignment 图表、所有 dialog、返回时 scroll/filter 状态及完整无障碍审计没有在本轮逐项重验。 |

### 4.3 与“只优化内部，不大改逻辑”的一致性

本轮 UI 恢复没有整体撤销 canonical grade、evidence、roster、权限和错误 contract。刻意保留的非基线差异仅限于：管理员双分组导航、诚实的 unavailable/partial/error/demo 状态、可分享的 staff student URL、Class Health 搜索/语义排序/折叠控制，以及防止窄屏溢出的局部布局约束。

因此，页面主要视觉骨架回到原始基线，但不会为了“看起来像旧版”而恢复错误总分、伪真实 AI 样例、Demo 可写按钮或把失败/未同步显示成 0。

## 5. 审计覆盖状态

当前可确认的是“根因和目标页面已有修复与测试资产”，不是“180 项逐条关闭”。建议按以下状态交付：

| 问题簇 | 当前状态 | 仍需的关闭证据 |
| --- | --- | --- |
| #1–20 成绩、category、rounding、roster | **已有共享 contract 修复与 Avery/Alex Browser 抽样，仍待完整跨页实数复验** | 在同一真实 fixture 上对 Class Health、Workspace、Report、Alerts、Explain Score 逐值比对。 |
| #21–41 角色、学生选择与 URL | **部分完成；#21/#168 按新需求改写** | student/staff/demo 三类身份的 direct URL、refresh、back/forward、filter/scroll 全流程。 |
| #42–65 Class Health 图表、dialog、Students 表 | **Students 表内部 UX 已改进；其余仍需专项复审** | histogram/图表摘要、dialog 层级、email feedback、完整 13-inch 与 keyboard 证据。 |
| #66–147 Student 各页、Ledger、Explain Score、Policy | **canonical/evidence model 与主要页面恢复已合并，未逐项全关** | 每个 category/status、真实 CSV、时区、全部图表文本替代、Policy 完整性和真实浏览器路径。 |
| #148–163 AI、Sync、Settings、错误状态 | **目标 contract/component 修复与目标 Browser smoke 已完成** | 生产服务、完整权限矩阵和异常环境的端到端回归。 |
| #164–180 响应式、布局、可访问性、loading | **壳层、窄屏溢出和若干语义已改进，仍为部分覆盖** | 多 viewport、200% zoom、keyboard-only、screen reader、reduced motion 和慢网/乱序请求系统复验。 |

在上述证据补齐前，不应把 [audit-report.md](./audit-report.md) 的 180 个编号统一改成 “Resolved”。

## 6. 已知限制与剩余风险

- 当前自动化以 unit、contract 和 component tests 为主，不能替代真实 PostgreSQL、真实 token、真实课程配置与真实外部同步的 E2E。
- 长期运行的 `web` 容器测试依赖卷缺少 `@testing-library/jest-dom`，导致 test runner 在执行测试前失败；同一提交已在干净 detached worktree 和独立依赖卷中复验通过。该现象记录为陈旧/不完整依赖卷的环境问题，不记为代码测试失败。
- Student partial-data 状态是诚实降级，不代表缺失类别已经同步完成；当类别不可用时，总分/letter 仍可能不完整，页面应继续保留警告。
- Class Health 本轮集中修 Students 表，不代表 #42–55 的图表与 dialog 问题已经全部重新验收。
- 原审计要求的完整 keyboard、screen reader、图表文本替代、color-only、heading、zoom 和多 viewport 证据尚未汇总成逐项报告。
- GitHub Actions 已有 API、Website test 和 Website build job，但本报告没有远端 run URL 或 run 结果，不能把 workflow 文件存在写成 CI 已通过。
- 本轮以 `41b3e4b` 为视觉参考，不承诺像素级完全一致；为满足新权限需求、数据可信度和窄屏可用性，保留了少量有目的的差异。
- Concept Map 被明确排除，没有被实现、验收或写入解决方案。

## 7. 主代理最终集成验收记录

以下结果均针对 `main@9a33472`。Website tests 使用干净 detached worktree 与独立依赖卷执行；Browser 验收使用该主线运行实例。

| 最终门禁 | 命令/场景 | 结果 | 证据 |
| --- | --- | --- | --- |
| Main SHA | `git rev-parse HEAD` | **PASS** | `9a33472438de71dce10028a0a0899e2bb3717106` |
| Website tests | `cd website && npm run test:ci` | **PASS** | 18 suites；253/253 tests 通过。 |
| API tests | `cd api && npm test -- --runInBand` | **PASS** | 15 suites；150/150 tests 通过。 |
| Production build | `cd website && CI=true npm run build` | **PASS** | `compiled successfully`。 |
| Git integrity | `git diff --check`、最终 status | **PASS（已知 dirty 文件除外）** | `git diff --check` 无输出；共享 `main` 仅保留第 8 节列出的 5 个用户未提交文档。 |
| Browser desktop shell | 桌面 staff/admin | **PASS** | sidebar 244px、topbar 42px；左侧同时显示 `STUDENT` 与 `ADMIN`。 |
| Browser Student data | Avery 与 Alex Report/Workspace 目标场景 | **PASS** | Avery 显示 `317.13 / 400`，没有 `317 / 400` 或 `Partial data`；Alex 显示 `283.58 / 400`，Labs 为 `Unavailable`，没有 `0 / 80` 或 `0%`，显示 `Partial data`，attempts 为 3/1/1。 |
| Browser narrow Admin | 请求 391px 的 Class Health Students | **PASS（含 runtime 缩放说明）** | Browser runtime 实测页面 `clientWidth = scrollWidth = 521`；三个 tabs 全文可见，Raw Columns 默认折叠；表格 `clientWidth/scrollWidth = 439/1439`，横向滚动限制在表格内部。 |
| Browser narrow AI | AI Alert 与真实查询 | **PASS** | Alert `405/405`、message `339/339`，无内部横向溢出；真实查询返回统计表。 |
| Browser Grade Sync | Demo read-only | **PASS** | `Refresh` 可用，Demo `Start Sync` disabled。 |
| Browser Settings | 权限错误状态 | **PASS** | 显示 `ROLE_FORBIDDEN`、reason 与 recovery。 |
| Persona smoke | staff/admin 与 Demo | **PARTIAL** | staff 双分组导航和 Demo 写入负向路径已实测；普通学生 Browser 路径未在这次最终 smoke 中单独重跑，保留 component test 证据。 |

上述结果满足本轮目标修复和 UI 恢复的集成门禁。它们不能自动推导 180 项全部关闭；未执行的真实服务、角色和逐编号场景仍按第 5、6 节保留。

## 8. 用户未提交文档的保留情况

创建本报告独立 worktree 前，共享主工作区存在以下用户未提交文件：

```text
 M docs/features/berkeley-cs-course-harness.md
 M docs/features/config-and-settings.md
 M docs/features/gradesync.md
 M docs/templates/course-assignments-demo.csv
?? docs/features/course-configuration-control-plane.md
```

这些文件未被本报告分支修改、暂存或提交。本报告分支只新增 `docs/audit-resolution-report.md`；主代理合并时仍应再次核对并保留这些用户改动。

## 9. 交付状态

截至 `main@9a33472`：底层数据/API/CI 修复与本轮 UI 恢复、窄屏修补和 Class Health 内部 UX 改进均已合并；第 7 节的自动化、build 与目标 Browser 集成证据已记录。文档状态为 **本轮目标集成验收通过，剩余审计项继续保留**，不是 **180 项全部解决**。
