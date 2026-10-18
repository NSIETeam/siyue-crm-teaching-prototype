# 当前生产前端回归

这些测试运行仓库根目录的真实前端模块及隔离后端，不连接正式业务数据。

```sh
node --test frontend-tests/*.test.cjs frontend-tests/*.test.mts
```

需要 Node 24，以支持原生 TypeScript 类型擦除。覆盖角色工作台、权限、课消、商城报名、学员沟通、线索登记与试听预约。

早期离线演示测试继续保留在 `tests/`。其 DOM 夹具尚未支持当前页面使用的 `hasAttribute`、`appendChild`、观察器等 API，CI 将其单独列为非阻断兼容性任务；该任务的失败仍需处理，不能算作通过。当前生产验收以 `backend/test/`、本目录与打包检查为准。单元测试不能替代真实账号、浏览器及业务办理验收。
