# GradeView 两轮审计问题汇总

> 范围：两轮审计发现的问题；已排除 Concept Map 相关问题；仅记录问题，不包含解决方案。
>
> 来源：用户提供的审计文本附件。原文共列出 180 项问题，编号 1–180 连续。

## 一、成绩与数据可信度

1. 同一学生在不同页面显示完全不同的总分。

   - Avery Chen：
     - Class Health：`319.67 / 79.92%`
     - Explain Score：`319.7 / 400`
     - Workspace、Report：`141 / 400 · F`
   - Jordan Singh：
     - Class Health：`368.33 / 92.08%`
     - Explain Score：`368.3 / 400`
     - Workspace、Report：`147 / 400 · F`

2. Student 页面基本只读取了考试数据，Attendance、Labs、Projects 被错误显示为 0。

3. `0 分`、`没有数据`、`尚未同步`、`没有该类别`没有区分，全部表现为 0。

4. Jordan 的 Attendance 页面显示 `0/15`，Explain Score 显示 `15/15`。

5. Jordan 的 Labs 页面显示 `0/80`，Explain Score 显示 `53.3/80`。

6. Jordan 的 Projects 页面显示 `0/155`，Class Health 显示约 `153`。

7. Assignment Ledger 宣称是完整 raw assignment table，实际只有 5 条考试记录。

8. Assignment Ledger 的 Category 下拉框只有 Midterm、Postterm、Quest，没有 Labs、Projects、Attendance。

9. Workspace 显示 0 分类别，同时又显示 `0 missing` 和 `No recent risk signals found`，状态自相矛盾。

10. Current Grade 显示 F，但 Class Health 和 Explain Score 的完整成绩接近 B/B-，严重误导学生和教师。

11. Workspace 的 `Next grade gap`、`Most important area`、`Top Actions` 都建立在错误总分上。

12. Report 的考试明细与考试 subtotal 对不上。

    - Jordan：25 + 48.4 + 72.3 ≈ 145.7
    - 页面显示 `147 / 150`

13. Report 的 rounding 结果与 Policy 中“总分计算后再四舍五入”的描述不一致。

14. Quest 详情标题显示 `25/25`，Clobber Ladder 显示 `Final used 24.5/25`。

15. Avery 的 Report 顶部、Overall Summary 和类别卡片中，Quest、Midterm、Postterm 的取整结果也不一致。

16. Report 同时使用 `/400` 和 `/150` 两种分母，但都显示为当前成绩信息。

17. Class Health Students 表列出 28 名学生，Student selector 和 Alerts 数据中出现 32 名学生。

18. Alerts 使用 `/150` 计算风险等级，而课程总分为 `/400`。

19. Alerts 的人数、成绩和风险结果与 Class Health Students 表不一致。

20. Policy 的等级区间存在边界重叠：

    - A+：390–400
    - A：370–390
    - A-：360–370
    - 其他等级也存在同类问题。

## 二、角色与权限表达混乱

21. Demo Course 登录后同时完整显示 Student 和 Admin 两套一级导航。

22. 当前究竟是学生本人视角、教师视角还是管理员视角不清楚。

23. Student 区域中存在明显的 Staff 功能：

    - Select Student
    - Staff notes
    - Mark reviewed
    - Copy summary
    - Print
    - Student Report 文案直接写着 `staff review`

24. Course Admin 进入学生页面后，没有明显的 `Student Review` 或 impersonation 状态提示。

25. Student 页面没有清晰的“返回班级列表/返回 Class Health”路径。

26. Policy 是课程级内容，但仍显示当前学生姓名和 Select Student。

27. Grade Sync 在 Demo 模式下仍显示可用的 `Start Sync`。

28. Demo 模式没有统一的只读状态提示。

## 三、学生选择与导航状态

29. 切换学生后 URL 仍然只是 `/profile`、`/profile/report` 等，不包含 student ID。

30. 当前学生页面无法通过 URL 分享或稳定深链。

31. 学生切换不会形成可理解的浏览器历史。

32. Student selector 包含 32 个姓名，但不能搜索。

33. Student selector 只显示姓名，不显示邮箱、section 等辅助信息。

34. 学生切换过程中主体内容整块消失，只剩姓名和 disabled selector。

35. 部分页面加载初期会短暂显示 `GradeView Demo`、旧学生邮箱或旧学生内容。

36. 从 Class Health Students 表进入学生详情后，浏览器返回会重置到 Assignments 标签。

37. 返回后 Students 表的滚动位置、筛选和列选择全部丢失。

38. Assignments 的搜索词、状态筛选和分组方式离开页面后丢失。

39. Labs 的 Overview/Lab List/Policy 状态离开页面后丢失。

40. Exams 的 Raw/Question Best/After Clobber 状态离开页面后丢失。

41. 页面内 tab 和 filter 状态没有体现在 URL 中。

## 四、Class Health 与成绩分布

42. Assignment 页面把成绩频数分布画成折线图，容易被理解为时间趋势。

43. 0–50 的大量横轴刻度非常拥挤。

44. 页面提示点击 points，但数据点默认不可见。

