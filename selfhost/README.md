# YorkeAI 自托管部署

这个目录包含 2026-11-20 的正式站运行代码和已经构建好的前端及 Worker。运行时用 Node.js 22.13 以上的 22.x 版本、Miniflare 和本地 SQLite/D1。新服务器可直接使用 `dist/`，无需重新构建仓库根目录的 Sites 应用。

## 公开注册与交易

访客从 `/__host/register` 通过邮箱验证码注册，注册用户和合伙人登录后进入同一个资源工作台。注册用户可查看自己的购买、续费、地址订单和交付记录。库存与驾驶证和签证模板向所有已登录账号开放，业务分组用于内部资源整理。请先授权发件邮箱，让正式域名的注册页能发出验证码。账号可从登录页使用邮箱验证码找回密码。合伙人在工作台按管理员整理的业务分组浏览。

超级管理员可在 `/__host/accounts` 的「合伙人与额度」创建合伙人账号并按账号加款，备注显示在余额流水中。普通客户在「我的钱包」充值，合伙人使用管理员分配的余额。购买和续费使用当前登录账号确认，后台核对报价和可用余额。可用余额按 1 U 抵 1 USD 计算。eSIM 套餐与续费的零售价为供应商原价的两倍，超级管理员按原价由 eSIMAccess 余额支付。已定价库存的零售价为采购价的两倍，超级管理员按采购价使用站内余额。地址生成标准价为 10 U，失败订单进入退款审核，由管理员确认退款。驾驶证和签证模板可免费预览，原文件每次下载标准价为 5 U，同一笔下载中断后 30 分钟内可继续。超级管理员可在「合伙人与额度」为合伙人或普通用户开通代理折扣，按对应商品的零售价计算。未定价库存可免费认领。

启用收款时，将本机专用的 `config/usdt.json` 放到受限配置目录。每笔充值本金至少 5 U，可自定义到两位小数。同一网络可同时有多笔待支付订单，每笔使用独立应付金额。用户按页面显示的 USDT 金额付款，钱包只增加该单本金。三条主网配置、确认规则、异常入账及故障恢复见 [收款设置](commerce/USDT.md)。

资源市场展示 eSIM 流量、手机号码和邮箱等分类；没有入库记录的分类标为待接入。默认按收藏优先排序。所有登录账号可通过邮件发送自己购买的 eSIM 附件。网站首次访问默认使用英文，页面右下角可切换简体中文，偏好保存在当前浏览器。

## Windows 新装

1. 安装 Node.js 22 LTS。下载本仓库或克隆到准备长期运行的目录。
2. 在 PowerShell 进入 `selfhost`，执行下面两条命令。首次安装会提示输入新管理员密码，初始化独立数据库与本地 TLS 证书。

```powershell
.\deploy\install-windows.ps1 -Origin 'https://resources.example.com' -AdminEmail 'admin@example.com'
.\deploy\start-windows.ps1
```

3. 把域名的 A 记录指向新服务器。参考 `deploy/Caddyfile.example` 配置 Caddy，让公网 HTTPS 指向本机 `127.0.0.1:8443`。如果修改了安装端口，也调整代理的端口。已使用 IIS 或其他反向代理时，可在现有代理中添加该域名。
4. 打开 `https://你的域名/__host/health`，确认返回 `ok: true`，然后进入首页用刚创建的管理员账号登录。生产环境可将 `deploy/start-windows.ps1` 和反向代理以各自的低权限服务账号运行，并赋予该站点的 `config/`、`data/` 和所需归档目录的访问权限。

## 迁移旧站

换服务器并保留历史时，跳过首次初始化。先运行 `npm ci --omit=dev`，再通过私有备份还原旧站状态。从旧实例取得一致的备份，停写后再切换，避免两个实例对同一批任务分别执行。

