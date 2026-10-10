# siyue-cli 操作接口预留 v0.1

## 当前可用

`node cli/siyue-cli.cjs list 报名` 查询指令；`describe <id>` 返回定义；`plan <id>` 生成不提交的调用计划。
浏览器 `siyueCLI.list()` 只返回当前身份可用操作；`describe(id)` 与 `open(id)` 再次校验权限。全局搜索共用此目录。浏览器 open 只打开办理表单，不直接提交。
`operations.json` 是构建时导出的公开功能定义，不含学生数据，也不是授权结果。增加操作时应登记 commandWorkflows 并重新导出。

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
这些写入名称目前仅预留，尚不能从终端直接执行业务。后续以稳定业务名替换当前 action.<page>.<hash> 并保留旧 ID 别名。

目前只有本机浏览器原型状态与部分本地存储，没有服务端认证、真实支付、跨浏览器或跨账号实时同步。
