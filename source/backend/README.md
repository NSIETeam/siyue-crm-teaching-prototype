# 思跃共享业务后端

本目录现在包含可运行的员工认证与 SQLite 共享业务服务。真实模式通过 `SIYUE_AUTH_STORE` 与 `SIYUE_BUSINESS_STORE` 同时启用；仅启用认证或不配置存储时仍保留原设计边界。当前生产部署状态见[2026-10-11 报告](../docs/backend-deployment-2026-10-11.html)。

Node.js **≥24.20**；使用原生 HTTP 与 `node:sqlite`，没有第三方运行依赖。认证存储仍是独立私有 JSON，业务存储是 SQLite。当前按一个机构、一个认证写进程运行，不连接原有站点的题库或 PostgreSQL 数据库。

## 启动方式

首次创建超级管理员使用 [authentication.md](authentication.md) 中的初始化步骤；已有账号库禁止重新初始化或用源码包覆盖。为独立部署准备私有目录后设置：

| 变量 | 用途 |
| --- | --- |
| `SIYUE_AUTH_STORE` | 认证 JSON 文件的绝对路径 |
| `SIYUE_BUSINESS_STORE` | 业务 SQLite 文件的绝对路径；不存在时创建空业务库 |
| `SIYUE_PUBLIC_ORIGIN` | 网页的准确 HTTPS Origin，用于浏览器请求校验 |
| `SIYUE_COOKIE_PATH=/crm-api/` | 同源代理下的 Cookie 路径 |
| `SIYUE_TRUST_PROXY=loopback` | 仅信任本机代理覆盖的来源 IP |
| `SIYUE_BACKEND_PORT=8787` | 默认只监听 `127.0.0.1` |
| `SIYUE_POLICY_WORKER=1` | 每分钟检查已显式发布的线索回收策略；不自动发布草稿 |

```sh
node backend/src/server.cjs
```

Nginx 将同源 `/crm-api/` 前缀去掉后转发至本机服务。部署模板见 [systemd 服务](../deploy/aliyun/siyue-crm-auth.service) 与 [API 代理](../deploy/aliyun/auth-api.nginx.conf)。网页 `deployment-config.js` 仅对配置的员工域名启用此服务，Pages/本地文件保留演示模式。

| 配置模式 | `/healthz` | 业务行为 |
| --- | --- | --- |
| 无认证、无业务存储 | `design-only`，`businessReady:false` | 公开旧设计目录，设计业务接口返回 501 |
| 仅认证存储 | `authentication-ready`，`businessReady:false` | 可登录/改密/授权，未接通的业务返回 501 |
| 认证与业务存储均启用 | `business-ready`，`businessReady:true` | 启用当前操作处理器及共享数据；支付渠道仍为 false |

业务服务不能脱离员工认证单独启动。健康检查只能证明服务与数据库可读，不能代替具体操作、备份或页面验收。

## 当前运行 API

除公开客户表单与公开商城白名单外，业务 API 都要求真实会话和已完成初始改密。浏览器使用 HttpOnly Cookie、Origin 和 CSRF；CLI 使用 Bearer 令牌，不接受客户端自报角色。权限/会话会在读取请求体后再次核验，阻止在途请求绕过撤权。

| 方法与地址（不含代理前缀） | 行为 |
| --- | --- |
| `GET /v1/catalog` | 当前账号获授权的运行操作、权限、分组、`inputSchema`；兼容别名不重复展示 |
| `GET /v1/state` | `{revision,state,capabilities,userVersion}`，已做范围与记录过滤 |
| `POST /v1/operations/:id/preview` | `{input,expectedRevision}`，返回计算结果、`previewToken`、版本与到期时间 |
| `POST /v1/operations/:id/execute` | `{input,expectedRevision,previewToken}`，另带 `Idempotency-Key`；返回 `{revision,result}` |
| `GET /v1/students`、`/employees`、`/leads`、`/orders`、`/schedule`、`/reports` | 对应授权资料投影 |
| `GET /v1/admin/audit` 或 `/v1/audit-events` | 超管或明确授权的审计员检索认证与业务事件 |
| `GET /v1/public/forms/:id` | 仅返回已发布表单的客户字段/限制与提交编号，建立访客 Cookie |
| `POST /v1/public/forms/:id/submissions` | `{answersById,submissionId?}` 与 `Idempotency-Key`；返回回执，不公开员工资料或其他人的答案 |
| `GET /v1/public/store` | 已发布装修与上架商品的公开白名单；不是下单或支付接口 |

