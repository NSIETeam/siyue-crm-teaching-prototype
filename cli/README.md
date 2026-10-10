# siyue-cli 操作目录与本地模拟 v0.2

## 当前可用

`node cli/siyue-cli.cjs list 报名` 查询指令；`describe <id>` 返回定义；`plan <id>` 生成不提交的调用计划。
浏览器 `siyueCLI.list()` 只返回当前身份可用操作；`describe(id)` 与 `open(id)` 再次校验权限。全局搜索共用此目录。浏览器 open 只打开办理表单，不直接提交。
`operations.json` 是构建时导出的公开功能定义，不含学生数据，也不是授权结果。增加操作时应登记 commandWorkflows 并重新导出。

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
这些正式写入名称目前仅预留；当前可实际执行的是上面明确限定的本地模拟。后续以稳定业务名替换当前 action.<page>.<hash> 并保留旧 ID 别名。

目前只有本机浏览器原型状态与部分本地存储，没有服务端认证、真实支付、跨浏览器或跨账号实时同步。

正式后端设计见 [backend/README.md](../backend/README.md)。首版稳定指令、输入和前端旧 ID 别名以 [后端操作目录](../backend/contracts/operations.json) 为下一阶段契约依据；页面入口仍只打开办理页，CLI 模拟并不提供生产写入、真实认证或跨设备同步。
