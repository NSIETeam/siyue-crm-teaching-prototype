# 思跃 CRM 与教务综合系统

[阿里云在线原型](https://www.siyuejn.com/crm/) · [GitHub Pages 镜像](https://nsieteam.github.io/siyue-crm-teaching-prototype/) · [改造计划与原始逻辑图](https://nsieteam.github.io/siyue-crm-teaching-prototype/docs/siyue-project-plan.html) · [2026-10-10 日报](https://nsieteam.github.io/siyue-crm-teaching-prototype/docs/siyue-daily-2026-10-10.html) · [进度与问题验收](https://nsieteam.github.io/siyue-crm-teaching-prototype/docs/siyue-audit-2026-10-10.html)

前端交互原型。当前快照：2026-10-10。下载后可直接打开 index.html，无需安装依赖。

包含角色工作台、共享操作搜索、CRM、课程与班级、时间轴课表、单页报名、批量办理、商城装修、配置与权限原型。cli/ 提供 siyue-cli 目录查询、调用计划和实际执行应用处理器的隔离课消模拟。

## 当前部署

阿里云访问地址：**https://www.siyuejn.com/crm/**。2026-10-10 的基础静态发布已完成公网访问及逐文件校验；HTTPS 证书、自动续期模拟和定时器已验证，原站点仍可访问。部署与回滚方法见 [阿里云维护说明](deploy/aliyun/README.md)。

本轮临时转班、批量报名纠错及课消模拟的实现和测试见 [独立增补记录](docs/siyue-update-2026-10-10.html)。本轮前端版本 `34031f277105` 已发布到阿里云与 GitHub Pages，49 个公开文件逐项校验一致；Safari 已实际验证线上演示导入后为 2 次课消、¥600。

## 使用边界

阿里云与 GitHub Pages 都只托管静态前端，不提供真实认证、支付、退款或跨账号同步。页面中的演示身份不是生产权限系统，不应录入真实个人或财务数据。

业务状态为内置示例及当前浏览器数据；主业务、角色/员工、商城装修和表单资料可保存到 localStorage；尚未实现的流程在界面明确标注。file:// 与线上域名的数据互相独立，不随 Git 推送迁移。

## 更新与部署

main 分支由 GitHub Pages 从仓库根目录发布。以后 push 到 main 会触发 Pages 更新；阿里云需另外构建、上传、校验并切换静态版本，不会随 Git 推送自动更新。本地项目目录的修改仍需显式同步到本仓库后提交。

backup-manifest.json 记录同步时的原型源码 SHA-256。docs/ 保留早期方案原件、图源和独立日报；早期方案中的计划项不等于当前已交付能力。

## 本地检查

`node tests/run.cjs` 运行脚本语法检查及主流程、CRM、教务、商城、退课、快捷操作、操作日志与页内返回回归。测试按 index.html 的实际脚本顺序加载，使用隔离存储，不读取真实浏览器数据；不是浏览器视觉或生产验收。

## 列表快捷操作与操作日志

欠费行支持到账确认及演示订单二维码；学生行支持档案、退费、永久和临时转班；员工行支持授权档案及账号管理。学生、老师和职工档案分别授权。操作日志按业务、演示身份、结果、日期及对象检索，记录修改前后值；写入前保留执行记录，存储失败不冒充完成。日志从本版起在当前浏览器记录，不能跨设备汇总或提供服务端防篡改审计。二维码不连接真实支付。

## 页内办理与后端预留

列表记录点击后在本行下方展开操作，批量入口先展开下一步按钮，再进入页内办理。顶栏返回使用统一左箭头，保留来源视图与筛选；返回会重验权限和记录身份，不恢复旧业务数据。欠费二维码/收款核对、学生和员工档案、课次处理、对象选择及日志详情已迁入内容区。未保存权限仍保留必要的离开确认。

[后端设计与骨架](backend/README.md)包含架构图、PostgreSQL 建表草案、37 项业务指令和 OpenAPI 契约。当前未部署、未连接页面或数据库；业务接口明确返回 501。`node --test backend/test/*.test.cjs` 的 6 项契约与本机 HTTP 检查通过，数据库迁移尚未实跑。

## 本轮办理与 CLI 模拟

临时转班只提供同年级、同学科、同课程、同讲次及版本的有效目标，提交时重验容量、时间、校区规则与授权，保留原班长期归属。批量报名校验页支持逐行改学生、电话和班级，移出或恢复本次记录，并重新计算报价；确认前不修改档案，成功确认只创建待支付订单。

`node cli/siyue-cli.cjs simulate lesson-consumption --out /absolute/new-output-directory` 在隔离存储执行课消模拟：到课、请假、重复保存、临时班原订单归属、权限与异常处理等 10 项场景。可导出带 SIM 标识的记录，在页面预览后显式导入；不会自动操作浏览器数据。CLI 专项测试用 `node --test cli/simulation.test.cjs` 运行；更多边界见 [CLI 说明](cli/README.md)。
