# 拼团推广内容与专属报名链接

## 保存与发布

promotion.create 和 promotion.update.patch 接受下列专用字段：

| 字段 | 用途 | 新提交内容限制 |
| --- | --- | --- |
| promotionTitle | 推广标题 | 20 个 Unicode 码点 |
| promotionSubtitle | 推广副标题 | 20 个 Unicode 码点 |
| promotionIntroduction | 推广介绍 | 50 个 Unicode 码点 |
| posterBackground | 海报背景 | 空串、#RRGGBB 或 2048 字符以内的公开 HTTPS 图片 URL |

文本去除首尾空白后按 Unicode 码点计数，保留原有中文标点。前后端共用 promotion-content.js，不使用 UTF-16 长度截断 emoji。只有新提交的专用字段触发该限制，未配置专用标题或介绍的旧活动继续回退 name / description，不迁移或截断历史字段。

专用字段随现有活动数据保存，修改后活动回到草稿，须再次发布。预览、幂等提交、版本冲突、校区授权和审计沿用原有活动流程。推广文字不改变优惠计算、成团人数、报名、收款或退款规则。

背景 URL 拒绝非 HTTPS、账号密码信息、控制字符、本机域名及私网 IP 字面量（包含 URL 规范化后的 IPv4 和 IPv6）。校验不会抓取图片或解析远端 DNS。背景图片只作为经过校验的 img src 显示，颜色仅接受六位十六进制值，不能提交任意 CSS。公开页面对标题、副标题、介绍、地址及课程文本进行 HTML 转义。

## 专属公开链接

活动链接格式为 commerce-store.html?promotionId=<活动编号>&type=group；联报使用 type=joint。本地二维码组件将同一个活动链接编码到二维码中，不向第三方二维码服务发送链接。

公开页面调用 GET /crm-api/v1/public/store?promotionId=...&type=...。服务端仅在活动已发布、发布版本与当前版本一致、未结束、处于有效日期，且适用商品和班级仍有效上架时返回该活动。返回商品/班级按该活动范围筛选；不返回草稿、其他活动、学员名单、买家、负责人或审计数据。未发布、过期、结束、下架或无效链接返回不可用状态，页面不会退回普通报名或展示其他活动。

公开海报展示实际保存的专用内容（以及旧字段回退）、有效日期、优惠、成团人数和本活动二维码。页面提供“保存 / 打印活动海报”，打印样式只输出海报；报名仍遵循整团登记与人工核对收款。

## 验证

- backend/test/promotion-presentation-http.test.cjs：通过隔离 HTTP 操作保存配置、重启服务读回、发布/编辑/停止的公开可见性、活动商品范围、Unicode 上限、背景安全、字段白名单及跨校区授权。
- frontend-tests/promotion-public.test.cjs：专属活动选择与表单绑定、实际本地 QR 编码目标、HTML 转义、失效链接不回落其他活动和旧字段回退。
- 既有商城与整团报名回归保留报价校验、幂等重试、容量、整单收款及退款约束。