普通业务预览有效期为 **10 分钟**。预览在状态副本上执行校验和计算，不提交业务变更；预览事件本身会记入审计。执行重新校验权限、用户版本、输入摘要、预览与全库 revision，任一版本变动需重新预览。成功后客户端重新读取共享状态；当前没有 WebSocket/SSE 推送。

幂等记录按操作者、操作和键隔离，持久化结果及输入摘要。相同键与输入重试返回原结果；相同键不同输入返回冲突。业务状态、revision、幂等结果和成功审计在同一 SQLite 事务内提交，整批任一失败全部回滚。公开表单另按访客与表单隔离，并核查有效期、数量和手机号/访客限次；限次不等于实名验证。

## 已实现与未接通的边界

当前处理器分为 `business-academic.cjs`、`business-crm.cjs`、`business-commerce.cjs`。它们包括建校区、课程/讲次、建班排课、单页新生/已有学生报名、批量办理、永久/临时转班、考勤/课消、CRM 归属与跟进、人工线下收退款、商城草稿/发布、优惠与公开表单。精确名称和必填字段以登录后的目录为准，不能使用数组索引代替稳定 ID。

- `order.confirmReceipt` 是对已核实线下凭据的人工到账记录；`refund.submit` 是已完成线下退款的凭据确认。都不会向外部金融机构发起转账。
- `order.paymentLink` 已登记，但未配置支付渠道时固定拒绝并返回 `PAYMENT_PROVIDER_UNAVAILABLE`（503），不会伪造二维码或成功状态。
- 拼团、联报目前只可创建/编辑草稿；成团订单、跨课程联报结算与收款闭环尚未实现，发布返回 `SETTLEMENT_NOT_AVAILABLE`（409）。优惠券资格/报价校验不等于已完成整个拼团平台。
- 教学版本、商城发布快照和业务原始数据分离；未发布草稿不作为公开店铺内容。没有客户商城网页/支付闭环的交付承诺。
- 新库为空，不从 file/Pages/localStorage 导入演示数据，也不把 SIM 课消当作正式记录。

## 数据、权限与审计

SQLite 使用 WAL、`synchronous=FULL` 与 `BEGIN IMMEDIATE`。当前主业务模型存于带 revision 的状态记录，另有预览、幂等、审计等表；不是早期 SQL 草案中按所有领域拆分的 PostgreSQL 实现。跨校区、本人归属、分配给本人及档案查看权限由服务端应用核查。

目录所需的人员姓名/ID与员工完整档案分开授权。课次名单由服务器派生，再按可见学生过滤；销售转化基于首笔正额实收时冻结的归属快照，少于10条不输出百分比。权限配置仍使用 [认证角色模型](authentication.md)，不能把网页隐藏按钮当作唯一授权机制。

业务审计记录操作人、动作、结果、请求 ID、revision 与变更前后内容；认证审计保存于账号库，查询时统一检索。支持操作者、动作、分组、结果、日期、分页游标。SQLite 触发器阻止应用直接更新/删除业务审计，不等于抵御拥有数据库管理权限者的外部防篡改系统。私有备份也包含个人信息与认证哈希，不可公开。

## 备份与恢复

`src/backup-business.cjs` 使用 SQLite 在线备份 API 导出独立业务快照，复制完整认证存储，并对备份执行 `integrity_check`、SHA-256 清单和权限检查。每份备份只含 `business.sqlite`、`auth.json`、`manifest.json`，不包含初始密码交付文件或 CLI 明文会话文件。目录为 `0700`，文件为 `0600`。

```sh
SIYUE_AUTH_STORE=/private/path/auth.json \
SIYUE_BUSINESS_STORE=/private/path/business.sqlite \
SIYUE_BACKUP_DIR=/private/path/backups \
node backend/src/backup-business.cjs
```

[备份 timer](../deploy/aliyun/siyue-crm-backup.timer) 配置每日北京时间 03:20 执行，允许两分钟随机延迟，并补跑错过的任务。模板存在不等于线上已启用，启用与首次执行结果应记录到发布报告。当前没有自动删除策略或异机备份；需另行安排保留与受控外部副本。

