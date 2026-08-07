# DSH 数据平台重构蓝图

## 目标与完成条件

把“每日重新生成综合快照并部署页面”改成“页面代码独立部署、数据独立更新”。完成后：

- 群聊按 `Asia/Shanghai` 自然日归档，本地任务只负责读取、校验、脱敏和上传；
- GitHub 成员名单继续只进入 `ACCESS_DB`；
- GitHub Issue 与 Repo 独立更新，不再跟随群聊日期或页面部署；
- 新人导引使用独立固定内容源，不随群聊日期或 GitHub 数据同步变化；
- `QA_DB` 继续保存完整私有语料并支持实时问答，新增 Repo 检索；
- 展示安全数据进入独立 `CONTENT_DB`，完整群聊正文不进入 Pages 构建产物；
- 所有导入先写新版本、校验计数，再切换 active 指针；失败时保留旧版本。

## 权限与执行路线

组织全部 Repo 都是私有仓库，且无法取得组织 Owner 批准。因此当前采用无 Owner 依赖路线：

- Cloudflare：保存、查询、鉴权、展示和实时 QA；
- 本机已授权 `gh` 会话：读取私有 Issue/Repo 并自动上传；
- 终端用户 GitHub OAuth：只读取公开身份，不申请 `read:org` 或仓库权限；
- 现有 `GITHUB_ORG_READ_TOKEN`：只用于成员白名单，不扩展权限；
- 若以后获得可用的细粒度服务器凭据，只替换 GitHub 采集适配器，不改变 D1、API 或页面。

## 持久化边界

| 目标 | 内容 | 禁止内容 |
| --- | --- | --- |
| `ACCESS_DB` | GitHub ID、登录名、active 与同步元数据 | OAuth 临时令牌、邮箱、个人资料、语料 |
| `QA_DB` | 脱敏后的完整群聊、Issue、Repo 检索文档与索引 | 解密配置、媒体密钥、本机路径、凭据 |
| `CONTENT_DB` | 日摘要、精选信号、纪事、群参与者画像、Issue/Repo 展示视图 | 完整群聊正文、访问令牌 |
| `.local/` | 本机运行时中间文件和增量语料 | 不提交、不进入构建产物 |

## 数据契约

### 群聊

- 日期区间：`00:00:00 <= occurred_at < next day 00:00:00`，时区固定 `Asia/Shanghai`；
- 同一天重跑生成新的 `ingest_id`，只在消息 ID、条数、发送者和左右归属校验通过后激活；
- 右侧消息发送者必须全部是“少女阿原”，左侧必须有其他成员署名；
- 完整脱敏消息进入 `QA_DB`，展示摘要进入 `CONTENT_DB`。
- “今日最新”等日视图读取一个明确自然日；成员星卡、信号与纪事从全部 active 自然日聚合，不受页面日期选择器影响。

### GitHub

- Issue 使用私有 `dsh-external/issues` API 的完整列表；
- Repo 使用 `dsh-external` 当前可访问的完整私有仓库列表；
- Repo 的 `created_at` 表示真正新建，`first_seen_at` 只表示系统首次观察；
- Repo 展示不是元数据清单：用途来自 GitHub description，最近变化来自默认分支最新 commit，系统按产品方向分组并生成可追溯的阅读建议；
- Repo 解读不调用 LLM；缺少仓库说明时明确标注信息不足，不根据名称虚构具体能力；
- Issue 与 Repo 共用一次 `github_sync_id`，两类计数均为正并校验后才共同激活。

## 消费者与激活证明

| 消费者 | 激活方式 | 完成证明 | 失败回退 |
| --- | --- | --- | --- |
| 页面群聊视图 | `CONTENT_DB` 当日 active 指针 | API 日期、计数与本地日语料一致 | 保留该日旧 active 版本 |
| 页面群聊全量视图 | 汇总全部群聊 active 指针 | 日期无重复，信号、纪事去重，成员累计值一致 | 不把单日数据伪装成全量 |
| Issue/Repo Board | GitHub active 指针 | API Issue/Repo 数与本机 API 一致 | 两类数据均保持旧版本 |
| 实时 QA | QA group/github 双 active 指针 | 状态计数一致且问答返回带来源结果 | 保留旧检索版本 |
| 成员门禁 | `ACCESS_DB` active 名单 | 匿名被拦截、成员可登录、OAuth 无组织 scope | 保留旧名单 |

## 有界运行

每次运行只允许以下两种工作项：

1. `group-day`：采集并激活一个明确自然日的群聊与群聊 QA；
2. `github-live`：采集并共同激活当前 Issue、Repo 与 GitHub QA。

每次运行记录工作项、日期或 sync ID、输入条数、激活条数、验证结果和失败层级。不得因失败清除历史版本，不得把运行时文件加入 Git。

## 迁移与回退

1. 新增 D1 表和 API，旧静态快照继续服务；
2. 回填历史群聊日视图，导入当前 Issue/Repo 与 QA 索引；
3. 页面切换到新 API，并保留静态快照只读回退；
4. 生产端验证后启用本机计划任务；
5. 若新 API 或数据异常，回滚页面代码或 active 指针；旧静态快照和旧 QA 表不删除。

## 验证门

- `npm run check`、`npm run typecheck`、`npm test`、`npm run build:pages`；
- `dist` 仅一份 HTML，且不存在 `dist/corpus`；
- JSON/JSONL 全部可解析，所有计数为非负整数；
- 隐私扫描不命中本机路径、Token、私钥、微信 XML 或媒体密钥；
- 匿名首页、内容 API、QA 状态和问答 API 均跳转登录；
- 登录 OAuth URL 不包含 `read:org`；
- 登录后内容计数与 D1 active 版本一致，DeepSeek ready。
