# siyue-cli：员工认证、共享业务与隔离模拟

CLI 和正式网页使用同一员工账号、授权目录及业务处理器。正式业务的读取、预览和执行访问服务器 SQLite 数据；`simulate` 仍是完全独立的离线演示。使用 Node.js ≥24.20，与后端运行时保持一致。

## 登录与改密

超级管理员从“设置与账号 → 员工账号与权限”统一创建账号、生成初始密码并分配角色/范围。初始密码登录只允许改密、查看本人状态或退出；改密后重新登录。

```sh
node cli/siyue-cli.cjs login --username <员工账号>
node cli/siyue-cli.cjs passwd
node cli/siyue-cli.cjs login --username <员工账号>
node cli/siyue-cli.cjs whoami
node cli/siyue-cli.cjs logout
```

密码通过终端隐藏输入。受控自动化可以注入 `SIYUE_PASSWORD`、`SIYUE_NEW_PASSWORD`；不要写进源码、命令参数、日志或仓库。CLI 拒绝 `--password`、`--new-password`、`--token`。

默认服务器为 `https://www.siyuejn.com/crm-api/`。登录 `--server` 或 `SIYUE_SERVER` 可指定其他 HTTPS 地址；只有 localhost/127.0.0.1/::1 测试允许 HTTP。请求不跟随重定向。

会话存于 `~/.config/siyue-cli/session.json`，目录 0700、文件 0600；可用 `SIYUE_CONFIG_DIR` 指定独立私有目录。拒绝符号链接目录/会话文件，令牌不输出。改密、管理员重置、停用、权限或范围修改均撤销旧会话，必须重新登录。

超级管理员可用 `accounts list` 查看员工账号；`accounts create` 当前支持内置教师与销售角色，分别固定为 `assigned` 与 `own` 范围，不接受自定义权限、范围或角色。每次创建须提供唯一姓名、用户名和工号，并用 `--out` 指向一个不存在的私有凭据文件；目录会收紧到 0700，凭据文件为 0600。一次性初始密码只保存在该文件，不写终端。命令创建的账号仍须首次登录改密。账号创建接口没有服务端幂等键，若创建响应不明确，命令会保留空凭据标记并停止；先用 `accounts list` 核对，不要盲目重试或重置密码。完全匹配的现有员工可复用，任何身份、授权或范围冲突都会停止。

```sh
node cli/siyue-cli.cjs accounts list
node cli/siyue-cli.cjs accounts create --name 测试教师1 \
  --username test-teacher-01 --employee-no TEST-T001 \
  --role teacher --out /private/path/test-teacher-01.json
node --test cli/account-admin.test.cjs
```

## 查看当前授权能力

```sh
node cli/siyue-cli.cjs list
node cli/siyue-cli.cjs list 报名
node cli/siyue-cli.cjs describe enrollment.create
node cli/siyue-cli.cjs get state
node cli/siyue-cli.cjs get students
node cli/siyue-cli.cjs get schedule
node cli/siyue-cli.cjs get reports
node cli/siyue-cli.cjs get audit-events
node cli/siyue-cli.cjs get activity --view followups --employee <员工ID> --limit 50
```

`get` 支持 `state / students / employees / leads / orders / schedule / reports / sales-report / teacher-report / activity / audit-events`。`get activity --view followups` 可按时间倒序读取所选员工的全部历史跟进并用 `--cursor` 翻页；统计日期不限制此视图。其他活动可使用日期、线索、员工和动作过滤。这些输出包含实际授权业务数据；如需保存，使用仓库外的私有路径，不要把学生、订单或员工资料提交公开 GitHub。

`list/describe` 每次检查会话并读取服务器授权目录，不根据本地角色猜测权限。登录后的 `inputSchema`、操作名与权限才是当前运行依据。`cli/operations.json` 是旧页面入口目录；仓库 `backend/contracts/operations.json` 的37项与 `backend/contracts/openapi.json` 是早期设计契约。启用共享业务后，线上 `/crm-api/openapi.json` 动态生成当前运行契约；未启用业务时才返回旧设计契约。

## 快速填写（新增）

不用先查齐 ID 或手写完整 JSON。登录后可直接按名称填写，或生成 CSV 批量填写：

```sh
node cli/siyue-cli.cjs fill 建班 --name 四年级数学周六班 \
  --course 四年级数学秋季课 --campus 城中校区 --teacher 陈老师 \
  --room 教室01 --capacity 20 --out /private/path/class.plan.json
node cli/siyue-cli.cjs template 批量报名 --format csv --out /private/path/students.csv
node cli/siyue-cli.cjs check 批量报名 --class 四年级数学周六班 --rows /private/path/students.csv
node cli/siyue-cli.cjs fill 批量报名 --class 四年级数学周六班 \
  --rows /private/path/students.csv --out /private/path/enroll.plan.json
node cli/siyue-cli.cjs execute --plan /private/path/enroll.plan.json
```

`check` 校验但不写计划；`fill` 生成服务器预览计划，`execute` 才提交。CSV 逐行指出错误，明确的手机号/数字格式会规范并列出，重名须改填 ID。通用 `--set 字段=值` 支持嵌套路径；`--price` 按元精确转分。JSON 模板由当前授权 schema 生成。

