# GradeView 审计代码域映射与执行拆分

> 基线：`main@41b3e4b`（2026-07-09）<br>
> 来源：[audit-report.md](./audit-report.md)，共 180 项，已排除 Concept Map。<br>
> 本文只做根因、代码所有权、依赖、分支批次和验收定义；不包含产品实现。

## 1. 结论先行

- 180 个编号已全部映射到代码域和批次，未发现可在缺少运行证据时安全标记为“已关闭”的项目。
- #1–19、#66–70、#117–126 在 `41b3e4b` 后仍未真正关闭。该提交新增了 due-date 传递和 Alerts 的到期作业计算，但没有统一 Class Health、Workspace、Report、Ledger、Explain Score 和 Alerts 的成绩契约。
- 目前最危险的不是 180 个独立缺陷，而是 4 个会放大成多页面症状的共享根因：
  1. 同一成绩在 API、前端 adapter、页面组件和 Grade Flow 中被重复计算、重复取整；
  2. assignment catalog、submission evidence、policy rollup 和同步状态没有统一的数据模型；
  3. 身份、persona、student/course selection 和页面状态分散在 token、`localStorage`、Context 和组件本地 state；
  4. 空、零、未同步、未到期、不适用和请求失败被压缩成 `0` 或空数组。
- 推荐固定 3 名开发 agent，按 3 条文件所有权轨道顺序完成 9 个分支批次。轨道之间可以并行，轨道内部必须串行；这样既利用最多三名并行 agent，也避免多人同时修改巨型文件。

## 2. `41b3e4b` 对重点编号的关闭复核

“已改代码”不等于“已关闭问题”。以下结论以当前源码、调用链和现有测试为依据。

| 编号 | 状态 | 当前证据 | 真正关闭所需证据 |
|---|---|---|---|
| #1、#4–6、#10–16 | **未关闭** | `dbHelper.mjs` policy summary、`studentDataProcessor.js`、`studentProfileData.js`、`studentExperienceV2.js`、`StudentProfileContent.js` 和 `GradeDataFlow.js` 仍各自计算总分/类别分；同时存在 `Math.ceil`、`Math.round` 和保留小数三种显示规则。 | Avery、Jordan 固定 fixture 在所有 API 与页面得到同一 exact total、display total、cap、letter；边界与取整 contract test 全部通过。 |
| #2–3、#7–9 | **未关闭，且有回归风险** | 新增 `isAssignmentDue()` 对没有 due 时间的作业返回 `false`；两个 student processor 会直接跳过这些作业，profile 又在没有到期 evidence 时把 canonical category summary 压成 0。Demo 生成器只把 `due_at` 持久化到 exam map，Attendance/Labs/Projects 没有对应 due 字段。Ledger 仍取自只包含 submission 的 inner join。 | “due 未知”不会被当作“未到期”或 0；catalog 与 evidence 左连接；零分、缺交、无数据、未同步、不适用、失败均有独立状态测试。 |
| #17 | **未关闭** | selector 的 `getStudentsByCourse()` 只返回有 submission 的学生；Class Health 的 `getAllStudentScores()` 从 enrollment/student scope 左连接，仍是不同 roster 定义。 | 同一 course roster service/ID 集合驱动 selector、Class Health、Alerts；含“已注册但无 submission”fixture 的人数 invariant test。 |
| #18–19 | **未关闭** | Alerts 现在重新按“到期 raw work”计算动态分子/分母，再映射到 `/400` grade bin；表格列仍叫 `Total`。Class Health 使用 policy summary `/400`，二者仍不是同一语义。 | Alerts 明确区分 canonical current grade 与 due-work risk metric；学生集合和 canonical grade 与 Class Health 完全一致，风险输入另行可解释。 |
| #66、#68–69 | **未关闭** | Workspace 继续直接消费上述不一致的 `studentData.totalScore`、category blocks 和 raw signals；无 due rows 时可以同时出现 0 分、0 missing、无风险信号。 | Workspace 只消费已验收的 canonical contract；每个卡片对 unavailable/not-synced/error 有独立呈现；跨页 fixture test。 |
| #67 | **未关闭** | `getImportantCategory()` 仍以 `remaining + weakness × cap` 排序，天然偏向 cap 大的 Projects。 | 风险/可行动性排序有书面规则、可解释输入和针对不同 cap 的单元测试。 |
| #70 | **仅有底层铺垫，未关闭** | due/release 时间已传到部分 assignment 对象，但 `getTopActions()` 仍未使用 due 时间、assignment impact 或可执行动作。 | Top Action 显示具体 assignment、期限、时区、影响分数与原因；无期限时明确降级。 |
| #117–121 | **未关闭** | Ledger 的 rows 仍来自 `getStudentSubmissionsByTime()` 的 inner join，并再次过滤 hidden、rollup、无 due rows；搜索/筛选/分组仍是组件本地 state，空筛选没有专门状态。 | catalog 全量行 + evidence 状态；URL 可恢复 filter/search/group；空结果解释范围和数据完整性。 |
| #122–123 | **未关闭** | `Export` 按钮仍没有 handler，也没有格式/范围说明。 | 导出当前筛选或全部的范围可见、文件格式可见，并有内容断言测试。 |
| #124 | **未关闭** | Ledger 使用的 `studentExperienceV2.formatDate()` 仍不显示年份和时区。 | 明确 locale/year/time-zone，固定时区测试不随运行机器变化。 |
| #125–126 | **未关闭** | 每个 group 仍渲染一套 `AssignmentEvidenceTable` 表头；页面仍宣称 `complete raw assignment table` / `Full ledger`。 | 单表或明确分组语义；文案与实际 contract 一致；全量行数断言。 |

