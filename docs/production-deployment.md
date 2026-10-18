# 生产自动化部署

工作流：[Production deployment](../.github/workflows/deploy-production.yml)。适用于现有思跃 Node 认证与共享业务服务，不负责初始化账号、数据库、Nginx、systemd 或切换 Java 服务。

## 触发方式

`main` 的 `Platform checks` 成功后自动测试并构建前后端发布包；也可在 Actions 手动运行，默认选择 `verify`，只构建，不连接生产服务器。

实际部署要求同时满足：

1. 仓库变量 `PRODUCTION_DEPLOY_ENABLED=true`。
2. 手动选择 `deploy`，或另行设置 `PRODUCTION_AUTO_DEPLOY=true` 允许 main 检查完成后进入部署。
3. `production` Environment 中配置的部署保护规则通过。
4. 配齐该环境的 SSH 连接配置，候选仍是 main 最新提交，且为服务器已记录提交的后继版本。

默认不启用这两个变量。仅将工作流提交到仓库不会激活生产部署。工作流不会由 PR、外部仓库或未通过的检查触发生产写入。

## 首次配置

在仓库 Settings → Environments 创建 `production`，先配置 Required reviewers，并将可部署分支限制为 `main`，再添加环境 Secrets：

| 名称 | 用途 |
| --- | --- |
| `PRODUCTION_SSH_HOST` | 生产 SSH 主机 |
| `PRODUCTION_SSH_USER` | 已获授权的部署账号 |
| `PRODUCTION_SSH_PORT` | SSH 端口；留空时为 22 |
| `PRODUCTION_SSH_KEY` | 此部署通道的专用 SSH 私钥 |
| `PRODUCTION_SSH_KNOWN_HOSTS` | 经独立核验的服务器公钥记录；非默认端口须使用 `[主机]:端口` 格式 |

不要把密钥写进代码、日志或发布包。工作流不使用 `ssh-keyscan` 临时建立信任，也不关闭主机校验。部署账号必须已经拥有目标发布目录、私有备份和认证服务管理所需权限；工作流不会创建账号、追加 sudo 权限或修改防火墙。现有应用根目录固定为 `/opt/siyue-crm`，认证服务固定为 `siyue-crm-auth.service`。

先运行 `verify` 并检查 `production-package` 制品；完成环境保护和专用密钥配置后，再启用 `PRODUCTION_DEPLOY_ENABLED` 并人工批准首次部署。只有确认运行方式后，才启用 `PRODUCTION_AUTO_DEPLOY`。保护规则的配置方式见 [GitHub 官方说明](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)。

## 发布链路

1. 检出经过检查的准确提交，运行语法、后端、现行前端、打包和部署故障回归。
2. 从已提交的白名单源码构建不可变前端和后端归档；记录 revision、每文件 SHA-256 与归档 SHA-256；制品只含源码及发布元数据。
3. 审批通过后，用严格主机校验的 SSH 上传到独立 incoming 目录，生成实际生产计划。
4. 对照 `source-sync/current.json` 核验生产版本及文件；第一次尚无该记录时，对照 `production-version.json`。发现手工热修复或其他发布导致的漂移时拒绝覆盖，须先同步最新生产代码。
5. 验证候选是当前部署提交的后继且仍为 main HEAD；并发锁与计划指纹防止两个发布互相覆盖。归档路径、链接、内容、权限及校验值在提取时再次检查。
6. 后端有变化时先停止认证写入，再在服务器私有目录备份账号与 SQLite，并校验备份完整性。切换后端、健康通过后切换前端；仅前端变化不重启认证服务。字节完全相同则只记录源码对应关系。
7. 核验全部公网前端文件、认证与业务健康，并确认未登录读取身份、业务状态与目录仍返回 401。完成后记录实际版本和提交。

工作流只上传发布源码和 source-only 计划/结果；账号、业务库与备份留在服务器，不作为 Actions artifact 下载。运行时现有支付服务配置保持原状，健康检查不将“支付未配置”视作本次部署失败。

## 失败恢复

旧版本保留。若激活失败且数据与停写后的快照完全相同，恢复原代码并启动原服务；不自动恢复数据库或覆盖账号数据。如果新版本已迁移或写入数据，则保留这些数据及私有备份，停止失败服务并报错，交由维护人员核对兼容性后恢复。检测到其他人已切换版本时，不回退他人的版本或服务。

公开制品 `production-deployment-evidence` 仅含版本、文件校验和与执行结果。具体回滚代码、备份路径和服务状态须在服务器排查；业务数据不能拷到公开问题单或日志。

## 本次验证边界

部署接收器在临时目录和模拟服务中验证了归档篡改/路径越界、漂移、并发、备份权限、停写后取快照、前端单独发布、健康失败恢复，以及数据已变化时拒绝恢复旧库；另对真实发布包做只读计划核验。首次通过 GitHub SSH 通道部署仍须完成环境配置后验证。本次没有上传部署密钥、启用自动发布或触发生产切换。