[完整快填说明与线索、排课、报名示例](../docs/siyue-cli-quickfill.md)。

## 预览，再执行

使用底层 `plan` 指令时，先用 `get` 取得有权访问的记录 ID，再依据 `describe` 准备 JSON。不传数组索引、角色、客户端报价或自行计算的退款额。网页通过名称下拉选择；CLI 快填可以解析名称，底层 `plan` 使用稳定 ID。

例如创建校区的输入文件：

```json
{
  "name": "新校区",
  "rooms": [{"name": "教室一", "capacity": 20, "virtualSeats": 2}]
}
```

```sh
node cli/siyue-cli.cjs plan campus.create \
  --input /private/path/campus-input.json \
  --out /private/path/campus-new.siyue-plan.json

node cli/siyue-cli.cjs execute \
  --plan /private/path/campus-new.siyue-plan.json
```

`virtualSeats` 是独立的非负整数，省略时按0处理；仅表示可临时增加的试课座位，不增加正式班级容量。CSV 校区模板也包含“虚拟座位”列。

`plan` 读取当前 revision，在服务器上校验权限、输入与业务规则，输出计算结果并生成 `commit:false` 的计划文件，不提交业务。计划含操作、输入、操作者、服务器、revision、短时预览凭据及固定幂等键；文件按 0600 新建，拒绝覆盖。计划与输入最多 1 MB，不接受符号链接文件。

`execute` 核验计划属于当前服务器和员工，再携带原预览及幂等键提交。成功返回新 revision 与实际结果。普通预览有效期10分钟；期间数据或权限变化会导致重新预览要求。客户端不能把预览文件里的字段改掉后继续执行。

网络超时或结果不明时，**重试同一份计划文件**。同一键、同一输入返回已办理标识，不重复办理；详情可通过 `get` 或网页刷新查看。同一键不同输入被拒绝。明确的校验失败可纠正输入后输出新的计划；revision 冲突则刷新资料并重新预览。不要将每次网络重试都改成新幂等键。

不带 `--input/--out` 的 `plan <id>` 只显示操作的下一步提示；不等于已经完成服务器业务预览。

## 业务边界

- 新生报名可使用 `studentDraft`，已有学生使用 `studentId`，二者选一。批量报名既支持 `studentIds`，也支持包含新生/已有学生的 `rows`，二者选一；服务器整批事务提交。
- 报名、调班、课次、考勤、课消、订单及退款引用同一份服务器资料。金额字段 `*Cents` / `*Minor` 是整数分；未收款报名与已生效课程权益区分。
- `order.confirmReceipt` 和 `refund.submit` 记录已经核实的真实线下收付凭据，不会发起外部扣款、转账或退款。
- 未接支付商户时，`order.paymentLink` 返回 `PAYMENT_PROVIDER_UNAVAILABLE`，不能获得可付款二维码。
- 拼团、联报目前只保存活动草稿；成团和跨课程结算未实现，发布被明确拒绝。普通/续费/老带新/双人同行优惠券按实际资格校验，不等于拼团或联报收款系统已经可用。
- 员工用 `form.*` 管理表单；客户应访问独立公开填写链接，不使用员工 CLI。公开表单不公开员工信息或其他提交者答案。

业务与认证操作记录在服务器审计中。审计读取需要超管或明确的审计授权，CLI 登录本身不会获得额外业务权限。

## 离线课消模拟

```sh
node cli/siyue-cli.cjs simulate lesson-consumption --out /absolute/new-output-directory
node --test cli/simulation.test.cjs
```

模拟按 `index.html` 的应用脚本顺序启动隔离 VM，实际调用原型课消处理器并验证10项场景：到课扣课、请假不扣、重复保存、临时班原订单归属、角色拒绝、无效学生、请假规则、存储失败、金额/退款一致及重载。它不连接服务器、不读取浏览器，也不操作真实学生。

输出 `lesson-consumption.simulation.json` 与 `simulation-report.json`；目录须在仓库之外，已有结果不覆盖。预期3条考勤、2条课消、课消¥600、模拟实收¥2700、可退¥2100。预置付款只是测试初始状态，不代表真实收款。

载荷使用 `siyue.lesson-consumption.simulation`、`schemaVersion:1` 与唯一 `SIM-…` runId。只允许在演示模式先预览后显式导入，按稳定 ID 去重；正式业务入口禁止导入 SIM 记录，模拟日志不替代服务器审计。

## 验证与维护

```sh
node --test cli/auth.test.cjs cli/quick-fill.test.cjs
node --test cli/simulation.test.cjs
node --test backend/test/business-core.test.cjs
```

核心集成测试真实启动本机服务并经 CLI 预览、执行、重试和读取共享记录，另验证授权变化、幂等与备份重开；不操作线上员工或业务。后端配置、审计和备份恢复参见 [后端说明](../backend/README.md)。SQLite、认证库、备份与计划文件都应存放在仓库外私有目录，不能通过 GitHub 备份真实业务数据。
