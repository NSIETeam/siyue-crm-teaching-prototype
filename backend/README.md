# 思跃后端与账号认证

这份目录包含可运行的员工账号认证、角色授权、会话撤销及审计服务，以及业务后端设计与数据库草案。设置 `SIYUE_AUTH_STORE` 后启用真实认证；未设置时仍为设计骨架。**报名、线索、课消、收款、退款等业务接口仍未接通，返回 501；浏览器原型业务数据仍存储在本地。**

账号初始化、完整接口、角色矩阵及安全边界见 [authentication.md](authentication.md)。认证服务使用独立私有存储，不连接现有题库数据库。

## 默认设计骨架

在仓库根目录执行：

```sh
node backend/src/server.cjs
node --test backend/test/*.test.cjs
```

默认仅监听 `127.0.0.1:8787`，不需要安装依赖。`SIYUE_BACKEND_PORT` 可以修改端口。

| 地址 | 当前行为 |
| --- | --- |
| `GET /healthz` | 返回 `mode: design-only`、`businessReady: false`，只表示骨架进程存活 |
| `GET /v1/catalog` | 返回公开的操作定义，不返回个人资料，也不是当前用户的授权结果 |
| `GET /openapi.json` | 返回接口契约；所有业务接口标注尚未实现 |
| 契约中声明的其他业务接口 | 固定返回 HTTP 501 和 `NOT_IMPLEMENTED`，不修改数据 |

骨架不接受角色请求头来授予权限，不生成可支付二维码，不把“确认已付费”当成实际到账。请求的 `Authorization`、请求体和个人信息不会写入进程日志。

## 文件与边界

- [architecture.md](architecture.md)：模块边界、事务、状态流转、权限、日志与落地顺序。
- [contracts/operations.json](contracts/operations.json)：稳定业务指令及输入字段；与现有 `cli/operations.json` 的页面入口 ID 建立别名映射。
- [contracts/openapi.json](contracts/openapi.json)：OpenAPI 3.1 接口契约。按操作区分字段，不使用一个无约束的大表单。
- [migrations/001_initial.sql](migrations/001_initial.sql)：PostgreSQL 第一版建表草案；只面向新的空数据库，尚未在数据库执行验收。
- [src/server.cjs](src/server.cjs)：原生 Node HTTP 骨架，显式拒绝所有业务读写。
- [test/contract.test.cjs](test/contract.test.cjs)：契约内部引用、目录别名、接口路由和骨架行为校验。

## 一次填写，统一生效

页面、万能搜索、`siyue-cli` 和 agent 将使用同一个操作目录、输入模型和服务端处理器。记录选择、报价预览和必要字段在一个办理页面完成。提交之后由事务统一更新档案、订单、报名关系、课次名单，再通过事件刷新其他页面。界面无需让用户分别维护这些表。

目录中的操作是**计划中的服务端业务操作**。现有 CLI 的 `list / describe / plan` 和浏览器的 `open` 仍只打开原型表单。不能把 `execution: planned` 当成已能执行。

## 业务后端正式连接前必须完成

数据库迁移实测、服务端逐条授权、事务处理器、可靠审计、支付渠道回调验签、幂等并发测试、备份恢复演练，以及页面逐项接入。认证服务可独立部署；未实现的业务不得伪造成功响应。数据库账号最小权限和 RLS 策略目前只有设计要求，尚未配置。
