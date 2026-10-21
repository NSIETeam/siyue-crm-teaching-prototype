# 员工账号、认证与权限

本目录已实现独立员工认证，并可连接 [SQLite 共享业务服务](README.md)。同时设置认证与业务存储时，已登记处理器执行真实业务事务和范围校验；仅启用认证时未接通业务仍返回501。不能用演示身份或本地原型数据作为服务器授权依据。支付渠道仍未接通。

## 初始化与运行

本仓库统一使用 Node.js ≥24.20，无第三方运行依赖。认证数据使用独立非登录系统用户持有的目录；目录权限必须为 `0700`，文件为 `0600`。本服务只支持单进程写入。

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

所有响应禁止缓存。错误为 `{code,message,requestId}`，不输出请求密码、会话令牌或内部异常。认证 JSON 请求上限16 KiB；独立业务请求上限1 MB。

| 方法与地址 | 输入 / 行为 |
| --- | --- |
| `GET /v1/auth/captcha` | 公开验证码端点，返回 `{id,image,expiresAt}`；`image` 是 PNG data URL，同时设置安全挑战 Cookie |
| `POST /v1/auth/login` | `{username,password,client:"browser"\|"cli"}`；浏览器另需 `captchaId / captchaCode`，可选布尔值 `remember`；返回 `{user,expiresAt}`，浏览器另返回 `csrfToken` 并设置 Cookie，CLI 另返回 `token` |
| `GET /v1/auth/me` | 返回当前 `{user,expiresAt}`；浏览器另返回 `csrfToken` |
| `POST /v1/auth/password` | `{currentPassword,newPassword}`；撤销旧会话。浏览器首次改密原子签发新会话并返回 `{changed:true,reauthenticate:false,user,csrfToken,expiresAt}`；CLI 和浏览器日常改密返回 `{changed:true,reauthenticate:true}`，要求重新登录 |
| `POST /v1/auth/logout` | 撤销当前会话；浏览器同时清除 Cookie |
| `GET /v1/roles` | 返回当前有效 `roles`、全部可配置 `permissions` 和 `reservedPermissions`；每个角色包含 `version` 和 `editable` |
| `PATCH /v1/admin/roles/:id` | 超级管理员提交 `{permissions,expectedVersion}` 修改角色权限；返回 `{role,affectedUsers,changed}` |
| `GET /v1/catalog` | 仅返回当前账号有权使用的业务 `operations` 及其 `frontendOperations`；启用共享业务时返回当前运行输入模型；未启用时仍为设计目录 |
| `GET /v1/admin/users` | 超级管理员获取账号列表，无密码或密码哈希 |
| `POST /v1/admin/users` | 超级管理员创建账号；字段见下；仅此次返回 `initialPassword` |
| `PATCH /v1/admin/users/:id` | 超级管理员修改姓名、角色、权限、数据范围或停用状态；即时撤销目标账号全部会话 |
| `POST /v1/admin/users/:id/archive` | `{reason?}` 软归档离职员工，返回 `{user,archived:true}`；强制停用并撤销全部会话，保留业务历史关联 |
| `POST /v1/admin/users/:id/reset-password` | 超级管理员生成新的随机初始密码，立即撤销目标全部会话并要求再次改密 |
| `GET /v1/admin/audit` | 超级管理员或明确拥有 `audit.read` 的账号可分类检索认证和账号操作日志；共享业务启用后合并业务审计 |
| `GET /v1/sales/activity` | 按授权范围查询销售活动；`view=activity`（默认）按日期查询，`view=followups` 按时间倒序读取历史跟进并使用 `cursor` 分页，不受 `from/to` 限制 |

浏览器使用 `HttpOnly; Secure; SameSite=Strict` Cookie，JavaScript 无法读取会话令牌。所有浏览器写请求还需正确 `Origin` 及 `X-CSRF-Token`。登录请求需要正确 `Origin` 和一次性图片验证码，尚未有会话时不要求 CSRF。携带 `Origin`、`Sec-Fetch-Site` 或本站认证/验证码 Cookie 的请求不能把 `client` 写成 `cli` 来跳过验证码，返回 `BROWSER_CLIENT_REQUIRED`。CLI 使用 `Authorization: Bearer <token>`，不接受角色请求头，不可将浏览器 Cookie 当成 CLI 令牌。

浏览器默认使用不含持久化期限的会话 Cookie，服务端有效期最长 8 小时；勾选 `remember:true` 后使用持久安全 Cookie，服务端有效期最长 30 天。CLI 始终最长 8 小时。初始密码登录仍最多 10 分钟，但保留记住登录的选择；浏览器首次改密时在同一持久化事务内修改密码、撤销全部旧会话并签发新会话，前端直接使用响应进入平台，无须再次登录。保存失败不会签发 Cookie 或撤销原会话。退出、管理员重置密码、停用和修改员工个人权限继续立即使相关会话失效。每次请求均核查用户停用状态、会话有效期及用户版本。普通员工不能自提权。密码至少 10 位，包含大小写字母、数字和符号，且不能包含账号或与原密码相同。服务端使用独立随机盐的 scrypt 哈希（N=32768、r=8、p=1、64 字节输出）及恒定时间比较；Bearer 令牌仅保存 SHA-256，不保存明文令牌。登录有账号、IP 和全局三层速率限制；账号不存在、密码错误、账号停用统一返回相同认证错误。

## 图片验证码

浏览器先获取 `/v1/auth/captcha`，再提交登录：

```json
{
  "username": "sy-e010",
  "password": "<用户输入>",
  "client": "browser",
  "remember": true,
  "captchaId": "<验证码响应 id>",
  "captchaCode": "<用户看到的六位数字>"
}
```

