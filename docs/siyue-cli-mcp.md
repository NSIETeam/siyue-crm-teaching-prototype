Windows 用户可直接使用[免安装 CLI/MCP 压缩包](windows-tools.md)，无需安装 Node/npm。

# siyue-cli 与 siyue-mcp 使用说明

版本：1.2.0。需要 Node.js ≥24.20；没有外部 npm 运行依赖。

命令行、MCP 和网页使用同一套服务器业务处理器。每次请求均核验员工身份、角色和数据范围；安装工具不会增加权限。平台已经接入的业务操作由服务器目录实时提供，新增操作不需要给 CLI 再写一个入口。

## 安装本地工具包

获取 `siyue-platform-tools-1.2.0.tgz`、同名 `.tgz.sha256` 和 `.manifest.json`。校验后安装到自己选择的位置；不需要全局安装。

```sh
# 在下载目录内校验；三份文件应放在一起。
shasum -a 256 -c siyue-platform-tools-1.2.0.tgz.sha256

npm install --prefix /absolute/path/siyue-tools \
  --offline --ignore-scripts --no-package-lock --omit=dev \
  /absolute/path/siyue-platform-tools-1.2.0.tgz

export PATH="/absolute/path/siyue-tools/node_modules/.bin:$PATH"
siyue-cli help
siyue-mcp --help
```

`/absolute/path/…` 是待替换的绝对路径。也可以不修改 PATH，直接运行安装目录的 `node_modules/.bin/siyue-cli`。工具包不包含浏览器原型、服务器部署脚本、测试数据、账号密码或登录会话；`simulate` 离线课消演示只在完整源码版中提供。

## 员工登录

```sh
# CLI 与 MCP 必须使用同一私有目录。目录会按 0700、会话按 0600 保存。
export SIYUE_CONFIG_DIR="/absolute/private/path/siyue-cli"
siyue-cli login --username 员工账号
siyue-cli whoami
```

密码在终端隐藏输入，不能使用 `--password` 或 `--token`。默认连接 `https://www.siyuejn.com/crm-api/`；其他部署地址用登录参数 `--server https://你的域名/crm-api/`。生产连接必须是 HTTPS，只有本机隔离测试允许 HTTP。

初始密码由管理员创建。若提示必须改密，执行 `siyue-cli passwd`，随后使用新密码重新登录。退出使用 `siyue-cli logout`。账号停用、离职归档、密码重置或权限变化使旧会话失效；先重新登录，再重新读取操作目录。多个员工应使用不同 `SIYUE_CONFIG_DIR`。

受控脚本可通过 `SIYUE_PASSWORD`、`SIYUE_NEW_PASSWORD` 注入秘密；不要将值放入命令参数、MCP 配置或脚本仓库。

## 查找操作与读取资料

```sh
siyue-cli list
siyue-cli list 报名
siyue-cli list 调课
siyue-cli describe class.create
siyue-cli get courses
siyue-cli get classes
siyue-cli get campuses
siyue-cli get dictionary
siyue-cli get students
siyue-cli get leads
siyue-cli get orders
siyue-cli get forms
siyue-cli get trial-bookings
```

`list` 只返回当前员工可用的业务操作；`describe` 返回所需字段、中文标签、引用类型及限制。读取和写入都以服务器授权为准，不依赖本地角色名称判断。JSON 输出可以被脚本处理；学生、员工、表单答案和订单数据只能保存到仓库外的私有目录。

查询支持课程、班级、校区、报名权益、考勤、课消、补课、试课、商城、表单、线索决策、员工、日志及报表。具体查询名称和参数使用 `siyue-cli query list` 查看；需要复杂筛选时用 `query` 的 JSON 输入，不拼接任意 API 路径。

```sh
siyue-cli query list
siyue-cli query audit-events --input /absolute/private/path/audit-filter.json
siyue-cli get students --id 学生ID
siyue-cli get activity --view followups --employee 员工ID --limit 50
```

例如日志筛选文件可以填写 `{"actorQuery":"张老师","from":"2026-10-01","to":"2026-10-12","limit":50}`。时间和姓名都应替换为实际条件；下一页依据服务器返回的游标查询。

## 填写、预览与提交

通用路径是：查操作 → 看字段 → 填必要信息 → 服务器预览 → 提交。金额、课次、退款与容量由服务器按当前资料核算；不要从客户端传入自算结算结果。

