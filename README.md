# 思跃 CRM 与教务综合系统

[在线原型](https://nsieteam.github.io/siyue-crm-teaching-prototype/) · [改造计划与原始逻辑图](https://nsieteam.github.io/siyue-crm-teaching-prototype/docs/siyue-project-plan.html) · [2026-10-10 日报](https://nsieteam.github.io/siyue-crm-teaching-prototype/docs/siyue-daily-2026-10-10.html) · [进度与问题验收](https://nsieteam.github.io/siyue-crm-teaching-prototype/docs/siyue-audit-2026-10-10.html)

前端交互原型。当前快照：2026-10-10。下载后可直接打开 index.html，无需安装依赖。

包含角色工作台、共享操作搜索、CRM、课程与班级、时间轴课表、单页报名、批量办理、商城装修、配置与权限原型。cli/ 中预留 siyue-cli 目录查询与调用计划。

## 使用边界

GitHub Pages 只托管静态前端，不提供真实认证、支付、退款或跨账号同步。页面中的演示身份不是生产权限系统，不应录入真实个人或财务数据。

业务状态为内置示例及当前浏览器数据；主业务、角色/员工、商城装修和表单资料可保存到 localStorage；尚未实现的流程在界面明确标注。file:// 与线上域名的数据互相独立，不随 Git 推送迁移。

## 更新与部署

main 分支由 GitHub Pages 从仓库根目录发布。以后 push 到 main 会触发 Pages 更新；本地项目目录的修改仍需显式同步到本仓库后提交。

backup-manifest.json 记录同步时的原型源码 SHA-256。docs/ 保留早期方案原件、图源和独立日报；早期方案中的计划项不等于当前已交付能力。

## 本地检查

`node tests/audit.cjs` 运行主流程回归，另见 tests/ 下 CRM、教务和商城专项检查。测试按 index.html 的实际脚本顺序加载，使用隔离存储，不读取真实浏览器数据；不是浏览器视觉或生产验收。
