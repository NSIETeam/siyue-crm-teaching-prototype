# 阿里云前端、认证与共享业务服务部署

前端静态文件与后端服务分别发布。Web 根目录只放白名单前端；业务 API 通过同源 `/crm-api/` 访问。正式模式已接入员工认证和共享 SQLite，页面不导入浏览器演示数据。真实支付渠道未配置。当前发布状态见 [共享后端上线记录](../../docs/backend-deployment-2026-10-11.html)。以下早期验收段落保留历史状态。

这里的脚本不会连接服务器，也不会自动申请域名、开放端口、修改防火墙或覆盖现有站点。服务器目录、Nginx 所属服务、域名、端口和可用子路径必须先由现场盘点确定。

## 已验证的基础发布（2026-10-10）

- 公开入口：**https://www.siyuejn.com/crm/**；阿里云 Nginx 在原有站点下增加 `/crm/`，静态目录为 `/opt/siyue-crm/current/public`，保留原站点服务。
- 基础发布版本 `20261010130313-d0ddc0d7ac14` 已完成上传、SHA-256 校验、原子切换及公网 HTTP 200 验证；首次发布的 46 个公开文件逐项校验通过，原站点原有 303 响应保持正常。
- HTTPS 已更换为覆盖 `siyuejn.com` 和 `www.siyuejn.com` 的有效证书。续期模拟通过，`certbot.timer` 已启用，证书更新后使用已配置的 Nginx 重载钩子。
- 这是基于浏览器 localStorage 的前端演示。后端设计与骨架未启用，未连接数据库；没有生产账号认证、真实收退款或跨用户共享状态。

以上为已验收的基础部署，不能据此推断之后每次代码变更都已发布。本轮临时转班、批量报名纠错与 CLI 课消模拟当前的实现和测试记录见 [增补文档](../../docs/siyue-update-2026-10-10.html)；每次新发布仍须执行下面的校验和回归。

## 推荐接入方式

**现有站点的独立子路径**：在已确认的 Nginx `server` 中增加一个此前未使用的 location；沿用原有监听和 HTTPS。此原型使用相对静态资源路径，业务页面在浏览器内部切换，不需要把任意 URL 回退到 index.html。

如需独立域名，在确认 DNS、证书和已有代理架构后创建独立站点；本包不预设 `listen` 或 `server_name`。如果现有入口是容器、面板生成配置、CDN 或负载均衡，应先确认真正生效的配置来源，避免修改会被自动覆盖的文件。

## 1. 先盘点，不修改

核对当前站点及健康状态、占用端口、Nginx 完整生效配置、运行用户、TLS/代理链路和文档根目录。记录拟新增子路径是否冲突、专用目录是否为空、磁盘空间、部署权限及回滚入口。不要把 SSH 密钥、控制台凭据或完整含密配置放进仓库。

服务器需有标准 Linux 工具：`tar`、`sha256sum`、`find`、`sort`、`cmp`、`readlink`、`ln`、GNU `mv -T`。仅静态发布不需要 Node；共享业务服务需要 Node 24.20 或更高版本（线上路径见下文），构建和 HTTP 验证可在本机运行。确认 Nginx 已加载 MIME 类型映射，能正确返回 JS/CSS/PNG。

## 2. 本机构建

```sh
node deploy/aliyun/build-release.cjs --out /absolute/existing/staging-directory
```

先将前端变更提交到 Git。构建器只复制 `public-files.json` 明确允许的已跟踪前端文件，并核对入口 HTML/CSS 依赖。它拒绝符号链接、未提交前端、未登记依赖和已有输出，禁止把发布产物写回仓库。

输出包含版本目录、`public/`、文件清单、SHA-256 校验和、版本说明，以及 `.tar.gz` 和压缩包校验和。只有 `public/` 会对外服务。脚本不会复制浏览器本地数据。

## 3. 生成候选 Nginx 配置

以下参数是占位示例，必须换成盘点后确认的专用目录和未占用子路径：

```sh
node deploy/aliyun/nginx-candidate.cjs \
  --prefix /chosen-prefix/ \
  --app-root /chosen/dedicated/root \
  --out /absolute/staging-directory/siyue-location.conf
```

生成物只是可插入既有 `server` 的 location 片段；无监听、域名、TLS、代理和后端设置。它拒绝目录浏览、仅允许 GET/HEAD、关闭文件描述符缓存并要求缓存重新验证。不设置局部 `add_header`，避免无意覆盖上层继承的安全响应头。

## 4. 传输、校验与原子切换

目录约定：

```text
<app-root>/
  releases/<release-id>/
    public/                  # 唯一公开目录
    SHA256SUMS
    public-files.list
    release-manifest.json
  current -> releases/<release-id>
  previous -> releases/<previous-release-id>
```

1. 通过已授权的连接上传压缩包和其校验和；先核对压缩包 SHA-256。
2. 查看压缩包条目，确认只有 `public/` 与三份元数据，没有绝对路径、`..` 或符号链接。只解压到新建、专用的 `releases/<release-id>/`；不覆盖任何旧目录。
3. 确认 Nginx 用户有目录遍历及文件读取权限；不使用 `chmod -R 777`，不更改其他应用权限。
4. 将 `activate-release.sh` 放在 Web 根目录之外，执行 `sh activate-release.sh <app-root> <release-id>`。它校验实际文件列表、逐文件哈希，拒绝符号链接和意外文件，通过同一文件系统的软链替换切换 `current`，保留 `previous`。无需删除旧版本。
5. 首次增加 location 时，先保存原配置，采用当前站点既有的配置方式加入候选片段；执行该实例正确的 Nginx 配置检查，再按原服务管理方式 reload。不能用猜测的服务名。配置检查失败则恢复配置，不 reload。