45. 页面提示选中范围会变绿，但原始折线本身已经是绿色/青绿色。

46. 选中状态主要通过颜色表达，差异不明显。

47. 图表在无障碍树中只是图像，没有可读数据摘要。

48. 图表弹窗几乎占满 13 英寸屏幕。

49. 图表弹窗存在内部滚动条。

50. Close 按钮位于弹窗底部，而不是持续可见的位置。

51. 从图表进入学生列表后形成嵌套弹窗返回结构。

52. 学生列表弹窗标题暴露 `**Midterm 1**` Markdown 标记。

53. 页面使用 💡、📈、📧 等 emoji 作为结构图标。

54. 点击 `Generate Email` 后，当前页面没有明显状态变化或成功/失败反馈。

55. 图表筛选后出现 View Selected，但选中了哪个区间仍不够突出。

## 五、Class Health Students 表

56. 13 英寸窗口中表格明显横向溢出。

57. 右侧列被截断，横向滚动入口不明显。

58. 表格上方的 Score View、Raw Columns 和分类按钮占用大量首屏空间。

59. 真正的学生数据在首屏只能显示少量行。

60. 没有学生搜索框。

61. 学生姓名视觉上可以点击，但无障碍语义只是普通 container，不是 link/button。

62. 部分排序按钮没有可访问名称。

63. 排序状态没有清晰的语义表达。

64. Policy totals 与 raw assignments 同时展示时信息密度过高。

65. Footer 覆盖表格底部区域。

## 六、Workspace

66. Final standing、Next grade gap 和 Most important area 都基于错误成绩。

67. `Most important area = Projects` 看起来只是因为 Projects cap 最大，不是基于真实学习风险。

68. Category Summary 显示考试已提交，但分数仍是 0。

69. Recent Signals 在大量类别为 0 时仍显示没有风险信号。

70. Top Actions 只有泛化建议，没有具体 assignment、截止时间或影响分数。

71. `Open report` 与侧栏 Report 功能重复。

72. 所有顶部指标卡视觉权重接近，错误的 F 成为最强信息。

## 七、Student Report

73. Student Report 页面同时存在学生姓名 H1 和 Student Report H1。

74. 页面文案是 Staff review，但位于 Student 一级导航内。

75. Staff notes 主要依赖 placeholder，没有稳定的可见字段标签。

76. Staff notes 没有明显的保存状态、autosave 状态或错误状态。

77. Mark reviewed 与 Print、Copy summary 处于同一操作层级。

78. Final Policy Snapshot 中的总分与 Class Health、Explain Score 不一致。

79. Category Summary 中 Attendance、Labs、Projects 错误显示为 0。

80. Overall Summary 只汇总考试，却使用 `Current F` 等完整课程成绩语义。

81. Overall Summary 图表没有可读的文本替代结论。

82. 页面首屏同时出现总分、考试 badges、gap、notes 和 staff actions，信息竞争明显。

## 八、Attendance

83. 页面显示 `0/15`、`0/0 raw evidence`、`0 missing`，三项状态互相矛盾。

84. ALL、LECTURE、DISCUSSION、LAB、MISSING、MAKE-UP 在没有数据时仍全部可操作。

85. Evidence 区域几乎为空，但占据大面积布局。

86. Action 提示用户查看 Ledger，但 Ledger 中没有 Attendance rows。

87. `Explain attendance score` 进入通用 Explain Score 图谱，没有聚焦 Attendance。

88. 页面无法表达 attendance 数据是否尚未同步。

## 九、Labs

89. 页面显示 `0/80`，但 Explain Score 已存在 8 个 Lab 的 raw pass/not passed 数据。

90. Lab List 显示没有 raw evidence。

91. Overview、Lab List、Policy 共用同一个 URL。

92. Policy 标签中仍显示 ALL、MISSING、DROPPED、KEPT 等列表筛选。

93. Policy 标签的 Evidence 区和 Policy Applied 区重复展示同一套政策步骤。

94. `Open related rows` 进入 Ledger 后没有 Lab 分类，也没有自动筛选。

95. 页面显示 `0 missing`，但 Explain Score 中存在 MISS、DROP 等 Lab 状态。

96. Overview、Lab List、Policy 的内容差异不够清晰。

## 十、Projects

97. Projects 页面与 Attendance/Labs 页面高度模板化。

98. 页面显示 `0/155`、`0 missing`、`0 late rows`，与 Class Health 数据冲突。

99. Submitted、Missing、Resubmission、Late 筛选存在，但没有任何 project row。

100. 页面没有展示 extension、resubmission、late penalty 等真实状态。

101. `Open related rows` 进入只包含考试记录的 Ledger。

102. Action 只有泛化的“Review ledger if score looks unexpected”。

## 十一、Exams

103. Raw、Question Best、After Clobber 三个总分完全相同。

104. 切换到 Raw 后，Clobber Ladder 和 Question Best Matrix 仍然全部显示。

105. 三种模式主要只改变 `in raw view` 等局部文案，没有真正改变页面信息结构。

106. Net Clobber Gain 为 0，但页面仍投入大量空间展示 clobber 流程。