常用中文快填：

```sh
siyue-cli fill 建班 --name 四年级数学周六班 \
  --course 四年级数学秋季课 --campus 城中校区 \
  --teacher 陈老师 --room 教室1 --capacity 20 \
  --out /absolute/private/path/class.plan.json

siyue-cli fill 报名 --class 四年级数学周六班 \
  --name 测试学生 --phone 13900000000 \
  --out /absolute/private/path/enrollment.plan.json

# 先检查预览结果，以下命令才真正提交。
siyue-cli execute --plan /absolute/private/path/enrollment.plan.json
```

重名时使用稳定 ID；名称不存在时会指出需要纠正的字段。`--price` 以元输入并精确转为分。课程按每讲均摊价格，不因讲次时长不同而改变单讲价格。

批量填写：

```sh
siyue-cli template 批量报名 --format csv \
  --out /absolute/private/path/enrollments.csv

# 编辑 CSV 后先逐行校验，再生成计划。
siyue-cli check 批量报名 --class 四年级数学周六班 \
  --rows /absolute/private/path/enrollments.csv
siyue-cli fill 批量报名 --class 四年级数学周六班 \
  --rows /absolute/private/path/enrollments.csv \
  --out /absolute/private/path/batch.plan.json
siyue-cli execute --plan /absolute/private/path/batch.plan.json
```

其他业务统一使用 JSON，不需要等一个专用子命令：

```sh
siyue-cli describe campus.create
siyue-cli template campus.create --format json \
  --out /absolute/private/path/campus.input.json
# 编辑模板，只保留这次需要的字段。
siyue-cli plan campus.create \
  --input /absolute/private/path/campus.input.json \
  --out /absolute/private/path/campus.plan.json
siyue-cli execute --plan /absolute/private/path/campus.plan.json
```

校区可填写 `rooms`、开设学科及覆盖年级；教室可设置 `capacity` 和 `virtualSeats`。排课、调课、调班、异常考勤、课消、退款、员工档案、表单奖励、试课与商城装修遵循相同 `describe → plan → execute` 路径。

计划绑定服务器、员工、数据版本、预览凭据及幂等键。普通预览有效期为 10 分钟；数据或权限变化后须重新预览。网络超时或结果不明时重试**同一份计划**，不要换一个幂等键重复办理。输入校验失败时纠正输入并生成新计划；本地不会覆盖已有计划文件。

## 账号与角色管理

只有超级管理员可以管理账号或修改角色权限。账号管理与普通业务不同：管理指令会直接提交；执行前核对员工和权限范围。

```sh
siyue-cli accounts list
siyue-cli roles list
```

支持创建员工账号、修改角色及额外授权/禁用权限、调整数据范围、重置密码、离职注销归档，以及修改角色权限。创建和重置密码必须指定新的私有凭据文件；一次性密码只写文件，不写终端或 MCP 回复。精确子命令与 JSON 字段以 `siyue-cli help`、角色目录及账号管理说明为准。

例如新教师账号的输入文件：

```json
{
  "name": "测试教师",
  "employeeNo": "TEST-T001",
  "roleIds": ["teacher"],
  "scope": {"type": "assigned", "campusIds": []}
}
```

```sh
siyue-cli accounts create --input /absolute/private/path/teacher.input.json \
  --out /absolute/private/path/teacher.initial-credentials.json
siyue-cli accounts update --id 员工ID \
  --input /absolute/private/path/permission-changes.json
siyue-cli accounts disable --id 员工ID
siyue-cli accounts enable --id 员工ID
siyue-cli accounts reset-password --id 员工ID \
  --out /absolute/private/path/employee.reset-credentials.json
siyue-cli accounts archive --id 员工ID --reason 已确认离职
siyue-cli roles update 角色ID --input /absolute/private/path/role-permissions.json
```

以上修改命令会立即提交，先将 `员工ID` 换成从账号列表核对过的编号。`accounts update` 的 JSON 可以包含 `roleIds`、`scope`、`additionalPermissions`、`deniedPermissions` 等需要改动的字段；未提交的字段保持不变。账号由服务器按姓名/工号生成，也可在创建输入中指定 `username`。