特别注意：`41b3e4b` 的 due-date 改动需要在 Batch A2 先补“due unknown”语义和回归测试，不能直接作为 #70 或 Ledger 完成证据。

## 3. 共享根因簇

| 根因簇 | 性质 | 主要代码入口 | 会覆盖的症状 |
|---|---|---|---|
| RC-1 Canonical grade contract 缺失 | 一处根因，多页症状 | `api/lib/dbHelper.mjs`、`api/lib/coursePolicy.mjs`、student profile/grade-flow/bins/admin score routes、`studentDataProcessor.js`、`studentProfileData.js` | 总分、类别分、分母、letter、rounding、gap、risk 全部不一致。 |
| RC-2 Catalog/evidence/policy/status 混用 | 一处根因，多页症状 | `getStudentSubmissionsByTime()`、`getStudentSubmissionsGrouped()`、profile aggregate、`assignmentDue.js`、Ledger/category adapters | 只有考试、missing 不见、0 与无数据混淆、Attendance/Labs/Projects 空。 |
| RC-3 Course roster 定义不一致 | 一处根因，多页症状 | `getStudentsByCourse()`、`getAllStudentsFromDb()`、`getAllStudentScores()`、`/students`、`/admin/studentScores` | 28/32 人、selector、Alerts、Class Health 不一致。 |
| RC-4 Identity/persona/demo 未建模 | 一处根因，多入口症状 | login/session token/IAM/auth middleware、`NavBar.js`、`App.js`、`studentProfile.jsx` | Student/Admin 同时出现、staff impersonation 不清、Demo 写按钮可用。 |
| RC-5 URL 不是状态源 | 一处根因，多导航症状 | `App.js`、`StudentSelectionWrapper.js`、`studentProfile.jsx`、`admin.jsx`、`studentExperienceV2.js` | 不可深链、历史不可理解、返回丢 tab/filter/scroll。 |
| RC-6 巨型页面组件承担数据推导和呈现 | 混合根因 | `studentExperienceV2.js`、`StudentProfileContent.js`、`admin.jsx`、`aiAnalytics.jsx` | 模式只改文案、重复内容、空状态、信息层级和测试困难。 |
| RC-7 可视化语义与交互模型错误 | 独立 UI/可访问性 | `admin.jsx` + distribution API、Chart.js、`GradeDataFlow.js` | 频数画折线、点不可见、颜色单通道、图表无文本/键盘摘要。 |
| RC-8 Error/empty/loading 状态机缺失 | 一处根因，多页症状 | API cache/fetch adapters、Settings、GradeSync、student pages、AI page | 请求失败、空、0、未同步相似；白屏、闪烁、无 retry。 |
| RC-9 Policy presentation 不完整 | 独立内容/解释 | `coursePolicy.mjs`、bins route、PolicyReference、exam/lab/project UI | bin 重叠、clobber/drop/scale/cap 规则和例子缺失。 |
| RC-10 全局语义与响应式基线不足 | 独立 UI/可访问性 | `App.js`、`NavBar.js`、`Footer.js`、`app.css`、页面 headings/tabs/tables/charts | 空侧栏、遮挡、多个 H1、无 skip link、错误 tab/button 语义。 |

修复策略必须先处理 RC-1/2/3，再验收 Workspace/Report/Alerts 等下游页面。逐页“把 0 改成别的数字”会掩盖根因，不能作为关闭证据。

