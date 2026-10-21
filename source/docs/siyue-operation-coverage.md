# siyue-cli 与 MCP 操作覆盖清单

更新时间：2026-10-12。清单取自当前后端四个实际业务模块的运行时注册表，以及 CLI 的固定查询表；不使用早期设计版的 37 项静态目录。

## 覆盖口径

当前共有 **72 个业务注册项，其中 4 个兼容别名不重复计数，68 个独立业务命令**。预览与提交是同一项操作的两个阶段，不重复计数。

另有 **48 个命名查询**、**5 类账号／角色管理写入**，以及登录、改密、退出等认证命令。这些数字代表可调用入口；业务前提、数据范围和外部服务接入状态仍须满足。特别是在线付款入口目前会明确返回未接支付渠道，不能算作真实支付已经可用。

每个员工实际看到的可执行操作，必须以本次登录后服务器返回的 `/v1/catalog` 为准。CLI 与 MCP 都使用同一员工身份、同一后端预览／提交接口和审计记录；不能通过客户端指定角色、校区范围或任意 URL 扩权。

| 模块 | 独立操作数 |
| --- | ---: |
| 教务、报名、课次与财务 | 27 |
| 线索、校区与基础设置 | 22 |
| 商城、营销活动与表单 | 15 |
| 教师工作流 | 4 |
| 合计 | 68 |

## 教务、报名、课次与财务

| 操作编号 | 用途 | 所需权限 |
| --- | --- | --- |
| `course.create` | 创建课程 | `course.create` |
| `course.update` | 更新课程 | `course.update` |
| `course.publish` | 发布教学课程 | `course.publish` |
| `course.toggle` | 启停课程 | `course.update` |
| `class.create` | 创建班级 | `class.create` |
| `class.batchCreate` | 批量创建班级 | `class.batchCreate` |
| `class.update` | 修改班级 | `class.create` |
| `class.schedule` | 保存班级排期 | `class.create` |
| `class.relocate` | 班级转校区 | `class.relocate` |
| `student.create` | 创建学生档案 | `student.create` |
| `student.update` | 修改学生档案 | `student.update` |
| `enrollment.create` | 办理报名 | `enrollment.create` |
| `enrollment.batchCreate` | 批量报名 | `enrollment.batchCreate` |
| `enrollment.transfer` | 永久转班 | `enrollment.transfer` |
| `enrollment.batchTransfer` | 批量永久转班 | `enrollment.batchTransfer` |
| `enrollment.cancel` | 取消未付款报名 | `enrollment.create` |
| `enrollment.withdraw` | 办理退课 | `enrollment.withdraw` |
| `session.move` | 调整课次时间 | `session.move` |
| `session.substitute` | 安排代课老师 | `session.substitute` |
| `session.record` | 保存授课记录 | `session.record` |
| `session.attendance` | 登记课次考勤 | `session.attendance` |
| `makeup.assign` | 安排补课或临时转班 | `session.move` |
| `makeup.cancel` | 取消课次预约 | `session.move` |
| `order.confirmReceipt` | 确认线下收款 | `order.confirmReceipt` |
| `order.paymentLink` | 获取在线收款入口 | `order.paymentLink` |
| `refund.approve` | 核准退款 | `refund.approve` |
| `refund.submit` | 确认线下退款 | `refund.submit` |

## 线索、校区与基础设置

| 操作编号 | 用途 | 所需权限 |
| --- | --- | --- |
| `lead.create` | 登记线索 | `lead.create` |
| `lead.import` | 批量导入线索 | `lead.create` |
| `lead.update` | 修改线索资料 | `lead.create` |
| `lead.followup` | 记录线索跟进 | `lead.follow` |
| `lead.transfer` | 转交线索 | `lead.transfer` |
| `lead.assign` | 分配线索 | `lead.assign` |
| `lead.release` | 释放线索至公海 | `lead.release` |
| `lead.claim` | 领取公海线索 | `lead.assign` |
| `lead.archive` | 归档线索 | `lead.follow` |
| `lead.reactivate` | 恢复已归档线索 | `lead.assign` |
| `lead.policy.update` | 设置保留与回收策略 | `leadPolicy.publish` |
| `lead.policy.run` | 试运行保留与回收策略 | `leadPolicy.preview` |
| `lead.retain` | 审核后线索由本人保留 | `lead.follow` |
| `lead.reclaim.request` | 申请取回超时公海线索 | `lead.follow` |
| `lead.reclaim.review` | 审批取回线索申请 | `lead.assign` |
| `lead.status.update` | 更新线索销售状态 | `lead.follow` |
| `lead.decision.timeout` | 处理审核后决策超时 | `leadPolicy.publish` |
| `campus.create` | 创建校区 | `settings.update` |
| `campus.update` | 修改校区 | `settings.update` |
| `dictionary.update` | 更新教学字典 | `settings.update` |
| `settings.update` | 更新系统设置 | `settings.update` |
| `staff.profile.update` | 编辑职工业务档案 | `account.update` |

