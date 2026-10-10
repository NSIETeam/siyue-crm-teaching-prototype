# 员工账号、认证与权限

本目录已实现可独立部署的账号认证服务。**报名、线索、课消、支付等业务接口仍返回 501；真实业务数据的逐条权限校验与跨账号同步尚未接通。** 不能用浏览器原型中的演示身份或本地数据作为服务器授权依据。

## 初始化与运行

Node.js 20 或更新版本，无第三方依赖。认证数据使用独立非登录系统用户持有的目录；目录权限必须为 `0700`，文件为 `0600`。本服务只支持单进程写入。

```sh
node backend/src/bootstrap-auth.cjs --store /var/lib/siyue-crm-auth/auth.json --out /var/lib/siyue-crm-auth/initial-admin.json
```

此命令仅允许在尚无账号时执行：生成随机的 `admin-` 账号、36 位随机初始密码，写入指定凭证文件；标准输出只有账号与凭证文件位置，没有密码。输出文件已存在时拒绝覆盖。名称固定为“超级管理员”，不依赖真实员工资料。首次登录只能修改密码、查询本人登录状态或退出。

启动前设置：

| 配置 | 作用 |
| --- | --- |
| `SIYUE_AUTH_STORE=/var/lib/siyue-crm-auth/auth.json` | 显式启用认证；不设置时仍运行原有设计骨架 |
| `SIYUE_PUBLIC_ORIGIN=https://www.siyuejn.com` | 浏览器登录及写请求必须完全匹配此 Origin |
| `SIYUE_COOKIE_PATH=/crm-api/` | Cookie 仅发送到反向代理的 API 路径 |
| `SIYUE_TRUST_PROXY=loopback` | 仅信任本机反向代理覆盖的 `X-Real-IP`，不采信任意 `X-Forwarded-For` |
| `SIYUE_BACKEND_PORT=8787` | 仅监听 `127.0.0.1` |

反向代理将 `/crm-api/` 前缀移除后交给本服务，例如 `/crm-api/v1/auth/me` 转发到 `/v1/auth/me`。应覆盖 `X-Real-IP` 并限制登录请求速率。服务目录须包含 `backend/` 及 `cli/operations.json`；后者只提供公开操作别名。

正常 `SIGTERM` / `SIGINT` 会停止接收请求、关闭存储并移除 writer 锁。异常退出后，先确认 `<store>.lock` 内的 PID 已停止，再移除残留锁。禁止在原进程仍可能写入时直接删除锁。锁存在时第二个进程拒绝启动。数据文件原子替换并同步；写失败不会改变内存中的账号或会话。

## 接口约定

所有响应禁止缓存。错误为 `{code,message,requestId}`，不输出请求密码、会话令牌或内部异常。JSON 请求上限 16 KiB。

| 方法与地址 | 输入 / 行为 |
| --- | --- |
| `POST /v1/auth/login` | `{username,password,client:"browser"\|"cli"}`；返回 `{user,expiresAt}`；浏览器另返回 `csrfToken` 并设置 Cookie，CLI 另返回 `token` |
| `GET /v1/auth/me` | 返回当前 `{user,expiresAt}`；浏览器另返回 `csrfToken` |
| `POST /v1/auth/password` | `{currentPassword,newPassword}`；成功返回 `{changed:true,reauthenticate:true}`，撤销该用户全部会话 |
| `POST /v1/auth/logout` | 撤销当前会话；浏览器同时清除 Cookie |
| `GET /v1/roles` | 返回 `roles` 与全部可配置 `permissions` |
| `GET /v1/catalog` | 仅返回当前账号有权使用的业务 `operations` 及其 `frontendOperations`；业务执行依然未实现 |
| `GET /v1/admin/users` | 超级管理员获取账号列表，无密码或密码哈希 |
| `POST /v1/admin/users` | 超级管理员创建账号；字段见下；仅此次返回 `initialPassword` |
| `PATCH /v1/admin/users/:id` | 超级管理员修改姓名、角色、权限、数据范围或停用状态；即时撤销目标账号全部会话 |
| `POST /v1/admin/users/:id/reset-password` | 超级管理员生成新的随机初始密码，立即撤销目标全部会话并要求再次改密 |
| `GET /v1/admin/audit` | 超级管理员或明确拥有 `audit.read` 的账号可分类检索认证和账号操作日志 |