## 4. 180 项覆盖映射

下表给出每个编号的主归属。一个编号可以受多个根因影响，但只有一个主批次负责交付和关闭证据。

| 覆盖编号 | 属性 | 根因簇 | 代码/模块 | 主批次 |
|---|---|---|---|---|
| #1、#4–6、#10–16、#18–19 | 共享数据根因 | RC-1、RC-2 | policy summaries、profile/grade-flow/bins、admin scores、Alerts、student adapters/consumers | A1（#18–19 联合 C2 验收） |
| #2–3、#7–9 | 共享 evidence/status 根因 | RC-2、RC-8 | submissions/catalog queries、profile aggregate、`assignmentDue.js`、Ledger/Workspace | A2（B2 消费） |
| #17 | 共享 roster 根因 | RC-3 | students/admin score routes 与 db helpers | A2（C2 联合验收） |
| #20 | policy contract | RC-1、RC-9 | `coursePolicy.mjs`、bins parsing/lookup | A1 |
| #21–26 | 独立 identity/persona UX | RC-4、RC-5 | `NavBar.js`、`App.js`、`studentProfile.jsx`、report/policy shell | B1、C1 |
| #27–28 | 共享 Demo 能力根因 | RC-4 | login/token/auth write barriers、NavBar、GradeSync/Settings | A3、C1、C3 |
| #29–31 | 共享路由根因 | RC-5 | `App.js`、student route resolver、selector navigation | B1 |
| #32–35 | 独立 selector/loading UX | RC-4、RC-5、RC-8 | `studentProfile.jsx`、StudentSelection context | B1 |
| #36–41 | 共享 URL state 根因 | RC-5 | `admin.jsx`、student page tabs/filters、router search params | B1、C2 |
| #42–47 | 独立 chart 语义/可访问性 | RC-7 | distribution API、Class Health Chart.js dialog | C2 |
| #48–52 | 独立 dialog/navigation UX | RC-6、RC-7 | `admin.jsx` statistics/student dialogs | C2 |
| #53–55 | 独立反馈/状态表达 | RC-7、RC-10 | Class Health chart/email actions | C2 |
| #56–60 | 独立 table layout/search | RC-6、RC-10 | Class Health Students toolbar/table virtualization | C2 |
| #61–63 | 独立 table accessibility | RC-10 | student link cells、sort controls/`aria-sort` | C2 |
| #64–65 | 独立 density/layout | RC-6、RC-10 | score view/raw columns、table container、Footer | C2、C1 |
| #66–69 | data-dependent Workspace | RC-1、RC-2、RC-6 | workspace selectors/signals/category cards | A1、A2 后由 B2 关闭 |
| #70–72 | 独立 Workspace action/hierarchy | RC-6 | `getTopActions()`、Workspace PageFrame/metrics | B2 |
| #73–77 | 独立 report persona/form UX | RC-4、RC-6、RC-10 | outer profile shell、report actions/notes | B1、B3 |
| #78–82 | data-dependent report + chart hierarchy | RC-1、RC-2、RC-6、RC-7 | report snapshot、StudentProfileContent/category blocks/charts | B2、B3 |
| #83–88 | data-dependent Attendance page | RC-2、RC-6、RC-8 | category detail/evidence/filter/action/deep-link | A2 后由 B2 关闭 |
| #89–96 | data-dependent Labs page | RC-2、RC-5、RC-6 | category tabs/evidence/policy/filter/ledger link | A2 后由 B2 关闭 |
| #97–102 | data-dependent Projects page | RC-2、RC-6 | project evidence/status/policy/action | A2 后由 B2 关闭 |
| #103–110 | 独立 exam mode/rounding UX | RC-1、RC-6、RC-9 | ExamsOverview、SingleExam、ClobberLadder | A1 后由 B2 关闭 |
| #111–115 | 独立 exam visualization/accessibility | RC-7、RC-10 | TopicMasteryRadar、QuestionBestMatrix | B3 |
| #116 | 独立信息架构 | RC-6 | exam overview/detail composition | B2 |
| #117–120 | data-dependent Ledger completeness/empty state | RC-2、RC-8 | catalog/evidence API + AssignmentLedger | A2 后由 B2 关闭 |
| #121–126 | 独立 Ledger state/export/date/IA | RC-5、RC-6、RC-10 | AssignmentLedger controls/grouping/export/formatter | B1、B2 |
| #127、#137 | 共享 total 根因的 Explain 症状 | RC-1 | grade-flow API 与 canonical grade contract | A1 后由 B3 验收 |
| #128–132 | 独立 graph 默认复杂度/controls | RC-6、RC-7 | `GradeDataFlow.js` expansion state/toolbar | B3 |
| #133–136、#138 | 独立 graph 任务流/accessibility | RC-7、RC-10 | React Flow nodes、MiniMap/Controls、screen-reader summary | B3 |
| #139 | policy boundary contract | RC-1、RC-9 | grade bins schema、lookup、PolicyReference | A1、B3 |
| #140 | 独立 persona/IA | RC-4 | Policy route/profile shell/NavBar | B1 |
| #141–147 | 独立 policy completeness/explanation | RC-9 | policy schema/response、PolicyReference、student impact | A1、B3 |
| #148–150 | 共享 course scope/error 根因 | RC-4、RC-8 | AI service request、admin middleware、AI query route | A3、C3 |
| #151–155 | 独立 real-vs-sample trust UX | RC-6、RC-8 | `aiAnalytics.jsx` static datasets/result states | C3 |
| #156–158 | 共享 Demo/global-course state | RC-4、RC-5 | sync write barrier、GradeSync page、global course selector | A3、C3 |
| #159–163 | 共享 error/empty/status 根因 | RC-8 | Settings/config APIs、retry/recovery、shared request states | A3、C3 |
| #164–169 | 独立 global responsive/layout | RC-4、RC-10 | App/NavBar/Footer/login/app.css/course selector | B1、C1 |
| #170–178 | 独立 global accessibility | RC-7、RC-10 | landmarks/headings/links/sort/charts/color/icons/tabs | B3、C2、C3 |
| #179–180 | 共享 state machine/loading 根因 | RC-8 | route guards、profile/admin/settings/AI empty/loading shells | B1、B2、C3 |