## 商城、营销活动与表单

| 操作编号 | 用途 | 所需权限 |
| --- | --- | --- |
| `promotion.create` | 创建营销活动 | `promotion.create` |
| `promotion.update` | 修改营销活动 | `promotion.create` |
| `promotion.publish` | 发布营销活动 | `promotion.publish` |
| `promotion.unpublish` | 停止营销活动 | `promotion.publish` |
| `product.publish` | 上架课程商品 | `product.publish` |
| `product.unpublish` | 下架课程商品 | `product.publish` |
| `store.design.save` | 保存商城装修 | `store.design` |
| `store.design.publish` | 发布商城装修 | `store.design` |
| `form.create` | 创建获客表单 | `lead.create` |
| `form.update` | 修改获客表单 | `lead.create` |
| `form.publish` | 发布获客表单 | `lead.create` |
| `form.unpublish` | 停止获客表单 | `lead.create` |
| `form.submit` | 提交获客表单 | `lead.create` |
| `form.submission.annotate` | 备注表单提交 | `lead.create` |
| `form.submission.review` | 审核表单提交 | `lead.create` |

## 教师工作流

| 操作编号 | 用途 | 所需权限 |
| --- | --- | --- |
| `session.reschedule.request` | 申请调课 | `session.reschedule.request` |
| `session.reschedule.review` | 审批调课 | `session.move` |
| `session.attendance.exceptions` | 登记当天异常考勤 | `session.attendance` |
| `makeup.waive` | 放弃本讲补课 | `session.move` |

## 账号与权限管理

| 操作 | 后端接口 | 限制 |
| --- | --- | --- |
| 创建员工账号及初始密码 | POST /v1/admin/users | 超级管理员；初始密码只交付到受保护文件 |
| 修改员工姓名、角色、范围、个人权限或停用状态 | PATCH /v1/admin/users/{userId} | 超级管理员；保留最后一名有效超级管理员 |
| 重置员工密码 | POST /v1/admin/users/{userId}/reset-password | 超级管理员；撤销旧会话，须首次改密 |
| 离职注销并归档 | POST /v1/admin/users/{userId}/archive | 超级管理员；保留历史归属，不能归档本人 |
| 修改角色权限 | PATCH /v1/admin/roles/{roleId} | 超级管理员；检查角色版本，超级管理员角色受保护 |

上述 5 项属于认证管理接口，不混入 68 项业务预览命令。角色目录及当前角色版本通过 `roles` 查询读取。账号创建／重置返回的一次性密码不能作为普通 MCP 文本或日志输出。

## 查询入口

CLI 与 MCP 共用 `cli/query-client.cjs` 的固定查询定义。查询条件必须符合定义，未知条件直接报错；数据由服务器先做权限投影，客户端只能缩小已授权结果，不能读取隐藏记录。

| 查询编号 | 内容 | 查询条件 |
| --- | --- | --- |
| `health` | 服务状态 | 无 |
| `api-contract` | API 接口契约 | 无 |
| `me` | 当前登录员工 | 无 |
| `state` | 全部授权业务数据 | 无 |
| `catalog` | 当前账号可执行操作 | 无 |
| `students` | 学生档案 | `id` |
| `employees` | 员工档案 | `id` |
| `leads` | 线索 | `id` |
| `orders` | 收费订单 | `id` |
| `schedule` | 班级及课表 | `id` |
| `reports` | 综合统计 | 无 |
| `sales-report` | 销售统计 | `employeeId`、`from`、`to` |
| `teacher-report` | 教师统计 | `employeeId`、`observationDays` |
| `activity` | 销售操作或跟进记录 | `employeeId`、`view`、`leadId`、`action`、`from`、`to`、`limit`、`cursor` |
| `audit-events` | 操作日志 | `view`、`actor`、`actorId`、`actorQuery`、`action`、`actionPrefix`、`group`、`outcome`、`from`、`to`、`limit`、`before` |
| `admin-audit` | 管理操作日志 | `view`、`actor`、`actorId`、`actorQuery`、`action`、`actionPrefix`、`group`、`outcome`、`from`、`to`、`limit`、`before` |
| `roles` | 角色及可配置权限 | 无 |
| `accounts` | 全部员工账号 | `id` |
| `makeup-candidates` | 可补课课次 | `enrollmentId`（必填）、`sourceSessionId`（必填） |
| `attendance-roster` | 当前课次有效考勤名单 | `classId`（必填）、`sessionId`（必填） |
| `public-store` | 已发布商城 | 无 |
| `public-form` | 已发布表单 | `formId`（必填） |
| `courses` | 课程 | `id` |
| `classes` | 班级 | `id` |
| `campuses` | 校区及教室 | `id` |
| `enrollments` | 报名权益 | `id` |
| `receipts` | 收款记录 | `id` |
| `refunds` | 退款记录 | `id` |
| `consumptions` | 课消记录 | `id` |
| `attendance` | 考勤记录 | `id` |
| `session-adjustments` | 补课、临时转班及放弃记录 | `id` |
| `directory` | 员工选择目录 | `id` |
| `staff` | 授权职工业务档案 | `id` |
| `forms` | 表单及授权提交 | `id` |
| `lead-reclaim-requests` | 超时线索取回申请 | `id` |
| `reschedule-requests` | 教师调课申请 | `id` |
| `reward-claims` | 表单奖励领取记录 | `id` |
| `trial-bookings` | 试课预约 | `id` |
| `shelved` | 已上架课程编号 | `id` |
| `hidden-shelved` | 已隐藏课程编号 | `id` |
| `inbox` | 本人通知 | `id` |
| `dictionary` | 教学字典 | 无 |
| `settings` | 系统设置 | 无 |
| `lead-policy` | 线索保留及回收策略 | 无 |
| `activities` | 优惠券、拼团及联报 | 无 |
| `decor` | 商城装修草稿及发布内容 | 无 |
| `metrics` | 本人线索转化统计 | 无 |
| `learning-metrics` | 教学统计 | 无 |