后续版本只切换 `current`，不必重启业务或修改 Nginx。此脚本不会执行配置检查、reload、删除或网络传输。

## 5. 验证与回滚

```sh
node deploy/aliyun/verify-http.cjs \
  https://confirmed-host/chosen-prefix/ \
  /absolute/release-directory/release-manifest.json
```

验证器仅发送 GET，逐一检查该次发布所有文件的哈希、长度和主要 MIME 类型，确认 backend/docs/CLI/.git 与版本元数据不可从该子路径访问。之后在真实浏览器检查首页、全局搜索、记录行展开、办理页返回、课表和商城。记录原站点的健康检查，确认其他路径仍正常。

版本回滚：执行同一激活脚本并指定之前版本 ID；它会校验旧版本，再切换软链。首次新增 location 出现问题时，恢复原配置、通过该实例配置检查并 reload；删除新配置引用即可，不删除已有站点或发布目录。

## 当前验收范围

本目录的脚本提供候选配置、打包、切换与校验能力；基础部署的实际验收结果见上文。后续上传、切换、生效和公网验证仍须逐次留证，不能把本地测试通过等同于线上版本更新。项目文档、CLI 与后端源文件不在阿里云前端发布白名单中。

### 2026-10-10 本轮更新验收

- 当前前端版本：`20261010133156-34031f277105`；49 个前端资源公网 SHA-256、大小与类型全部一致。
- 本轮临转、批量报名纠错与 CLI 课消演示已发布；GitHub 自动检查及 Pages 发布成功。
- Safari HTTPS 页面已验证搜索、预览与导入演示课消，显示 2 次合计 ¥600。
- 原站点仍返回原有登录跳转；Nginx、原业务服务和 PostgreSQL 均运行正常。
- 上一静态版本保留，后端骨架未部署。


## 员工认证服务（2026-10-10）

静态前端与认证服务分别发布：网页 `/crm/`，同源认证 API `/crm-api/`；原有站点、问答服务与数据库不迁移。`deployment-config.js` 仅在 `www.siyuejn.com` / `siyuejn.com` 启用登录；GitHub Pages 保留演示模式。

- 独立用户：`siyue-crm-auth`（无登录 shell）。
- 私有数据：`/var/lib/siyue-crm-auth/auth.json`，目录 0700、文件 0600，包含密码哈希、令牌哈希与认证审计，不在 Nginx 公开目录。
- 代码：`/opt/siyue-crm/auth-releases/<releaseId>`；`auth-current` 指向在用版本。
- 进程：`siyue-crm-auth.service`，仅监听 `127.0.0.1:8787`，由 Nginx 同源代理。
- 运行时：官方 Node.js 24.21.0 Linux x64，下载后核对官方 SHA-256；路径写在 service 模板中。
- 代理模板：`auth-api.nginx.conf`；service 模板：`siyue-crm-auth.service`。接口自行对登录实施账号、IP、全局限流。Nginx 覆盖真实来源地址。

提交已审核源码后，用 `node deploy/aliyun/build-auth-release.cjs --out /absolute/staging` 生成只含服务代码、契约与部署模板的包。包不包含账号库、初始密码、CLI 登录文件或测试资料。上线前核验文件哈希和 Nginx 配置，保留前一个代码链接和配置备份。

首次初始化只执行一次，凭证单独交付给负责人；以后使用平台管理员重置，不覆盖数据库。回滚时停止服务、将 `auth-current` 指回原版再启动；保留当前认证数据库，禁止以源码包覆盖或回退已变更密码/授权的数据库。没有旧认证版本时可停用本服务并保留私有数据，再回退前端；不能将演示身份作为认证替代。

正常停止会释放 writer 锁；异常退出时先确认锁内 PID 已停止再人工处理残留锁，不能盲删。单进程 JSON 存储适合此阶段的小规模账号服务；审计达到 32 MiB 时须先受控归档，后续应迁移到有备份和保留策略的数据库。上述为早期认证阶段的维护要求。现在启用 `SIYUE_BUSINESS_STORE` 后，已登记业务运行真实事务；未登记旧设计接口仍明确拒绝，真实支付渠道尚未配置。


## 共享业务服务（2026-10-11）

- 业务库：`/var/lib/siyue-crm-auth/business.sqlite`，与账号库在同一私有目录但独立保存；WAL、完整同步、版本冲突和幂等提交。
- 设置 `SIYUE_BUSINESS_STORE` 与 `SIYUE_POLICY_WORKER=1`。只有已发布的线索策略会参与定时回收。
- 构建器同时打包三个领域处理器、运行接口契约、备份工具和 service/timer，绝不打包数据文件。
- 压缩包校验并安全解压后，运行新版本内 `sh deploy/aliyun/activate-business.sh <auth-release-id>`。脚本使用本项目已盘点的服务器路径，仅适用于该主机；会停止本服务、备份已有账号和业务库，切换代码、检查本地及公网健康、检查 Nginx 并启动定时备份。账号存在是硬性前提，不会重新初始化。
- 错误仅回退代码及部署配置，保留当前数据；禁止用旧账号库覆盖已修改的密码、授权或会话。
- 备份：`/var/backups/siyue-crm`，每日北京时间03:20（最多延迟两分钟），目录0700、文件0600。首次部署立即运行一次；恢复步骤和一致性边界见 [后端说明](../../backend/README.md)。当前未配置异机副本或自动清理。
- 验收须逐一检查 API、备份定时器、Nginx、原题库服务及 PostgreSQL；`systemctl is-active` 多个参数仅能证明至少一个运行，不能替代逐个检查。
- 正式库不写入验收学生；服务器上的办理全链路测试使用临时独立账号与数据库，结束后只清理本次自建临时目录。