以下隐藏标记仅用于自动校验上表编号覆盖，不参与渲染：

<!-- AUDIT_IDS:1,4-6,10-16,18-19 -->
<!-- AUDIT_IDS:2-3,7-9 -->
<!-- AUDIT_IDS:17 -->
<!-- AUDIT_IDS:20 -->
<!-- AUDIT_IDS:21-26 -->
<!-- AUDIT_IDS:27-28 -->
<!-- AUDIT_IDS:29-31 -->
<!-- AUDIT_IDS:32-35 -->
<!-- AUDIT_IDS:36-41 -->
<!-- AUDIT_IDS:42-47 -->
<!-- AUDIT_IDS:48-52 -->
<!-- AUDIT_IDS:53-55 -->
<!-- AUDIT_IDS:56-60 -->
<!-- AUDIT_IDS:61-63 -->
<!-- AUDIT_IDS:64-65 -->
<!-- AUDIT_IDS:66-69 -->
<!-- AUDIT_IDS:70-72 -->
<!-- AUDIT_IDS:73-77 -->
<!-- AUDIT_IDS:78-82 -->
<!-- AUDIT_IDS:83-88 -->
<!-- AUDIT_IDS:89-96 -->
<!-- AUDIT_IDS:97-102 -->
<!-- AUDIT_IDS:103-110 -->
<!-- AUDIT_IDS:111-115 -->
<!-- AUDIT_IDS:116 -->
<!-- AUDIT_IDS:117-120 -->
<!-- AUDIT_IDS:121-126 -->
<!-- AUDIT_IDS:127,137 -->
<!-- AUDIT_IDS:128-132 -->
<!-- AUDIT_IDS:133-136,138 -->
<!-- AUDIT_IDS:139 -->
<!-- AUDIT_IDS:140 -->
<!-- AUDIT_IDS:141-147 -->
<!-- AUDIT_IDS:148-150 -->
<!-- AUDIT_IDS:151-155 -->
<!-- AUDIT_IDS:156-158 -->
<!-- AUDIT_IDS:159-163 -->
<!-- AUDIT_IDS:164-169 -->
<!-- AUDIT_IDS:170-178 -->
<!-- AUDIT_IDS:179-180 -->

## 5. 三条开发轨道与九个分支批次

每个批次必须从当时最新 `main` 新建独立 worktree/branch。一个 agent 固定负责一条轨道，完成一个批次并通过主 agent 验收后，再创建该轨道下一个分支。开发 agent 不自行 merge。

### Track A — 数据契约与 API（Agent A，轨道内串行）

#### Batch A1 — `codex/audit-score-contract`

**独占文件域**

