# 教师与教务办理规则

本页记录教务服务的字段、权限与统计口径。时间规则使用北京时间，金额统一以整数分保存。所有写操作通过 `POST /crm-api/v1/operations/{操作编号}/preview` 检查，再通过 `/execute` 提交；身份、权限、数据范围、资料版本和幂等键由服务器校验。

## 课程、校区与计价

年级选项覆盖小学一年级至高中三年级，共 12 个年级。新资料保存规范名称；旧“小四”“4年级”“初一”等名称按相同语义比较，统一名称不会改变已引用的教学版本或旧订单快照。

默认学科为语文、数学、英语、物理、化学、生物、历史、地理、道德与法治、政治、科学，并合并机构词典和旧课程已有学科。共享字典为 `academic-dictionary.js`，浏览器对象为 `SiyueAcademicDictionary`。

校区的 `subjects`、`grades` 分别表示开设学科和覆盖年级。非空时，课程、建班、班级修改和转校区必须符合范围；未配置或空数组表示不限定，以兼容已有校区。课程可在多个符合条件的校区复用。

课程采用按讲均摊，与每讲分钟数无关。服务器保存：

```json
{"pricing":{"basis":"lesson","lessonCount":3,"baseUnitCents":3333,"remainderCents":2,"totalCents":10001}}
```

此例为总价 100.01 元、3 讲，前 2 讲各 33.34 元，最后 1 讲 33.33 元。`remainderCents` 表示需各补 1 分的讲次数，不是欠费余额。课程摘要基于课程总价；订单摘要基于累计已确认实收，优惠后订单和教学讲次在报名时保留快照。退款仍按“已确认实收－已确认课消－已退款”计算，不按分钟换算，也不随课程后续改价改写旧订单。

每次排课、调课必须严格使用所选讲次的 `durationMinutes`，并重新检查教师、教室、学生冲突和历史记录保护。

## 调课申请与审批

| 操作 | 权限 | 必填内容 |
| --- | --- | --- |
| `session.reschedule.request` | `session.reschedule.request` | `classId`、`sessionId`、`date`、`time`、`reason` |
| `session.reschedule.review` | `session.move` | `requestId`、`decision`；驳回时必填 `note` |

`time` 使用 `09:00–10:00` 格式。申请只能由该课次实际授课教师提交，代课时以代课教师为准；申请不会直接改变课表。教师直接调用调课操作，或通过删除课次编号、清空再重建排期来改动已有课次，都会被拒绝。

申请保存在 `rescheduleRequests`，主要字段为 `id`、`classId`、`sessionId`、`campusId`、`applicantId`、`original`、目标 `date/time`、`reason`、`status`。状态为 `pending`、`approved`、`rejected`；审批写入 `reviewedBy`、`reviewedAt`、`note`。

审批人必须有 `session.move`，且拥有全部范围或该校区范围；申请人不能批准自己的申请。审批时重新核对原课次和班级版本、时长、未来时间、历史记录及所有资源冲突。班级资料变化也可能使申请失效，需要驳回后重新申请。已处理申请不能重复办理。

申请列表只向申请人和授权校区审批人开放。

## 当天异常考勤

`GET /crm-api/v1/sessions/attendance-roster?classId=…&sessionId=…` 返回：

```json
{"roster":[{"studentId":"学生编号","name":"学生姓名","attendanceStatus":"attended","note":""}]}
```

`session.attendance.exceptions` 使用 `session.attendance` 权限，输入：

```json
{
  "classId":"班级编号",
  "sessionId":"课次编号",
  "exceptions":[{"studentId":"学生编号","status":"leave","note":"病假"}]
}
```

异常状态只能为 `leave`（请假）或 `absent`（缺勤）；当前名单中未列入的学生按 `attended`（正常出勤）处理。返回实际 `roster`、保存的 `attendance` 以及 `summary.students/present/leave/absent`。

服务器保存时重新取有效名单，包含临时转入、排除已转出的学生；过期或重复的异常学生会被拒绝。预览后资料变化，需要重新预览。

