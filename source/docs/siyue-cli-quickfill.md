# siyue-cli 快速填写使用说明

更新日期：2026-10-11。本文说明本次新增的快填指令；运行时以当前服务器返回的操作目录为准。

员工可以按中文名称填写业务，或通过 CSV 批量录入。先检查内容，再生成预览计划，最后确认提交；不必为了填写一次业务反复查编号、拼完整 JSON。

CLI 使用员工本人账号，读取服务器给这个账号开放的操作目录与资料；同一操作和网页共用数据库、权限、业务规则和日志。快填不会扩大员工权限。

## 先登录员工账号

超级管理员统一创建员工初始账号和密码；首次登录后员工修改初始密码。CLI 与网页使用同一身份，权限以服务器当前设置为准。账号停用、密码重置或权限变更后，旧会话不能继续越权使用。

```sh
node cli/siyue-cli.cjs login --username 员工账号
node cli/siyue-cli.cjs whoami
node cli/siyue-cli.cjs list 报名
```

登录时在隐藏输入中填写密码。若提示修改初始密码，运行 `node cli/siyue-cli.cjs passwd`，修改后重新登录。不要把密码写进命令参数。默认连接正式 CRM 服务；本文的姓名、手机号、课程及文件路径都是使用示例，不能直接作为真实业务提交。

## 检查 → 预览计划 → 确认提交

| 指令 | 用途 | 是否办理业务 |
| --- | --- | --- |
| `list [关键词]` | 查找本人可以使用的操作 | 否 |
| `describe 操作编号` | 查看当前服务器的字段和规则 | 否 |
| `template 操作 --out 文件` | 生成空白 JSON；批量操作可选 CSV | 否 |
| `check 操作 …` | 纠正明确的输入格式、检查逐行问题、进行服务器预览 | 否 |
| `fill 操作 … --out 计划文件` | 完成同样校验，保存绑定本人、数据版本和幂等键的预览计划 | 否 |
| `execute --plan 计划文件` | 提交已经检查的计划；成功后的同计划重试返回已办理标识 | 是 |

`check` 和 `fill` 都会进行服务器预览并留下审计记录，但不会创建学生、订单或课次。只有 `execute` 才办理业务。`fill` 本身也包含校验，熟悉后可直接使用。

以下 `/private/path/...` 代表你已创建的、仓库外的私有目录，请替换为实际路径。填写文件、预览计划和会话不要提交到公开仓库。CLI 新建的模板和计划仅当前用户可读写（0600），已有文件不会被覆盖；预览令牌保存在计划中，不显示在快填结果里。

## 常见操作直接填写

登记线索：

```sh
node cli/siyue-cli.cjs check 线索 \
  --name 张同学 --phone 13900000000 --source 活动报名 --campus 城中校区
node cli/siyue-cli.cjs fill 线索 \
  --name 张同学 --phone 13900000000 --source 活动报名 --campus 城中校区 \
  --out /private/path/lead.plan.json
node cli/siyue-cli.cjs execute --plan /private/path/lead.plan.json
```

建班时可直接填课程、校区、老师名称或老师工号：

```sh
node cli/siyue-cli.cjs fill 建班 \
  --name 四年级数学周六班 --course 四年级数学秋季课 \
  --campus 城中校区 --teacher 陈老师 --room 教室01 --capacity 20 \
  --out /private/path/class.plan.json
```

新生报名一次创建学生档案和报名订单；已有学生用 `--student`：

```sh
node cli/siyue-cli.cjs fill 报名 \
  --class 四年级数学周六班 --name 张同学 --phone 13900000000 --grade 四年级 \
  --out /private/path/enroll-new.plan.json
node cli/siyue-cli.cjs fill 报名 \
  --class 四年级数学周六班 --student 张同学 \
  --out /private/path/enroll-existing.plan.json
```

