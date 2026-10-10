# 阿里云静态原型部署与维护

仅发布当前前端。后端设计、SQL、CLI、测试和项目文档不进入 Web 根目录，不启动业务 API。没有登录服务、真实支付或多账号共享数据；换到新的域名/IP 后，原浏览器站点的数据不会自动迁移。

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

服务器需有标准 Linux 工具：`tar`、`sha256sum`、`find`、`sort`、`cmp`、`readlink`、`ln`、GNU `mv -T`。服务器无需 Node；构建和 HTTP 验证可在本机运行。确认 Nginx 已加载 MIME 类型映射，能正确返回 JS/CSS/PNG。

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