浏览器使用 `HttpOnly; Secure; SameSite=Strict` Cookie，JavaScript 无法读取会话令牌。所有浏览器写请求还需正确 `Origin` 及 `X-CSRF-Token`。登录请求需要正确 `Origin`，尚未有会话时不要求 CSRF。CLI 使用 `Authorization: Bearer <token>`，不接受角色请求头，不可将浏览器 Cookie 当成 CLI 令牌。

登录有效期最长 8 小时；初始密码登录有效期 10 分钟。每次请求均核查用户停用状态、会话有效期及用户版本。普通员工不能自提权。密码至少 14 位，包含大小写字母、数字和符号，且不能包含账号或与原密码相同。服务端使用独立随机盐的 scrypt 哈希（N=32768、r=8、p=1、64 字节输出）及恒定时间比较；Bearer 令牌仅保存 SHA-256，不保存明文令牌。登录有账号、IP 和全局三层速率限制；账号不存在、密码错误、账号停用统一返回相同认证错误。

## 账号字段和可变授权

创建请求：

```json
{
  "name": "测试销售",
  "employeeNo": "E010",
  "roleIds": ["sales"],
  "scope": {"type": "own"},
  "additionalPermissions": [],
  "deniedPermissions": []
}
```

`username` 可以由超级管理员显式指定；缺省优先根据工号生成（如 `sy-e010`），没有工号时用姓名中的拉丁字符，纯中文姓名转换为稳定 Unicode 编码，并自动避免重名。不依赖在线拼音服务。账号创建后固定，姓名和权限仍可修改。初始密码不进入审计，列表接口不再次返回。

`user` 返回 `id / username / name / employeeNo / roleIds / permissions / additionalPermissions / deniedPermissions / scope / mustChangePassword / disabled / version / createdAt / updatedAt`。`permissions` 是最终生效结果：角色权限并集 + 额外授权 − 禁止权限。拒绝未知权限。`employee.create / account.update / role.grant` 为保留管理权限，不能通过额外授权伪造超级管理员；只有明确的 `superadmin` 身份可以管理账号。

| 角色 | 默认范围 | 默认职责与边界 |
| --- | --- | --- |
| `superadmin` 超级管理员 | 全部 | 管理账号、权限与全部日志；不能停用或降权最后一名有效超级管理员 |
| `principal` 校长 | 指定校区 | 线索分配、教务与经营统计；不管理账号权限，不默认确认到账 |
| `academic` 教务 | 指定校区 | 课程、班级、报名、转班、课次与考勤；不确认收款 |
| `sales` 销售 | 本人 | 本人线索跟进、报名、收款入口与转化率；不确认到账 |
| `finance` 财务 | 指定校区 | 订单、收款核对、退款及课消报表；不编辑课程与线索 |
| `teacher` 教师 | 分配给本人 | 本人课表、对应学生与课次登记；不管理账号或财务 |
| `operations` 运营 | 指定校区 | 活动线索、营销策略与商城内容；不默认统一分配线索或处理到账 |
| `auditor` 只读审计员 | 指定校区 | 只读业务资料与报表；平台操作日志须另行明确授予 `audit.read` |

超级管理员可在创建后逐项增减权限、修改角色和数据范围。范围类型为 `all / campus / own / assigned`；`campus` 必須提供非空 `campusIds`，其余类型不接受校区列表。超管始终为全部范围。跨角色组合和额外授权需要超级管理员明确设置，前端不能自行扩大范围。后续实现业务接口时必须在服务端将此范围应用到逐条数据查询与写入；当前未接通的接口维持 501，不能据此宣称业务数据隔离已完成。

## 审计与验证

审计记录：初始化、成功/失败登录、账号列表读取、创建、重置密码、改密、改权限、停用、退出、日志查询，以及已授权但尚未实现的业务操作尝试。拒绝操作记录已确认的操作者。审计不包含明文密码、Bearer 令牌或业务请求体。

检索参数：`actor` 或 `actorId`、`action`、`outcome`、`from`、`to`、`limit`（1–500），`before` 使用上一页返回的 `nextBefore` 事件 ID。以事件 ID 分页避免同一毫秒的多条记录丢失。单文件达到 32 MiB 时停止继续写入并报错；需先将审计归档到受控存储，不自动删除历史记录。

```sh
node --test backend/test/*.test.cjs
```

测试覆盖初始化与文件权限、密码哈希和令牌不落明文、首次改密限制、Cookie/Origin/CSRF、销售越权、授权修改撤销会话、密码重置与停用、最后超管保护、写失败回滚、无账号枚举、登录速率限制、符号链接拒绝及原有业务 501 边界。