课程、校区、班级、学生和教师等常用关联项支持名称精确匹配。同名记录不会被随意选择；CLI 列出授权范围内的候选 ID 和区分信息，改填 ID 再预览。找不到名称时不会猜测，也不会自动创建档案。需要填写其他关联字段时，先用 `describe` 查看要求；仍需编号的字段可通过 `get state` 查询。课程价格、优惠资格、容量及冲突由服务器计算。

## 批量报名与纠错

```sh
node cli/siyue-cli.cjs template 批量报名 --format csv --out /private/path/students.csv
```

CSV 支持中文表头，可在表格工具中编辑，保存为 UTF-8；手机号列保留为文本。内容含逗号或换行时，用双引号包住该单元格。

```csv
学生,姓名,手机号,年级
,张同学,13900000000,四年级
,李同学,13800000000,四年级
STUDENT-ID,,,
```

示例中的 `STUDENT-ID` 要替换为已存在学生的 ID。一行只能选择已有学生，或者填写新生姓名/手机号；不能同时填写。也可以使用服务端字段名，如 `studentId`、`studentDraft.name`、`studentDraft.phone`。批量报名的共同班级通过 `--class` 指定。

```sh
node cli/siyue-cli.cjs check 批量报名 \
  --class 四年级数学周六班 --rows /private/path/students.csv
node cli/siyue-cli.cjs fill 批量报名 \
  --class 四年级数学周六班 --rows /private/path/students.csv \
  --out /private/path/enroll-batch.plan.json
node cli/siyue-cli.cjs execute --plan /private/path/enroll-batch.plan.json
```

`check` / `fill` 会汇总字段问题，CSV 给出原文件行号，例如 `line: 3`、`path: rows.1.studentDraft.phone`。空白、全角手机号、手机号中的分隔符、明确的整数和布尔值可以自动规范；所有规范和名称关联都会列在 `corrections` 中。原文件不改写，规范后的内容进入预览和计划。错误手机号、重名、重复学生、缺失信息、冲突等不会猜测补齐或跳过；修改原文件后重跑即可。校验失败退出码为 2，认证/连接等失败为 1。

整批由服务器一起办理，有错误时不会只保存其中正确的几行。客户端先汇总字段错误，服务器随后校验容量、时间、权益等业务规则；服务器返回的跨记录问题可能需要逐次修正再预览。

| 遇到的情况 | 如何处理 |
| --- | --- |
| 全角手机号、空格、明确的数字格式 | 查看 `corrections` 中的规范结果，再核对预览 |
| 手机号错误、缺失必填项 | 按 `line` 与 `path` 修改原文件，重新检查 |
| 同名学生或老师 | 从候选列表中选准 ID，再次检查 |
| 重复学生、同时填写新生与已有学生 | 删除重复项，每行保留一种报名方式 |
| 容量不足、时间冲突、权益不符 | 调整班级、课次或业务资料，再生成预览 |
| 数据已被他人修改 | 重新检查，生成新的计划文件 |

## 排课与课程价格

```sh
node cli/siyue-cli.cjs template 排课 --format csv --out /private/path/schedule.csv
```

```csv
讲次,日期,时间
分数初步认识,2027-01-09,09:00-10:30
分数的比较,2027-01-16,09:00-10:30
```

```sh
node cli/siyue-cli.cjs fill 排课 \
  --class 四年级数学周六班 --rows /private/path/schedule.csv \
  --out /private/path/schedule.plan.json
```

讲次名称只在所选班级对应课程内匹配。排课保存的是完整排期：未列出的可调整课次会被移除；编辑已有排期时增加 `id` 列并保留原课次 ID。存在历史或已考勤记录时由后端保护。先核对预览中的完整课表再提交。

创建课程可按元填写价格，精确换算为整数分；最多两位小数，不能四舍五入未确认的金额：

```sh
node cli/siyue-cli.cjs fill 课程 \
  --name 四年级数学秋季课 --campus 城中校区 --grade 四年级 --subject 数学 \
  --price 1200.29 \
  --set lessons.0.title=分数初步认识 --set lessons.0.durationMinutes=90 \
  --set lessons.1.title=分数的比较 --set lessons.1.durationMinutes=90 \
  --out /private/path/course.plan.json
```