107. Midterm 只有一次考试，却重复显示：

    - Raw
    - Question Best
    - Clobber Check
    - Final Used

108. 上述四个阶段数值完全相同。

109. 页面出现 `1 attempts` 语法错误。

110. Quest 页面标题分数和 Final Used 分数不一致。

111. Quest Topic Mastery Radar 没有文本结论。

112. Radar 对键盘和屏幕阅读器不可访问。

113. Question Best Matrix 大量接近 100%，信息区分度很低。

114. Matrix 重复显示 Attempt、Cumulative Best、Best Used，页面非常长。

115. Topic、attempt 和 cumulative-best 之间的关系需要较高认知成本。

116. Exams 首页和单个 Exam 详情页重复展示大量相同内容。

## 十二、Assignments

117. 页面声称是完整 Ledger，但只包含 5 条考试数据。

118. Category 下拉只包含三个考试类别。

119. 点击 MISSING 后显示 `0 rows`，下面直接空白。

120. 空筛选状态没有解释当前搜索范围或数据是否完整。

121. 搜索功能有效，但状态不会保留。

122. Export 没说明导出格式。

123. Export 没说明导出当前筛选还是全部数据。

124. Submitted 日期缺少年份和时区。

125. 每个 Category 都重复一套完整表头。

126. `Full ledger` 与实际内容范围不符。

## 十三、Explain Score

127. Explain Score 是目前唯一接近完整总分的数据页面，但与 Workspace/Report 直接冲突。

128. 默认加载约 101 个节点。

129. 默认显示 47 个 raw 节点和 51 个展开的 upstream 节点。

130. 默认信息规模远超普通学生的理解需求。

131. Show sources 与 Hide sources 同时显示。

132. Show lists 与 Hide lists 同时显示。

133. 页面提示“Click a card”，但图谱节点没有可靠的 button 语义。

134. 无障碍树暴露 `attendance:lecture:drop` 等内部节点 ID。

135. Mini Map、Edge、Policy node 等技术概念直接暴露给普通学生。

136. 页面存在巨大的内部滚动和图谱探索成本。

137. Grade Flow 中显示正确总分，但没有解释为什么 Workspace/Report 使用另一份结果。

138. Fit View 等图谱操作没有形成清晰的学生任务流。

## 十四、Policy

139. Grade Bin 区间边界重叠。

140. 页面仍显示当前学生姓名和学生选择器，但内容是课程级政策。

141. 没有完整的 clobber 条件。

142. 没有具体的 drop 数量。

143. 没有明确的 scale 公式。

144. 没有展示 cap 前后的计算例子。

145. `when policy rules allow it` 等描述过于模糊。

146. Grading Breakdown 没有总分 400 的汇总行。

147. Policy 条目无法对应到当前学生受到的实际影响。

## 十五、AI Analytics

148. 点击示例查询后返回 `403 course_id is required`。

149. 已经选中课程，但 AI 请求没有正确携带 course ID。

150. 错误建议包含“Ensure you are logged in”，但当前用户已经登录。

151. 查询失败后页面仍展示大量疑似真实分析结果。

152. 页面展示 Zhang San、Li Si 和 example.com 等样例内容，没有明确 Sample/Mock 标识。

153. Memory Management、Pointer usage、Binary Tree 等内容与当前 Demo Course 不匹配。

154. 静态样例分析和真实查询结果处于同一视觉层级。

155. 用户无法判断哪些结果来自真实课程数据。

## 十六、Grade Sync、Settings 与错误状态

156. Demo Course 的 Start Sync 看起来仍可执行。

157. Grade Sync 页面没有明显的 Demo 只读说明。

158. Grade Sync 页面重复出现全局课程选择器和页面内课程选择器。

159. Settings 页面只显示 `Failed to load GradeView configuration`。

160. Settings 没有错误原因。

161. Settings 没有 Retry。

162. Settings 没有替代操作或恢复路径。

163. 多个页面把请求失败、空数据和真实 0 分表现成类似状态。

## 十七、响应式、布局与可访问性

164. 未登录页面仍保留空侧栏，造成大面积无意义空白。

165. 登录卡相对主内容居中，而不是相对整个窗口居中。

166. 13 英寸窗口中课程名称被截断。

167. 只有一门课程时仍显示课程下拉框。

168. 左侧同时显示 Student 和 Admin 导航，占用大量横向空间。

169. 固定 Footer 在多个页面覆盖内容。

170. 页面没有 Skip to main content。

171. 多个主区块使用 h5/h6 作为标题。

172. 部分页面存在多个 H1。

173. 可点击学生姓名缺少正确的交互语义。

174. 排序图标按钮缺少可访问名称。

175. 图表缺少屏幕阅读器摘要和键盘操作。

176. 多处使用颜色作为主要状态区分。

177. 多处使用 emoji 作为结构图标。

178. 多个 tab 实际使用 toggle button 表达，页面层级和选中状态不够稳定。

179. 空状态经常只是白屏或一句泛化文案。

180. 加载过程中存在明显的内容闪烁、身份闪烁和布局跳变。

以上共汇总 180 项问题，未包含 Concept Map 相关问题。