- `api/lib/coursePolicy.mjs`
- `api/lib/dbHelper.mjs` 中 policy summary/grade-flow/rounding 相关函数
- `api/v2/Routes/bins/**`
- `api/v2/Routes/students/{profile,grade-flow,exam-policy}/**`
- `api/v2/Routes/admin/studentScores/**`
- `website/src/utils/studentDataProcessor.js`
- `website/src/utils/studentProfileData.js`
- 对应 API/纯函数测试文件

**需求**

- 建立唯一 canonical grade contract，至少包含 exact score、display/rounded score、cap、percentage、letter、grade-bin、as-of/source、每类别 exact/cap/status。
- 页面不得再自行决定总分、letter 或 rounding；raw、policy final、due-work progress 必须是不同命名字段。
- Grade Flow 的 total 必须引用同一 canonical result，不得另算。
- grade bins 使用无歧义边界或明确的包含规则；配置写入时拒绝重叠/空洞。

**验收标准**

- Avery 和 Jordan 的 canonical fixture 在 Class Health API、profile API、grade-flow API、Alerts 输入和前端 adapter 上 exact total/cap/letter 完全一致。
- Quest/Midterm/Postterm 的明细、subtotal、标题和 ladder 明确区分 exact 与 rounded，且不会出现同语义不同值。
- `389.49`、`389.50`、`390`、`370`、`360`、`240` 等边界各自只命中一个 grade。
- 删除/阻止页面级 `Math.ceil`/`Math.round` 对 canonical score 的再次决策；格式化可以保留，但不能改变业务值。

**测试建议**

- Jest 纯函数表驱动测试：rounding、bins、category cap、exam policy。
- Supertest contract test：profile、grade-flow、studentScores 对同一 mocked DB fixture 的 invariant。
- 前端 adapter snapshot/shape test：禁止缺失字段回退成另一套计算。

#### Batch A2 — `codex/audit-evidence-roster`

**依赖**：A1 已 merge。

**独占文件域**

- `api/lib/dbHelper.mjs` 中 assignment catalog、submission evidence、roster、due/release 相关函数
- `api/v2/Routes/students/{grades,profile,index.js}`
- `api/v2/Routes/admin/assignments/**`
- `website/src/utils/assignmentDue.js` 及对应 adapter tests

**需求**

- 用 course assignment catalog 左连接 student evidence，不能用“有 submission 的 rows”冒充完整 Ledger。
- 给每行明确状态：至少区分 earned zero、missing、not due、due unknown、not synced、not applicable、request error。
- due unknown 不得静默排除；release/due 只能影响时间语义，不能抹掉 canonical policy score。
- selector、Class Health、Alerts 使用同一 enrolled roster；无 submission 的已注册学生仍在集合中。

**验收标准**

- Ledger 行数等于该课程可见 catalog 行数；Attendance/Labs/Projects/Exams 分类均可出现。
- `score = 0 + submitted`、`no submission + past due`、`no submission + future due`、`no due metadata`、`source not synced` 五个 fixture 显示五种不同状态。
- Demo fixture 中非考试作业即使没有持久化 due，也不会从 profile/Ledger 消失或把 policy summary 强制成 0。
- `/students`、`/admin/studentScores`、Alerts 的 student ID 集合完全一致。

**测试建议**

- DB/query contract tests：catalog without submission、student without submissions、hidden/raw categories、unknown due。
- Property/invariant test：任意 evidence 子集都不能改变 catalog 总行数。
- 对 `41b3e4b` 的 non-exam/no-due 场景增加明确回归测试。

#### Batch A3 — `codex/audit-scope-demo-api`

**依赖**：A1；可与 A2 后半段并行准备，但同一 Agent A 仍串行提交。

**独占文件域**

- `api/lib/{authlib,iam,sessionToken}.mjs`
- `api/v2/Routes/{login,admin/index.js,admin/ai-query,admin/sync,config}/**`
- 对应授权/负向 API tests

**需求**

- `is_demo`/read-only capability 从 token 到所有写 endpoint 一致传播；服务端是最终写保护边界。
- AI schema/query 请求和实际 SQL 都强制 course scope，不能只检查 query string 后执行未过滤 SQL。
- 错误响应提供稳定 code、可显示原因和可恢复动作，不以“请登录”掩盖 course scope 错误。

**验收标准**

- Demo token 对 sync/config/permission 等 mutation 一律得到稳定只读错误，数据库无写入。
- course admin 缺 course ID 得到明确错误；携带获授权 course ID 成功；越权 course ID 失败。
- AI 结果中不出现其他 course 数据；rule-based 与 AI-generated 两条路径都受 scope 约束。