验证码由加密随机源生成六位数字（保留开头的零），在服务器将字形路径栅格化为 PNG 像素，再输出图片；不发送字形路径、数字文本节点或答案元数据。内存中仅保留答案 HMAC、随机挑战绑定值的哈希和过期时间，不写文件、审计或日志。`siyue_challenge` Cookie 为 `HttpOnly; Secure; SameSite=Strict`，路径与认证 API 一致，有效期 120 秒。答案和挑战 ID 必须与此 Cookie 同时匹配。验证码不替代密码、登录限流或 CSRF 校验。

每次验证码校验尝试都会作废挑战，无论答案正确、错误或缺失；答对后若账号密码错误也必须重新取图。刷新验证码会替换该浏览器旧挑战。过期、重复使用或 Cookie 不匹配返回 `400 CAPTCHA_INVALID`，缺项返回 `400 CAPTCHA_REQUIRED`。前端在失败后重新取图，不重复提交旧挑战。端点禁止缓存，有每 IP 每分钟 20 次、全局每分钟 200 次限制，并最多保留 512 个未过期挑战；超限返回 `429 RATE_LIMITED`。跨站来源被拒绝。重启后未完成挑战失效，重新取图即可。

自动化测试可在 `createAuthService` 构造参数中的 `captchaOptions` 注入随机数和时钟；正式进程不从环境变量读取此选项，也不存在固定验证码或关闭验证的生产开关。部署须包含新增模块 `backend/src/auth-captcha.cjs`。

## 账号字段和可变授权

### 修改角色权限

超级管理员在「员工管理 → 权限管理」选择角色后，勾选权限并点击保存。修改作用于具有此角色的现有员工及以后分配到此角色的员工，员工个人的额外允许与明确禁止仍按原优先级生效，校区等数据范围不变。角色草稿不会因点击选项而自动提交。

角色配置存入独立认证存储，旧存储缺少此配置时继续采用内置默认值。服务每次授权均读取当前有效配置；权限撤销不会等待员工退出登录。角色更新同步有效会话的用户版本，不延长会话有效期，也不恢复已经撤销的会话。员工账号停用、密码重置等原有撤销规则不变。

更新请求必须提交最近读取到的 `expectedVersion`；版本过期返回 `409 ROLE_VERSION_CONFLICT`，应重新读取后核对修改。无变化的保存返回 `changed:false`。角色变更写入 `role.update` 日志，显示角色名称、增加和移除的权限以及影响人数。

超级管理员角色保持完整权限，防止失去账号管理能力；其他角色不能授予 `employee.create / account.update / role.grant` 这些保留权限。其余业务权限可编辑。浏览器写入仍要求 Origin 和 CSRF 校验，API 不接受普通员工修改角色。

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

`user` 返回 `id / username / name / employeeNo / roleIds / permissions / additionalPermissions / deniedPermissions / scope / mustChangePassword / disabled / version / createdAt / updatedAt / archivedAt / archivedBy / archiveReason`。未归档账号的归档字段为 `null`。`permissions` 是最终生效结果：角色权限并集 + 额外授权 − 禁止权限。拒绝未知权限。`employee.create / account.update / role.grant` 为保留管理权限，不能通过额外授权伪造超级管理员；只有明确的 `superadmin` 身份可以管理账号。

归档是不可通过普通账号编辑撤销的软归档：归档账号被停用、版本递增、所有会话撤销；历史报名、课次、订单和审计仍保留原用户 ID。不能归档当前登录账号、最后一名有效超级管理员或重复归档账号；归档账号不能再次启用或重置密码。可选 `reason` 最长 200 字，保存在归档档案中。`account.archive` 审计返回目标员工姓名以及安全摘要 `{archived:true,archiveReason?}`，不会投影原始详情或 IP。

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

超级管理员可在创建后逐项增减权限、修改角色和数据范围。范围类型为 `all / campus / own / assigned`；`campus` 必須提供非空 `campusIds`，其余类型不接受校区列表。超管始终为全部范围。跨角色组合和额外授权需要超级管理员明确设置，前端不能自行扩大范围。当前共享业务处理器已将此范围应用于资料投影和读写校验；仅启用认证的部署不因此获得业务接口。更细的业务规则、备份与实现边界见 [后端说明](README.md)。

## 审计与验证

审计记录：初始化、成功/失败登录、账号列表读取、创建、重置密码、改密、改权限、停用、归档、退出、日志查询，以及未接通接口的操作尝试。启用共享业务后，业务预览、成功/失败执行和变更另记于 SQLite，并统一检索。拒绝操作记录已确认的操作者。审计不包含明文密码、Bearer 令牌或业务请求体。

检索参数：`actor` 或 `actorId`、`action`、`outcome`、`from`、`to`、`limit`（1–500），`before` 使用上一页返回的 `nextBefore` 事件 ID。以事件 ID 分页避免同一毫秒的多条记录丢失。单文件达到 32 MiB 时停止继续写入并报错；需先将审计归档到受控存储，不自动删除历史记录。

```sh
node --test backend/test/*.test.cjs
```

测试覆盖初始化与文件权限、密码哈希和令牌不落明文、首次改密限制与原子会话轮换、验证码一次性/绑定/过期/限额、8 小时及 30 天 Cookie/会话、Cookie/Origin/CSRF、销售越权、授权修改撤销会话、密码重置与停用、最后超管保护、写失败回滚、无账号枚举、登录速率限制、符号链接拒绝及仅认证/设计模式的业务501边界。