恢复须在维护窗口执行：

1. 停止业务服务及备份 timer，保留当前数据和代码版本的独立快照；确认没有存活写进程。
2. 验证所选备份的 SHA-256、SQLite 完整性与账号文件结构；先在隔离目录启动相同兼容版本，核对 revision、业务记录、账号与权限。
3. 将验证后的文件放入新的私有目录，再切换数据配置；不要把旧数据库与当前 `-wal`/`-shm` 混在一起。设置服务用户所有权及 0700/0600 权限。
4. 认证与业务文件分别取快照，不是跨两库的同一原子时刻。需确认恢复的账号权限没有倒退；恢复旧认证文件前必须清空其 `sessions` 数组并重新核对停用/撤权状态，避免复活旧会话。
5. 启动服务，验证健康、重新登录、授权数据读取、目录与日志；确认后恢复定时备份。失败时切回维护前的文件和兼容代码，不删除现场证据。

自动测试已将备份重新作为业务库打开并核对记录和 revision；这不代表已经进行线上灾难恢复演练。代码回滚与数据回滚是两件事，禁止为回滚代码直接覆盖已经发生的业务或权限变更。

## 设计契约与当前实现

仓库 `contracts/operations.json` 有 **37 项早期设计操作**，`contracts/openapi.json` 是对应的旧设计文件。启用共享业务后，服务器 `/openapi.json`（线上 `/crm-api/openapi.json`）由 `business-contract.cjs` 从当前业务处理器动态生成实际运行契约；仅未启用共享业务时返回旧设计契约。`migrations/001_initial.sql`、`architecture.md` 中的 PostgreSQL、RLS、事务发件箱和支付回调属于保留方案，尚未按该方案运行。不要以这些文件宣称当前生产能力，也不要自动执行旧 SQL 迁移。

当前运行清单来自三个业务模块的注册表，由 `/v1/catalog` 做授权过滤。API 字段与 CLI 应以该目录及上文协议为准。设计模式的 501 测试继续保留，用来防止未配置服务冒充已实现。

## 验证

```sh
node --test backend/test/*.test.cjs
node tests/business-api.cjs
node tests/public-form.cjs
node --test cli/auth.test.cjs
```

覆盖真实本机 HTTP/CLI、权限和撤权、CSRF、资料范围、预览/执行/重试、并发 revision、批量回滚、公开表单、发布快照、备份读取，以及前端与真实内存业务处理器的建档→报名→收款联动。测试不操作线上真实业务，不替代实际部署验收、浏览器视觉验收或长期容量验证。

### 表单填写奖励与免费试课

表单设计的“填写奖励与试课”可配置资料 HTTPS 链接，或已发布且有效的通用优惠券、满减券、代金券。家长提交成功后直接在回执页领取；线索仍需发布者审核，试课不会生成付费订单。优惠券领取码在报名结算中使用，校验家长手机号、适用课程、有效期、额度和单次核销；不与另一张优惠券叠加。

`form.create` / `form.update` 的 `settings.reward` 接受 `{type:"material_link",title,url}`、`{type:"coupon",promotionId}` 或 `null`。`settings.trial` 接受显式字段绑定 `gradeFieldId`、`subjectFieldId`、`nameFieldId`、`phoneFieldId`，以及固定表单校区或 `campusFieldId`；每个公开预约时段提供稳定 `id`、`classId`、`sessionId`、`capacity`。发布时验证字段必填、授权范围和未来课次。保存修改会回到草稿，重新发布后生效；失效时段可在编辑页移除。

家长接口 `POST /v1/public/forms/{formId}/submissions` 可附 `trialBooking:{slotId}`；不附即只提交信息并领取奖励。服务端按校区、年级、学科严格匹配，并将所有表单和版本预约计入同一课次容量。重复请求返回原回执。权限过滤后的状态包含 `rewardClaims` 和 `trialBookings` 摘要，发布者可在提交审核页查看；领取码不会出现在员工状态投影或日志明细中。

`siyue-cli describe form.create` 可查看实时输入契约，仍通过 `plan` / `execute` 两步办理。清空奖励或试课时，在 `form.update` 的 `patch.settings` 中传入相应字段的 `null`。