**测试建议**

- Supertest 权限矩阵：student/staff/course admin/super admin/demo × read/write × own/other course。
- SQL 生成/规则查询的 course predicate assertion。
- mutation 前后 DB snapshot/spy 断言 Demo 无副作用。

### Track B — Student 路由与体验（Agent B，轨道内串行）

#### Batch B1 — `codex/audit-student-routing`

**可与 A1 并行。独占文件域**

- `website/src/App.js`
- `website/src/components/StudentSelectionWrapper.js`
- `website/src/views/studentProfile.jsx`
- 本批次对应 route/selection tests

**需求**

- student/course/page/tab/filter 使用可分享、可恢复的 URL；staff review 路由包含稳定 student identifier。
- 明确 self/student-review persona；切换学生产生可理解 history，并提供返回 Class Health 的路径。
- selector 支持搜索，显示姓名之外的唯一信息；加载时保留安全 skeleton，禁止显示旧学生身份/内容。
- App 建立 `main` landmark、skip link、正确的登录/未登录 shell，避免多个页面自行制造顶层 H1。

**验收标准**

- 复制 URL 到新会话能恢复 course、student、页面及合法 tab/filter；浏览器前进/后退逐步恢复状态。
- staff 从 Class Health 打开、切换学生、返回后，persona 和来源清楚，不泄露旧学生数据。
- 慢请求/乱序响应测试中，旧学生 response 不能覆盖当前学生。
- 未登录桌面页面没有 244px 空侧栏，登录卡相对整个 viewport 居中。

**测试建议**

- MemoryRouter/component tests：deep link、history、invalid params、race/abort。
- Playwright 两上下文测试：staff review 与 student self。
- 1280×800 和移动 viewport 的 shell screenshot。

#### Batch B2 — `codex/audit-student-pages`

**依赖**：A1、A2、B1 已 merge。

**独占文件域**

- `website/src/components/studentExperienceV2.js`
- `website/src/components/StudentProfileContent.js`
- `website/src/components/StudentCategoryBlocks.js`
- 本批次对应 student-page tests

**需求**

- Workspace、Report、Attendance、Labs、Projects、Exams、Ledger 只消费 A1/A2 contract，不再猜测状态或重算总分。
- 每个状态有诚实文案；无 evidence 时禁用无意义 filter，并给同步/范围说明。
- Top Actions 使用具体 assignment、due/time zone、point impact 和原因。
- Exam modes 必须真正改变信息结构；无 clobber/单 attempt 时收敛冗余。
- Ledger 提供真实导出、范围说明、单一清晰表结构和 URL filter。

**验收标准**

- 同一 fixture 的 Workspace、Report、category detail、exam title、Ledger 与 Explain Score 的 canonical 值一致。
- 所有 category 有 evidence/state；相关链接自动携带 category/filter，而不是进入未过滤 Ledger。
- Ledger 全量、当前筛选、空筛选、导出、日期时区均有断言。
- `1 attempt` 语法正确；raw/question-best/clobber 模式各自只显示相关证据。

**测试建议**

- React component table tests：每种 data status × 每个 category。
- CSV export golden test；固定 `America/Los_Angeles` 与 UTC 日期测试。
- Playwright 任务流：Workspace action → filtered Ledger → assignment detail → back state。

#### Batch B3 — `codex/audit-student-a11y-policy`

**依赖**：B2、A1。

**独占文件域**

- `website/src/components/GradeDataFlow.js`
- B2 所有文件中的 accessibility/policy 收尾（仍由同一 Agent B 修改，避免冲突）
- 本批次对应 accessibility tests

**需求**

- Explain Score 默认只显示学生完成任务所需的摘要，技术图谱作为渐进披露；互斥 control 只显示当前可执行动作。
- React Flow node、radar、donut 提供键盘路径和可读文本结论，内部 ID/Edge/Mini Map 等术语不进入普通学生主任务流。
- Policy 显示不重叠 grade bins、完整 clobber/drop/scale/cap 规则、总分 400 汇总、计算例子和当前学生实际影响。
- Report notes 有可见 label、保存/错误状态；heading 层级唯一且连续。

**验收标准**

- 键盘可完成展开/收起、读取摘要、返回；无“可点击 div”或同时显示 Show/Hide。
- 每张图都有与视觉数据一致的文本结论/表格替代；隐藏 canvas 后核心结论仍可获得。
- 每页仅一个 H1；主区块按 H2/H3 排列；notes 的 label/status 被 screen reader 读出。
- Policy 的每条规则可追溯到配置字段，并用当前学生 fixture 展示前后值。