教师和 `assigned` 范围人员只能登记北京时间当天、已经开始、本人实际授课的课次；旧 `session.attendance` 入口同样受此限制。管理员、教务按照既有权限可办理历史考勤。尚未确认课消的考勤可更正，并保留原状态、备注和经办历史；已确认课消不能通过重复考勤撤销或重复扣除。

## 学生资料修改

`student.create` 只负责创建档案；修改已有学生必须有独立的 `student.update`。校长、教务默认可获该修改权限，其他员工可由超级管理员单独授权。线索编辑若同步修改已关联学生资料，也必须通过该权限校验。

## 补课推荐与放弃

`GET /crm-api/v1/makeup/candidates?enrollmentId=…&sourceSessionId=…` 使用 `session.move` 权限，返回 `source` 与 `candidates`。候选包含班级、课次、日期、时段、老师、校区、教室、剩余名额，以及 `sameTeacher`、`sameCourse`。

候选必须是当前时间之后、原课次之后的有效课次，满足同年级、同学科、对应讲次、容量和学生无冲突等规则。排序优先同一老师，其次同一课程，再按时间；无符合项时返回空列表和说明。直接调用 `makeup.assign` 也重新执行这些约束。

`makeup.waive` 使用 `session.move`，必填 `enrollmentId`、`sourceSessionId`、`reason`。仅有未扣课请假或缺勤依据的讲次可放弃补课；已有预约或放弃记录不能重复办理。放弃记录保存在 `sessionAdjustments`，`kind:'waiver'`、`status:'waived'`，并固定原 `orderId/lessonId`。永久转班后仍保留此决定。放弃只改变补课安排，不自动确认课消或发起退款。

## 教师统计

`GET /crm-api/v1/reports/teachers?employeeId=…&observationDays=30`。本人查询需要 `teacher.metrics.read`；查看他人需要 `report.read`，且受全部或校区范围限制。`observationDays` 默认为 30，允许 1–365；当前统计期间为全部历史。

主要返回字段：

| 字段 | 口径 |
| --- | --- |
| `teaching.sessionCount` | 已确认课消记录涉及的 `classId/sessionId` 去重节数 |
| `teaching.studentConsumptionCount` | 已确认学生课消记录数；一节课多名学生分别计次 |
| `teaching.amountCents` | 已确认课消金额合计，整数分 |
| `coverage.attributedRecords/unknownRecords` | 有本人教师快照的课消记录数，以及可见但缺少教师归因的历史记录数 |
| `renewal` | `available`、`numerator`、`denominator`、`rate`、`observationDays`、`pendingObservation`、`unknownOrders`、`cohort`、`reason` |
| `referral` | `available`、`numerator`、`denominator`、`rate`、`unknownOrders`、`cohort`、`reason` |

课消时冻结 `teacherSnapshot`，使用实际授课教师，包括代课老师。不能按今天的班级老师回填历史。全部原教学讲次确认课消时，订单冻结 `teachingCompletionSnapshot`，包含结课时间、实际参与授课教师及校区；不同教师共同完成的课程，归入各自有实际授课依据的学生集合。

续费率分母是具有结课归因快照、结课已满观察窗的唯一学生。分子是在该结课后的观察窗内，同学科后续课程产生首笔正实收、且当前仍有正净实收的唯一学生。多次结课或多笔付款不会重复计算学生；后续订单在首笔正实收时冻结 `teacherAttributionSnapshot.renewalSources`。未满窗口单列待观察；历史缺快照单列未知，不猜测归因。分母非零时 `available:true`，`rate` 为 0–1；没有成熟样本时返回 `null` 和说明。

转介绍率分母是有实际授课快照的唯一学生；分子是推荐其他学生首次正实收的唯一推荐学生。推荐关系通过订单 `referrerStudentId` 及首笔实收时冻结的教师归因计算，不能随班级当前老师变化。全额退款后的推荐订单不再计入正净实收。缺少足够历史归因时返回计数、未知项和原因，`available:false`，不显示伪精确比例。