## 所有授权操作的通用填写

中文简称：线索、批量线索、校区、课程、建班、批量建班、排课、报名、批量报名。也可直接使用 `list` 返回的操作编号；CSV 模板覆盖上述具有逐行数据的操作，其余使用 JSON 或 `--set`。

```sh
node cli/siyue-cli.cjs template student.update --out /private/path/student.json
node cli/siyue-cli.cjs describe student.update
node cli/siyue-cli.cjs check student.update \
  --input /private/path/student.json --set phone=13900000000
```

`--input` 读取 JSON，`--set 字段=值` 覆盖指定字段；嵌套路径为 `studentDraft.name`、`lessons.0.title`。按服务器 schema 转换数字/布尔值。其他金额可用对应 `*Yuan` 字段填写元（如 `--set amountYuan=100.50` 对应已定义的 `amountCents`），禁止同时给元和分。

首次模板只填必需字段，数字/布尔占位为 `null`，不自动预设付款、退款、开关或授权决定。校验和提交仍以服务器最新目录、当前员工权限为准。权限变化、密码重置、停用会撤销会话；旧计划不能越权执行。

## 系统配置也可以快速填写

具有系统配置权限的员工，可按配置区填写字段。CLI 根据服务器返回的该配置区字段，将“是 / 否”转换为布尔值、将全角或半角数字转换为整数；其他配置区的字段、非整数天数等会直接提示错误。

例如只检查“到课不自动课消、允许补课”的填写，不保存规则：

```sh
node cli/siyue-cli.cjs check settings.update \
  --set section=attendance \
  --set values.presentConsume=否 --set values.allowMakeup=是
```

如需将调课天数上限设为 30 天，并要求填写原因，先生成预览；核对适合本校规则后再提交：

```sh
node cli/siyue-cli.cjs fill settings.update \
  --set section=move \
  --set values.maxDays=30 --set values.requireReason=是 \
  --out /private/path/move.plan.json
node cli/siyue-cli.cjs execute --plan /private/path/move.plan.json
```

“限制同年级”“限制同学科”等固定业务规则不能通过快填关闭。配置改动同样受当前员工权限、服务器业务规则和预览确认约束；本次配置快填验证仅在本机隔离环境执行，没有更改线上设置。

## 提交与重试

确认预览中的学生、班级、课次、金额和影响后，再执行计划。计划绑定服务器、员工身份、填写内容和数据版本；服务器在提交时再次检查权限及业务规则，计划过期或相关数据已变化时须重新预览。

网络提交超时或结果不明：保留并重试**同一计划文件**，避免一次业务被重复办理。若服务器已经办理成功，重复执行会返回 `replayed: true` 的已办理标识，不会再次写入，也不会重新返回原业务记录；需要查看最新记录时，使用 `get` 或刷新网页。明确的输入错误或数据版本变化：修改填写内容后生成新计划。不要修改已签发计划内容，也不要每次网络重试都创建新的幂等键。

## 本次验证范围

本次快填测试在**本机临时目录与隔离端口**启动真实 SQLite 后端，完成员工登录、建校区、建课程、按中文名称建班、按讲次名称 CSV 排课、批量报名错误纠正、预览、提交、重复执行及权限撤销校验，并验证了系统配置按分区转换“是 / 否”与整数、拒绝关闭固定业务规则。测试数据保存在隔离环境，不写入正式业务库。

另在本机运行的系统中，通过 CLI 登记隔离验收线索，验证了中文校区名称关联与全角手机号规范；提交后刷新浏览器，能看到同一条记录，点击该行即可在下方展开操作按钮。再次提交同一计划返回已办理标识，没有新增重复线索。

这证明快填指令能够与真实业务后端协同工作；本次快填测试没有向正式系统创建模拟学生、班级、订单或收款记录，也不代表真实支付渠道已经接通。线上部署与验收状态请以独立部署报告为准。