**测试建议**

- Testing Library keyboard/name/role assertions；axe smoke test。
- Playwright keyboard-only flow 和 reduced-motion/zoom 200% 检查。
- 图表数据与文本摘要的同源函数单元测试。

### Track C — Admin、平台页与全局壳（Agent C，轨道内串行）

#### Batch C1 — `codex/audit-shell-role-demo`

**可与 A1、B1 并行。独占文件域**

- `website/src/components/{NavBar,Footer,NavMenuItem,NavBarItem}.js`
- `website/src/views/login.js`
- `website/src/css/app.css`、`website/src/css/index.css`
- 本批次对应 shell tests

**需求**

- 导航由 active persona/capability 决定，不同时铺开 Student 与 Admin 两套一级导航。
- Demo/read-only 状态全局持续可见；只有一门课时使用静态课程标签而非下拉。
- desktop/mobile course title 可读；Footer 不覆盖内容；全局布局配合 B1 的 main/skip-link contract。

**验收标准**

- student、staff、course admin、demo 四种 persona 的一级导航集合有快照/role assertion。
- 只有一门课程时没有可交互 combobox；长课程名有可读完整名称。
- 1280×800 下无 footer 覆盖、空侧栏或登录偏移。

**测试建议**

- 权限矩阵 component tests；NavBar 不依赖短暂默认 `isAdmin=false` 产生身份闪烁。
- Playwright desktop/mobile visual regression。

#### Batch C2 — `codex/audit-class-health`

**依赖**：A1、A2；C1 已 merge。

**独占文件域**

- `website/src/views/admin.jsx`
- `website/src/views/alerts.jsx`
- `api/v2/Routes/admin/{distribution,stats,categories}/**`（若需变更，由 Agent A 审阅 contract，不与 A 轨道同时修改）
- 本批次对应 admin tests

**需求**

- 频数分布使用 histogram/bar 语义与合理 bins/ticks；选中状态不仅靠颜色，并提供文本数据摘要。
- 统计详情与学生列表使用一个可理解的 dialog/drill-down 层级；close 持续可见，Markdown 不泄露。
- Students 表默认低密度 policy view，提供 student search、显式横向滚动提示、语义链接和可访问排序。
- tab/filter/search/columns/scroll 由 URL 或明确恢复机制管理。
- Alerts 显示 A1 canonical grade，并把 due-work/risk 作为不同指标；student roster 与 Class Health 一致。

**验收标准**

- 13 英寸 viewport 首屏能看到有意义学生行，右侧列可发现/可达，Footer 不遮挡。
- student name 是 link/button；sort button 有名称，header 暴露 `aria-sort`；键盘可完成排序和打开详情。
- chart 不再把频率暗示为时间；选中范围有形状/边框/文字；canvas 外有摘要表。
- Alerts 与 Class Health 对同一 fixture 的 student IDs、canonical total/cap/letter 完全一致。

**测试建议**

- distribution bin unit tests；chart config snapshot。
- Testing Library table semantics/search/sort tests。
- Playwright：设置表状态 → 打开 student → back → 状态/scroll 恢复。

#### Batch C3 — `codex/audit-platform-pages`

**依赖**：A3、C1；建议最后承担前端测试 harness/CI 文件所有权。

**独占文件域**

- `website/src/services/aiAgent.js`
- `website/src/views/{aiAnalytics,GradeSyncControl,settings}.jsx`
- `website/package.json`、lockfile、`.github/workflows/ci.yml`（仅本批次可改）
- 本批次对应 platform tests

**需求**

- AI 请求始终带选中 course ID；失败只显示失败，不继续展示未标记 sample；任何 sample/mock 都有持续、明显标签。
- 移除与当前 course 无关的静态人名/主题，或隔离到明确 Sample 模式。
- Demo 的 Start Sync/Settings mutation 禁用并解释服务端只读状态；避免页面内重复 course selector。
- Settings 保留结构化错误原因、Retry、恢复路径；所有平台页使用统一 loading/empty/error/success 状态模型。
- 建立前端 test script 和 CI，不允许 `--passWithNoTests` 掩盖关键 contract 没有测试。

**验收标准**