`id` 是当前服务器已授权结果中的精确编号筛选，不会为查不到的记录改发不受控详情请求。数组查询返回 `items`；字典、设置、装修等对象查询返回 `value`。

销售统计与活动的日期范围按后端口径处理：纯日期 `from` 为北京时间当天零点，`to` 包含当天全天；带时区的 ISO 时间按指定时刻处理。日志的日期／时间遵循日志接口精确时刻口径；需要全天范围时请明确传入北京时间的起止时刻。

日志支持员工、姓名／账号／工号、操作编号／前缀、类别、结果、时间、关注视图及分页。先按授权范围筛选，再检索、计数和分页。

`activity` 的 `view=followups` 返回所选员工可见的历史跟进，按时间倒序；只接收员工、数量和游标，不接收会被后端忽略的日期、线索或操作筛选。

`attendance-roster` 必须提供班级和课次；教师只能读取本人北京时间当天已经开始的课次名单。`makeup-candidates` 必须提供报名权益和原课次，缺勤依据、同课程资格、时间、容量及教师优先顺序全部由后端计算。

## 使用与维护

`list` 和 `describe` 读取当前员工的实时授权操作及输入结构；`plan` 预览，`execute` 使用原计划与原幂等键提交。报名、调班、退款等业务都不依赖浏览器点击。名称快填、JSON、CSV 批量输入沿用同一业务结构。具体语法见 [CLI 使用说明](../cli/README.md)。

兼容别名仅用于旧客户端：`lead.follow`、`leadPolicy.preview`、`leadPolicy.publish`、`store.design`。新脚本分别使用 `lead.followup`、`lead.policy.run`、`lead.policy.update`、`store.design.save`。

接口新增或修改时，同时更新后端运行时注册表、固定查询定义及测试。查询覆盖测试会核对本机真实服务返回的授权目录与运行时注册表；不能以一个前端按钮存在作为接口已经实现的证明。

## 当前明确边界

- `order.paymentLink`：支付商户及回调未接通，明确返回 `PAYMENT_PROVIDER_UNAVAILABLE`；不会生成可付款二维码或假成功。
- `order.confirmReceipt` 与 `refund.submit`：登记已核实的现金／银行线下凭据；不发起外部收款、扣款、转账或退款。
- 拼团／联报：可创建、修改草稿；成团及跨课程结算未实现，发布会返回 `SETTLEMENT_NOT_AVAILABLE`。优惠券发布与资格核验有独立实现。
- 自定义新角色的创建／删除、薪资结算、外部支付商户管理没有对应后端实现，不会通过 CLI 或 MCP 凭空实现。现有角色的权限可由超级管理员修改。
- `form.submit` 是员工认证提交；家长匿名提交使用公开表单和访客绑定凭据。查询已发布表单不会授予他人的提交答案，也不会发放匿名访客登录凭据。
- 当前权限范围为同一机构下的全域、授权校区、本人负责、本人授课等；不代表已经提供独立机构的多租户数据库隔离。
- 查询审计、报表、名单可能产生服务端读取日志，但不会修改学生、报名或财务记录。

## 已验证的查询路径

`node --test cli/query-client.test.cjs` 共 6 项测试通过，覆盖非法路径与筛选拒绝、日志分页编码、历史跟进条件、补课／考勤必填项、投影集合、真实本机 HTTP 下的教师报名范围、当天考勤、账号列表权限、校区日志与隐藏游标。测试使用临时认证库、临时业务数据库和合成身份，不操作生产资料。
