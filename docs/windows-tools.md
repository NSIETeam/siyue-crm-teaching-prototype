# Windows CLI 与 MCP 1.2.0

适用于 Windows 11、Windows 10（仍处于微软支持范围的版本）和 Windows Server 2022/2025，使用本机 NTFS 用户目录。x64 与 ARM64 各有独立压缩包，自带 Node 24.21.0，不需要安装 Node/npm、Python，也不需要管理员权限。

## 下载与首次使用

从本仓库的 **Releases / Windows tools v1.2.0** 下载与你电脑架构对应的 ZIP。普通 Intel/AMD 电脑选择 `windows-x64`；Windows ARM 电脑选择 `windows-arm64`。解压到自己的固定文件夹，例如 `C:\Users\你的用户名\Siyue Tools`。不要直接在 ZIP 内运行，也不要放到共享文件夹。

双击 `Open-CLI.cmd`，在打开的窗口运行（账号替换为自己的平台账号）：

```bat
siyue-cli --version
siyue-cli login --username 你的账号
siyue-cli whoami
siyue-cli list
siyue-cli query list
```

输入密码时屏幕不显示字符，按 Enter 提交。新账号首次登录后运行 `siyue-cli passwd`，完成初始密码修改后重新登录。默认连接 `https://www.siyuejn.com/crm-api/`，账号权限与网页端一致。

PowerShell 中也可在解压目录运行 ` .\siyue-cli.cmd help`（移除开头空格）。无需改变 PowerShell 执行策略。没有全局 PATH 或注册表改动；每次使用可双击 `Open-CLI.cmd`。

## MCP 客户端连接

先登录，再执行：

```bat
siyue-cli mcp-config
```

把输出的 `mcpServers.siyue` 配置放入支持 stdio MCP 的客户端配置中，重启客户端后调用 `siyue_status` 验证身份。配置使用本机 `node.exe` 和 `mcp/server.cjs` 的绝对路径，不包含密码或令牌，也不依赖终端 PATH。路径含空格、中文时由 JSON 自动转义，无需手工加引号。如果客户端要求分别填写 Command/Arguments，就使用对应字段。移动解压目录后重新生成配置。

CLI 和 MCP 必须在同一个 Windows 用户下运行；如设置 `SIYUE_CONFIG_DIR`，生成的配置会保留它。未登录时 MCP 只提供状态检查；登录后重新加载工具列表。MCP 不监听任何网络端口，标准输出仅包含协议消息；不要把 `Open-CLI.cmd` 用作 MCP 入口。

## 业务操作

```bat
siyue-cli list 线索
siyue-cli describe 操作编号
siyue-cli plan 操作编号 --input "C:\我的文件\input.json" --out "C:\我的文件\preview.plan.json"
siyue-cli execute --plan "C:\我的文件\preview.plan.json"
```

先检查预览，确认后再执行；同一个计划的重复提交使用同一个幂等键。MCP 对应先调用 `siyue_preview_...`，核对结果，再调用 `siyue_execute` 并传入原 `planId`。服务器继续执行角色、校区、记录权限、审计和状态流转校验。

输入 JSON/CSV 使用 UTF-8。计划文件、导出资料和初始密码文件可能含业务信息，保存在自己的目录内；输出文件已存在时不会覆盖。详细操作见同包 `docs/siyue-cli-mcp.md` 或 `siyue-cli help`。

## 本机凭据与故障排查

Windows 默认会话位置为 `%LOCALAPPDATA%\Siyue\cli`。登录令牌由 Windows DPAPI 当前用户加密，目录及私有输出文件使用仅当前用户和 SYSTEM 可访问的权限。不能把会话复制给其他用户使用。旧版明文 Windows 会话需要重新登录。密码不保存，密码和令牌不允许放到命令参数或 MCP 配置中。

- `PRIVATE_FILE_PROTECTION_FAILED`：使用自己的本机 NTFS 目录；确认系统 Windows PowerShell 可用，避免网络盘、FAT/exFAT、目录联接或共享配置目录。不要关闭权限保护。
- `UNAUTHENTICATED`：运行登录命令，再刷新 MCP 工具列表。
- `PASSWORD_CHANGE_REQUIRED`：先修改初始密码并重新登录。
- `SESSION_CHANGED`：账号在操作期间被切换，重新运行操作并核对身份。
- MCP 无响应：重新生成配置，核对绝对路径；Command 应指向随包 `runtime\node.exe`。
- 退出登录：`siyue-cli logout` 撤销服务器会话并删除本机令牌。卸载可删除解压文件夹；业务计划/导出文件需自行按需保留。

发布包不含员工账号、学生资料、服务器密钥和已登录会话。ZIP 旁提供 SHA-256 校验文件，包内 `manifest.json` 记录源码版本与运行文件校验值。Windows 原生 CI 验证与用户实际电脑验收是独立环节；支持范围及每次发布验证结果见 GitHub Actions。