- 示例查询携带授权 course ID，成功/403/500 三条 UI 状态可区分；失败后页面没有伪装成真实的分析卡片。
- Demo UI 和 API 双层禁止写；按钮状态、banner 和错误 code 一致。
- Settings 错误展示原因和 retry；retry 成功后恢复，不刷新整页。
- CI 至少执行 A/B/C 三轨关键 unit/component/API tests，而不只是 build。

**测试建议**

- Mock Service Worker 或 fetch mocks：AI/config/sync 成功、403、500、timeout。
- Playwright Demo mutation negative flow。
- CI fail test：临时无测试匹配时必须失败，防止空通过。

## 6. 依赖与并行顺序

| 波次 | Agent A | Agent B | Agent C | 合并门槛 |
|---|---|---|---|---|
| Wave 1 | A1 score contract | B1 student routing | C1 shell/role/demo | 三者文件域互斥；A1 的 contract 先验收。 |
| Wave 2 | A2 evidence/roster | 等待 A1/A2 后做 B2 | 等待 A1/A2 后做 C2 | A2 必须先证明 non-exam/no-due 不回归；再验收 B2/C2。 |
| Wave 3 | A3 scope/demo API | B3 student a11y/policy | C3 platform pages/test harness | C3 依赖 A3；最终跑全量 contract/E2E。 |

建议合并顺序：`A1 → B1 → C1 → A2 → B2 → C2 → A3 → B3 → C3`。B1/C1 可以在 A1 开发期间并行，但主 agent 应按该顺序验收并 merge，以便冲突定位清楚。

## 7. 文件冲突边界

- Agent A 独占 `api/**` 和 `website/src/utils/student*`/`assignmentDue.js`。C2 若确需修改 admin distribution API，必须等 A2 merge 后单独提交，且由 Agent A 做 contract review。
- Agent B 独占 `App.js`、student route/profile 和 student experience/Grade Flow 文件。
- Agent C 独占 NavBar/Footer/global CSS、Admin/Alerts/AI/GradeSync/Settings、前端 package/CI。
- 不允许 B/C 直接在页面里复制 canonical score 计算；需要字段时回到 A 轨道扩展 contract。
- 不允许两个 agent 同时修改 `studentExperienceV2.js`、`admin.jsx`、`dbHelper.mjs` 这三个高冲突巨型文件。

## 8. 主 agent 验收门禁

每个开发 agent 回报 branch/SHA 后，主 agent按以下顺序验收；任一失败都应把同一 branch 退回原 agent 继续修改，不另开“补丁 agent”。

1. **范围门禁**：diff 只触及批次所有权文件；没有顺手重构或未授权产品改动。
2. **编号门禁**：PR/commit 明确列出覆盖编号、未覆盖编号、已知限制，且与本文主批次一致。
3. **契约门禁**：先看 exact 数据和状态 contract，再看 UI；不接受仅截图“看起来对了”。
4. **自动化门禁**：新增/更新测试必须能在干净环境失败后修复；不接受 `passWithNoTests` 作为证据。
5. **跨页门禁**：Avery/Jordan fixture 的 canonical total/category/letter 在 Class Health、Workspace、Report、Alerts、Explain Score 一致。
6. **负向门禁**：无 due、无 submission、真实 0、未同步、API 失败、Demo 写入、越权 course 都必须覆盖。
7. **可访问性门禁**：键盘、accessible name、heading/landmark、非颜色状态、图表文本替代都有自动化或录屏/截图证据。
8. **响应式门禁**：至少验证 1280×800、1440×900 和移动 viewport；无 footer 覆盖、隐藏操作或不可发现横向滚动。
9. **集成门禁**：merge 前 rebase 最新 `main`，解决冲突后重跑本批次和已合入轨道的回归套件。

## 9. 当前测试缺口

- `api` 配置了 Jest，但仓库没有实际 API Jest test；CI 使用 `--passWithNoTests`，因此“绿灯”不能证明成绩或权限正确。
- `website` 只有 build script，没有 test script，也没有已跟踪的 component/E2E tests。
- 现有 Python tests 只覆盖 iClicker/GradeSync 局部，不覆盖 180 项中的跨页 contract、路由、UI 或可访问性。

因此，第一条可接受的“问题已关闭”证据必须来自 A1/A2 建立的 fixture/invariant tests；后续页面批次再用 component/E2E 证明呈现和任务流。

## 10. 编号覆盖自检

- 附件声明总数：180。
- 本文 `AUDIT_IDS` 标记展开后的唯一编号：180。
- 缺失编号：无。
- 重复主归属：无。
- 批次数：9（A1–A3、B1–B3、C1–C3）。
