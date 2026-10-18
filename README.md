# 思跃 CRM 与教务综合系统

Windows CLI 与 MCP：查看[免安装工具说明](docs/windows-tools.md)，或在 Releases 下载 Windows x64 / ARM64 压缩包。


## 当前生产源码（2026-10-18 同步）

本仓库已按线上 `20261018-trial-lead-picker` 前端和 `auth-trial-lead-picker-20261018` 后端同步，195 个生产文件逐一校验。正式入口仍使用同源 Node 认证与业务接口；没有将本地待发布的 Java 切换配置混入本次同步。运行数据、账号、密钥、日志和备份不在仓库中。

生产文件清单与 SHA-256 见 [production-version.json](production-version.json)，可运行 `node scripts/verify-production-snapshot.cjs` 核对本次快照。后续开发改动不应直接覆盖线上文件；完成发布后再更新快照记录。测试结果和旧演示测试的兼容性限制见 [同步记录](docs/production-sync-2026-10-18.md)。

生产部署工作流已入库：检查通过后自动构建发布包，实际发布由 `production` 环境保护和部署开关控制，默认关闭。SSH 密钥与主机公钥通过环境 Secrets 配置，详见 [生产自动化部署](docs/production-deployment.md)。

[员工入口](https://www.siyuejn.com/crm/) · [GitHub Pages 演示](https://nsieteam.github.io/siyue-crm-teaching-prototype/) · [项目计划与原始逻辑图](docs/siyue-project-plan.html) · [2026-10-11 共享后端报告](docs/backend-deployment-2026-10-11.html)

当前源码包含真实员工认证、共享 SQLite 业务服务、网页办理入口与 `siyue-cli`。正式模式的线索、学生、课程、班级、报名、订单、考勤、课消、营销和配置由服务器统一保存。业务写入经过权限校验、预览、确认与事务提交，不再以浏览器 localStorage 作为正式数据来源。

## 两种运行方式

| 入口 | 身份与数据 | 用途 |
| --- | --- | --- |
| 阿里云 `/crm/` 与同源 `/crm-api/` | 员工账号；服务器按权限返回共享数据 | 正式业务入口，当前发布验收状态见[本轮报告](docs/backend-deployment-2026-10-11.html) |
| GitHub Pages 或直接打开 `index.html` | 演示身份；浏览器内置示例及本地存储 | 查看交互、隔离演示，不连接正式业务库 |

首次启用业务库为空，不导入浏览器中的模拟学生、订单、课消或演示账号。登录、退出、切换账号及权限变化会清理页面旧数据；服务器不可用时显示连接失败，不退回示例数据。一次成功办理后重新读取服务端状态，同账号或其他获授权账号刷新后可见；目前不是实时推送或离线同步。

## 已接入的办理范围

- **CRM**：登记、整批导入、编辑、跟进、分配、转交、公海、领取、归档及恢复；保留与回收策略试运行、发布，以及显式开启的服务器定时任务。
- **教务**：课程逐讲内容和教学版本、班级、逐课次排期、批量建班、班级转校区、学生档案、单个与批量报名、永久转班、临时转班/补课、退课、未付款报名取消、代课、考勤与授课记录。
- **财务**：依据真实线下凭据人工确认收款；退款申请、核准、线下退款确认；课程权益、名单和课消关联同一订单。金额以整数分存储，页面用元填写。
- **商城与营销**：装修模块独立编辑及 iPhone 样式预览、草稿/发布版本、课程上架/下架、优惠配置、营销表单创建/发布/停止、客户公开填写与线索归集。
- **平台**：校区、教学字典、系统配置、职工业务档案、员工账号与可修改权限、按操作者/业务/结果/日期检索的服务端操作日志。

现有学生通过下拉选择；新生可在报名同一页填写姓名和手机号，不必另建档案。批量办理允许在原表中纠正错误；任一项失败整批不落库。列表点击后展开行内操作，后续在内容区办理；老师和学生课表保持矩形时间色块，教室与校区使用表格。

**在线收款渠道尚未配置。** `order.paymentLink` 明确返回不可用，不生成伪支付二维码。人工确认收款/退款只记录已经核实的线下凭据，不会向银行或支付平台发起扣款。拼团、联报目前只允许保存活动草稿；成团订单、联报多课程结算、渠道收款及相关异步闭环尚未实现，因此发布会被明确拒绝。

## 账号与权限

超级管理员从右上角设置进入“员工账号与权限”，可按姓名/工号生成账号及随机初始强密码，分配角色、校区范围和单项权限。初始密码只在创建/重置结果展示；首次登录必须改密。员工可改自己的密码；管理员可重置、停用和修改已创建账号的权限。

角色预设包括超级管理员、校长、教务、销售、财务、教师、运营和审计员。网页与 CLI 使用同一套最终授权。目录、资料读取、预览与执行均在服务端核验；改密、重置、停用和权限修改撤销旧会话，最后一名有效超级管理员受保护。当前服务是单机构、单服务实例，权限控制由应用执行，并非 PostgreSQL RLS 或多租户产品。

销售可查看累计本人归属线索与转化人数。首次确认正额实收时冻结销售归属，同一线索不重复计转化；后来转交不会把历史成交挪给新负责人。样本不足 10 条显示人数和进度，不显示误导百分比；达到 10 条再展示转化率。当前未提供销售排名。

## API、CLI 与一致性

正式接口以认证后的 `GET /v1/catalog` 为准，它返回当前账号允许的操作及输入模型。`GET /v1/state` 返回授权数据与版本；业务先 `preview`，再携带预览凭据、预期版本及 `Idempotency-Key` 执行。相同请求重试返回原结果；不同内容不能复用同一键。记录选择使用稳定 ID，网页展示名称。

```sh
node cli/siyue-cli.cjs login --username <员工账号>
node cli/siyue-cli.cjs passwd
node cli/siyue-cli.cjs list 报名
node cli/siyue-cli.cjs describe enrollment.create
node cli/siyue-cli.cjs get state
node cli/siyue-cli.cjs plan enrollment.create --input /private/path/input.json --out /private/path/new.siyue-plan.json
node cli/siyue-cli.cjs execute --plan /private/path/new.siyue-plan.json
```

首次改密后需要重新登录。密码隐藏输入，不放在命令参数或仓库中。CLI 计划文件含业务输入和短时预览凭据，必须放在仓库外私有目录；失败重试同一计划，避免重复办理。详见 [CLI 说明](cli/README.md)。

`simulate lesson-consumption` 仍是独立离线模拟，使用隔离存储，不连接正式 API。其 SIM 载荷仅供演示模式使用，正式业务界面不导入这些数据。

## 运行、测试与部署

共享后端需要 **Node.js ≥24.20**，使用内置 `node:sqlite`，无第三方运行依赖。配置认证与业务存储后才启用真实服务；配置方法、API 和备份恢复见 [后端说明](backend/README.md) 与[认证说明](backend/authentication.md)。

```sh
node tests/run.cjs
node --test backend/test/*.test.cjs
```

测试使用隔离 VM、临时文件或本机测试服务，不操作线上学生、订单或员工。自动化通过不等于浏览器视觉验收，也不代表该代码已部署。

GitHub Pages 从 `main` 发布演示；阿里云前端与后端独立构建、上传、校验、切换。推送代码不会自动迁移正式数据。源码、公开资料与业务数据库分开：认证文件、SQLite、备份、CLI 会话及预览计划不得提交公开仓库。静态版本切换与旧服务共存方法见 [阿里云维护说明](deploy/aliyun/README.md)；本轮部署时间、版本与验证证据统一记入[本轮报告](docs/backend-deployment-2026-10-11.html)。

## 计划与历史记录

[原始计划及逻辑图](docs/siyue-project-plan.html)、[2026-10-10 日报](docs/siyue-daily-2026-10-10.html)、[教务专项验收](docs/academic-audit-2026-10-10.html)、[全平台专项验收](docs/platform-audit-2026-10-11.html)保留当时的范围与结果；其中“本地原型”“接口待实现”等描述是历史状态，不应当作本轮共享后端现状。

仓库 `backend/contracts/operations.json` 与 `backend/contracts/openapi.json` 保留早期 **37 项设计契约**；PostgreSQL 建表和 RLS 仍属方案。启用共享业务后，线上 `/crm-api/openapi.json` 从当前处理器生成实际运行契约；仅未启用业务的设计模式仍返回旧契约。员工实际获授权的能力以 `/v1/catalog` 及服务端校验为准。
