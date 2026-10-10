# siyue-cli 员工认证与本地模拟 v0.3

## 员工账号登录

超级管理员在平台“设置与账号 → 员工账号与权限”创建员工。账号可以按工号自动生成；初始强密码仅创建或重置时回显一次。网页与 CLI 使用同一员工身份及最终授权。

```sh
node cli/siyue-cli.cjs login --username sy-e010
node cli/siyue-cli.cjs passwd
node cli/siyue-cli.cjs login --username sy-e010
node cli/siyue-cli.cjs whoami
node cli/siyue-cli.cjs list 线索
node cli/siyue-cli.cjs describe lead.follow
node cli/siyue-cli.cjs plan lead.follow
node cli/siyue-cli.cjs logout
```

登录与改密时在终端隐藏输入密码。自动化可从进程环境注入 `SIYUE_PASSWORD`、`SIYUE_NEW_PASSWORD`，不要将口令放进命令行、脚本源码或仓库；CLI 拒绝 `--password` / `--token` 参数。首次登录与管理员重置后必须改密，完成后所有旧会话撤销，需要用新密码重新登录。

默认服务器是 `https://www.siyuejn.com/crm-api/`。可通过登录的 `--server` 或 `SIYUE_SERVER` 指定 HTTPS 地址，仅 `localhost` / `127.0.0.1` / `::1` 的隔离测试允许 HTTP；不会跟随重定向泄露令牌。

CLI 会话保存在用户私有目录 `~/.config/siyue-cli/session.json`，文件 `0600`、目录 `0700`；可用 `SIYUE_CONFIG_DIR` 指定独立路径。拒绝符号链接目录和会话文件。令牌不写入标准输出，也不写入项目目录。网页使用 HttpOnly Secure Cookie 与 CSRF 校验，不使用 localStorage 存登录令牌。

`list`、`describe`、`plan` 都必须登录，且每次向服务端重新检查身份并取得过滤后的指令目录。修改员工角色、个人额外授权/禁止项、数据范围、停用或重置密码，会立即撤销该员工全部旧会话。不存在或未授权的操作不会出现在目录中。`plan` 明确返回 `commit:false` 和 `business-backend-not-enabled`；已授权不代表业务后端已实现。

`operations.json` 是构建时导出的公开功能定义，不含学生数据，也不是授权结果。浏览器 `siyueCLI` 的入口仍只打开当前账号允许的原型办理页。线上真实账号认证与本机教学业务状态是两个明确边界。

认证验证：

```sh
node --test cli/auth.test.cjs
node --test backend/test/auth.test.cjs
```

包含真正启动隔离的本机认证服务，再运行 CLI 完成初始账号登录、首次改密、权限目录过滤、修改权限后的旧会话失效、重新登录和退出；不使用线上员工账号。

## 实际执行一次课消模拟

```sh
node cli/siyue-cli.cjs simulate lesson-consumption --out /absolute/new-output-directory
node --test cli/simulation.test.cjs
```

此命令加载 `index.html` 指定的同一组应用脚本，在隔离内存和模拟存储里实际调用 `workflowSaveSessionAttendance()`，并核验页面使用的课消投影和退款试算；不是只输出调用计划，也不另写一套课消算法。它不连接阿里云、正式后端或当前浏览器，不读取或覆盖真实学生数据。

模拟预置一门三讲的数学课程、两个班、三名学员及每人 ¥900 的已付款模拟订单。订单和临时转班关系是测试初始数据，不代表真的执行过收款或调班。课消办理通过现有处理器执行，并自动核验十项结果：到课扣课、请假不扣、重复保存去重、临时班关联原订单、销售无权修改、无效学生拒绝、请假课消规则、存储失败不落业务、金额与退款一致、持久化后重新加载。

成功生成：

- `lesson-consumption.simulation.json`：可以在页面“CLI 课消演示”中选择、预览并确认导入的模拟记录。
- `simulation-report.json`：逐项核验结果与金额汇总。

预期汇总为 3 条考勤、2 条已确认课消、课消 ¥600、原实收 ¥2700、剩余可退 ¥2100。原付款金额不因课消被改写。输出目录必须位于仓库之外；已有同名结果不会被覆盖。未通过校验时命令非零退出，不生成可导入的成功载荷。

### 模拟载荷约定

```text
schema: "siyue.lesson-consumption.simulation"
schemaVersion: 1
runId: "SIM-<UTC 时间>-<随机后缀>"
generatedAt: ISO 时间
source: {kind: "siyue-cli", mode: "simulation", operation: "lesson-consumption", version: "0.2.0"}
academic: {courses, classes, students, attendance, orders, refunds, sessionAdjustments}
journal: 本次模拟产生的日志
report: {status, checks, summary, refundEstimates}
```

业务对象及讲次 ID 都在本轮 `runId` 范围内，记录附带 `simulationRunId`。考勤包含稳定 `classId/studentId`；数组索引只对应载荷内部数组，页面导入必须按 ID 重新映射。导入是显式操作，先预览再合并；不能按姓名覆盖已有数据，不能把导入的模拟日志当作服务器审计。重复导入同一轮次应被拦截。

## 统一办理与数据规则

每项操作只提供一个主办理界面；对象选择、自动带入、计算结果与必要输入放在同一界面。提交、取消、预览、清空筛选等从属于该操作，不单独创建重复表单。
学生、线索、课程、班级、订单引用共享 ID；业务模块从同一份状态读取，不再次建立独立档案。报名表已合并，沿用共享报价、重复订单检查、待支付订单与到账后生效逻辑。
本轮未重写所有历史表单。现有多步骤流程与所有写入处理仍需逐项迁移到此契约，并做业务联动验收。

## 待接入的正式写入协议

请求：operationId、schemaVersion、input、expectedRevision、idempotencyKey；身份从认证会话解析，不能信任客户端传入的角色。
响应：requestId、status、resultIds、revision、events、fieldErrors。
服务端对功能权限、校区范围、记录归属及字段权限再次校验；一个事务完成档案/订单/名单等相关变更，发布带 revision 的事件刷新各页面。重复提交以 idempotencyKey 返回同一结果；版本冲突返回 CONFLICT，不覆盖其他人的修改。
统一错误码：UNAUTHENTICATED、FORBIDDEN、VALIDATION_ERROR、NOT_FOUND、CONFLICT、DUPLICATE、NOT_IMPLEMENTED。

正式计划指令族：lead.create/assign/transfer/release/follow、course.create/update、class.create/update/batch-create/relocate、enrollment.create/batch-create、session.attendance/move/substitute/record、enrollment.transfer/refund、order.payment-confirm、promotion.create/publish、account.update、role.grant。
这些正式写入名称目前仅预留；当前可执行真实账号登录、本人改密和退出；业务处理仍限于上面明确限定的本地模拟。后续以稳定业务名替换当前 action.<page>.<hash> 并保留旧 ID 别名。

账号认证、初始口令生成、本人改密、管理员重置、角色与个人权限调整及账号审计已接入真实认证服务。CRM / 教学业务仍为浏览器本地原型，没有真实支付、跨浏览器或跨账号业务数据实时同步。

正式后端设计见 [backend/README.md](../backend/README.md)。首版稳定指令、输入和前端旧 ID 别名以 [后端操作目录](../backend/contracts/operations.json) 为下一阶段契约依据；页面业务入口仍只打开原型办理页；CLI 模拟不提供生产业务写入或跨设备业务数据同步，CLI 账号认证独立使用真实服务。