| 私有备份内容 | 用途 |
| --- | --- |
| `config/runtime.json` | 站点域名、供应商及服务绑定、加密密钥。调整新机上的 `origin`、`aliasOrigins`、`port` 和本地路径，保留原 `SETTINGS_ENCRYPTION_KEY` 以便解密旧配置。 |
| `config/usdt.json` 与 `data/commerce.sqlite` | 三链收款地址、链上扫描位置、充值金额关联、余额流水和订单预留。迁机时和 D1 一起停写备份，确保 WAL 侧文件完整。 |
| `config/accounts.json` 与 `data/site-sessions.sqlite` | 管理员、合伙人、公开注册用户及登录会话。恢复后，旧域名的会话取决于浏览器现有 Cookie 与原会话状态。 |
| `data/d1/` 与其 SQLite 侧文件 | 分组、额度、资源归属、购买、续费、通知设置与业务记录。 |
| 其他 `data/` 中的状态文件 | Outlook OAuth 授权、邮件记录及去重状态。 |
| `private-template-archive/` | 已授权模板原文件、归档目录与预览文件。私下复制到新机同一相对位置。 |
| 本机 TLS、反向代理配置与外部任务队列 | 为新域名准备 TLS 并逐一核对。原队列有待处理订单时，先在旧环境确认状态。 |

健康检查通过后，再切换域名至新实例。迁移完成后可从「我的购买」检查历史和续费记录，从账户后台检查权限与额度。

## 配置外部服务

以 `deploy/runtime.example.json` 为结构参考。修改实际文件 `config/runtime.json` 时保留安装脚本生成的加密密钥，修改后重启站点。

- **eSIMAccess** 在 `bindings.ESIM_ACCESS_CODE` 与 `bindings.ESIM_SECRET_KEY` 填入你的 API 凭据。超级管理员可在「合伙人与额度」为账号添加余额。购买和续费在供应商成本、本站零售价及用户可用余额核对通过后提交。
- **Outlook** 配置 `outlook.mailbox` 和支持个人 Microsoft 账号、允许公共客户端设备流的 `outlook.clientId`。运行 `node authorize-site-outlook.mjs start`，在 Microsoft 页面完成授权，再运行 `node authorize-site-outlook.mjs poll`。确认授权邮箱后重启服务。迁移过旧授权文件的实例可沿用其中的邮箱和 client ID。验证发件状态后再发送实际附件。
- **Telegram** 以管理员身份在站点内配置机器人、接收方并发送测试消息。恢复旧数据库的实例可沿用已保存的设置和原加密密钥。
- **地址翻译** 可选设置 `bindings.OPENAI_API_KEY` 和 `bindings.ADDRESS_TRANSLATION_MODEL`。
- **地址订单** 站内表单、通知、状态、队列投递和回调已包含。若曾运行独立的订单处理程序，请私下迁移并配置它。按需填写 `siteOrderQueueDirectory`，并通过共享的 `bindings.ADDRESS_ORDER_CALLBACK_TOKEN` 验证回调。上线前分别验证独立程序的生成、付款及邮件交付路径。
- **驾驶证与签证模板归档** 登录后的模板库和权限在站点代码里。归档索引、预览和已授权原文件从私有备份恢复，归档上传管理员默认是 `RESOURCE_ADMIN_EMAILS` 的首个账号，可通过 `archiveOwnerEmail` 指定。

## 验证与维护

`npm test` 运行真实下单与续费接口的模拟供应商测试。`npm run smoke` 使用 OpenSSL、Node 和本机临时 HTTPS 端口启动一份干净实例，检查登录、数据库、分组、订单、续费、模板目录和邮件状态。

`dist/` 是此次正式站部署对应的前端与 Worker 构建。宿主 API、账号和数据集成位于当前目录的 `*.mjs` 与 `resource-operations/`，模板库扩展位于 `template-library-ui/`。仓库根目录保留相应 Sites 应用源码供开发，Windows 部署使用本目录。`release-manifest.json` 提供本次运行文件的 SHA-256 清单。