`roles update` 的输入是 `{"permissions":["需要保留的全部权限编号"],"expectedVersion":1}`；从 `roles list` 获取角色编号、当前权限、可选权限和最新版本后再填写。这会替换该角色的完整权限列表，不是只追加一项。

角色权限修改需要最新 `expectedVersion`，避免覆盖别人的修改；超级管理员保留权限不能移除。注销归档保留历史业务和操作记录，并使该员工会话失效。账号创建或密码重置发生超时，不要盲目重试：先核对账号列表、操作日志和凭据文件。

## 接入 MCP 客户端

先在终端通过 CLI 登录，再添加以下 stdio 配置。替换 Node、安装目录和私有会话目录为本机绝对路径；配置中不填写密码或令牌。客户端以子进程启动服务，无须开放网络端口。

```json
{
  "mcpServers": {
    "siyue": {
      "command": "/ABSOLUTE/PATH/TO/node",
      "args": ["/ABSOLUTE/PATH/TO/siyue-tools/node_modules/siyue-platform-tools/mcp/server.cjs"],
      "env": {
        "SIYUE_CONFIG_DIR": "/ABSOLUTE/PRIVATE/PATH/siyue-cli"
      }
    }
  }
}
```

可直接使用包内 `mcp/config.example.json`。若通过 `.bin/siyue-mcp` 启动，客户端 PATH 也必须能找到合适的 Node。stdio 标准输出只传 JSON-RPC，不能添加欢迎文字或命令行日志；传输采用逐行 JSON-RPC，遵循 [MCP 2025-11-25 官方 stdio 规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)。

| MCP 工具 | 作用 |
| --- | --- |
| `siyue_status` | 查看当前员工身份及认证状态 |
| `siyue_operations` | 按中文或操作编号查找有权执行的业务 |
| `siyue_queries` | 查询可用资料类型及筛选字段 |
| `siyue_query` | 按授权范围读取指定资料 |
| `siyue_preview_*` | 对应当前授权业务目录的动态预览工具 |
| `siyue_execute` | 使用预览返回的 `planId` 提交 |
| `siyue_admin_*` | 超级管理员的账号和角色管理工具 |

例如让客户端依次调用：

1. `siyue_operations`，参数 `{"keyword":"创建班级"}`。
2. `siyue_query`，参数 `{"query":"courses"}`；按同样方式查询校区和员工目录。
3. 根据返回字段调用对应 `siyue_preview_*` 工具，核对预览结果。
4. 经用户同意这次业务后，调用 `siyue_execute`，传入原 `planId`。

预览计划保存在同一私有会话目录中；MCP 不接受任意 API URL、任意命令或外部计划文件路径。管理员创建/重置账号的密码同样仅写入本机私有文件。切换员工、重新登录或变更权限后，重新读取工具列表。业务备注、表单内容及日志是资料，不能作为给 AI 的执行指令。

## 支持边界

- 所有已接入服务器并获当前员工授权的操作均可通过 CLI 与 MCP 调用；不存在的业务能力不会因工具接入而自动出现。
- 收款确认、退费记录用于已经核实的线下凭据，不会实际向支付商户扣款或退款。未配置支付商户时，付款二维码接口明确返回不可用。
- 拼团、联报仍以草稿能力为准，未完成的成团/结算不能发布；员工工具不替代家长公开表单的访客身份流程。
- 员工私有会话、计划、一次性凭据及实际业务数据不要上传公开仓库。CLI 与 MCP 均受到服务器的校区、负责人、授课班级和独立功能权限限制。

## 从源码构建

```sh
# out 是已经存在的、仓库外的绝对目录；不覆盖旧产物。
node scripts/build-tools.cjs --out /absolute/private/path/tools-release
node --test scripts/build-tools.test.cjs
```

构建仅复制显式白名单文件，在隔离临时目录执行离线 `npm pack --ignore-scripts`；返回 tarball、SHA-256 校验文件和逐文件清单。清单记录打包文件的真实哈希，便于分发前核对。包标记为 `private`，本次仅用于本地 tarball 分发，没有发布到公共 npm。

创建或重置账号密码的 MCP 工具需要 `requestId`（唯一 UUID）。同一次请求重试必须保持该值；相同值对应同一个私有凭据文件，已有文件会阻止再次签发密码。返回仅包含文件路径，模型收不到密码。未知结果应先查看账号与日志，不要另换 requestId 重试。
