# Notion 官方产品截图与功能研究

研究日期：2026-09-16 至 2026-09-17。用途：重做 ChatObsidian 的本地数据库工作台。参考的是官方帮助中心和 **Notion 本人发布**的模板截图，而非营销首页、第三方教程或社区 UI 猜测。

## 实际查看的应用内部截图

通过浏览器打开官方来源，确认图片出处，再渲染图片并逐张视觉检查。中间参考图保存在被 Git 忽略的 `.design-reference/notion/` 中，不作为应用资源分发。以下原图地址来自相应官方网页。

| 官方来源与截图 | 原图 | 观察与落地 |
| --- | --- | --- |
| [Reading List，作者 Notion](https://www.notion.com/templates/notion-reading-list) | [画廊截图](https://s3.us-west-2.amazonaws.com/public.notion-static.com/template/8885c58f-db2f-4a2c-892c-4838ee4636fa/desktop.png) | 书架画廊采用规则网格、较小圆角、图像在上、名称与属性在下。采用细边框、小圆角、自定义封面、完整显示图片选项和属性色块。 |
| [Book Tracker，作者 Notion](https://www.notion.com/templates/book-tracker-notion) | [看板截图](https://s3.us-west-2.amazonaws.com/public.notion-static.com/template/cfa01025-9e0b-4bcb-a155-160e6d406e74/1711143413208/desktop.jpg) | 状态列标题带颜色与计数，卡片正文紧凑，空列也有明确位置。采用三列状态、列计数、拖动变更状态；长列独立滚动。 |
| [Workspace & sidebar](https://www.notion.com/help/intro-to-workspaces) | [侧栏控制区](https://images.ctfassets.net/spoqsaf9291f/6gTWDfDrPkloy5Du3RMvSW/d8e9dc38f6c63e0b83e9cd6dd10701d9/Group_64.png) | 侧栏用浅灰表面与紧凑行，选中项只做浅色高亮；正文和侧栏有清晰分工。采用工作空间/整理分区，移除装饰性宣传卡片。 |
| [Views, filters, sorts & groups](https://www.notion.com/help/views-filters-and-sorts) | [Engineering tasks 布局菜单](https://images.ctfassets.net/spoqsaf9291f/nfJxbTGWexijW7BSAEPZL/a39afeb87300553e7fb97fc7006d320d/layouts.png) | 视图标签在左、筛选排序搜索在右，活动标签细下划线，主要新建按钮为蓝色。采用同样的层级与操作位置，使用适合中文的字号。 |
| [Customize database layouts](https://www.notion.com/help/layouts) | [GreenWave 页面布局](https://images.ctfassets.net/spoqsaf9291f/10w87P4FowzSYNRaR1vEUc/efdcca6ce616e712407d0bdc229f980c/Help_Center_Layouts_Screenshot_Oct_16.png) | 页图标、大标题与属性组构成清晰阅读顺序。详情页采用“封面 → 图标/标题 → 属性 → 正文”，隐藏开发实现术语。 |
| [Design team wiki](https://www.notion.com/help/guides/how-to-build-a-wiki-for-your-design-team) | [Design 页面](https://images.ctfassets.net/spoqsaf9291f/3CjvAad40SI7tfBc13LF05/ed725a0b4e66b9505e50d168f279fa07/Design_wiki.png) | 内容区有留白，图标是页面识别点，分区依赖标题和细线。采用页面式标题、克制的分隔，不使用仪表盘大面积着色面板。 |
| [Database-powered team wiki](https://www.notion.com/help/guides/build-a-docs-first-culture-with-a-beautiful-team-wiki-powered-by-a-database) | [Company wiki 表格](https://images.ctfassets.net/spoqsaf9291f/4BLeUH9biAdPkl9km4X8K3/3b53899a25c8f008c5f426935054579b/Screenshot_2023-03-30_at_9.04.13_AM.png) | 表头轻、行分隔细、标题是入口、属性直接占列。采用表格标题打开详情与自定义属性列。 |

截图可能展示不同时间的 Notion 版本，不能据此声称像素级复刻当前全部产品。这里提取共同的布局语言；蓝色只用于主要操作，状态色参考灰/蓝/绿。原创黑白书页 C 图标与原创线稿封面不使用 Notion 的 N 标识。

## 功能模型与实现映射

| 官方资料 | 可验证的产品机制 | 本项目实现 |
| --- | --- | --- |
| [Intro to databases](https://www.notion.com/help/intro-to-databases) | 数据库条目可作为页面打开、拥有属性 | SQLite 的 collection + item；独立页面有正文，仓库页面链接已登记的 vault ID |
| [Gallery view](https://www.notion.com/help/galleries) | 卡片可切换预览方式、大小和可见属性，图片可以完整显示 | 封面/内容/无预览，三种卡片大小，可见属性设置；上传本地栅格封面并持久化 |
| [Views, filters, sorts & groups](https://www.notion.com/help/views-filters-and-sorts) | 同一份数据可有不同视图，设置按视图保存 | 默认三视图，可增加命名视图；搜索、状态/标签筛选、排序与展示参数独立保存 |
| [Database properties](https://www.notion.com/help/database-properties) | 属性具备具体类型，参与组织和检索 | 文本、数字、单选、日期、复选框、URL；Rust 进行类型、选项、长度与 URL scheme 校验 |
| [Board view](https://www.notion.com/help/boards) | 按属性分组，拖动卡片调整所处分组 | 按待开始/进行中/已完成分列，拖动更新状态，同步反映到画廊和表格 |
| [Working with databases](https://developers.notion.com/guides/data-apis/working-with-databases)、[Data source](https://developers.notion.com/reference/data-source) | 官方公开 API 区分数据库容器、数据来源/属性结构和页面 | 借鉴 schema 与记录分离；不接入 Notion API，不需要登录或 token |

上述 API 资料只用于理解公开数据模型，不能作为 Notion 内部数据库、框架或存储实现的证据。ChatObsidian 的 SQLite、Rust、React 方案是本工程的本地实现选择。

## 本次取舍

- 保留 Obsidian 仓库与笔记的现有所有权。独立页面内容仅写入应用数据库，没有把“编辑卡片”变成对仓库文件的隐式覆盖。
- 原工具箱、同步中心和模板覆盖与日常知识整理无直接关系，且扩大了文件/进程写入范围，连同后端执行接口一起删除；旧文件和备份不删除。
- 单量/增量跨桌面仍是本项目自己的 Windows 能力，不是 Notion 功能。按 [Obsidian 官方 URI](https://obsidian.md/help/uri) 使用登记 ID，核验实时路径，笔记路径需要存在且不越界；不使用 URI 创建、追加、覆盖命令。
- 首版支持六种属性、平级数据库与纯文本正文。暂不实现公式、关系/汇总、块编辑器、协作、远程同步、视图删除和永久删除。JSON 导出面向可读归档，本版没有导入入口。
- 上传封面由文件选择器明确授权，缩小后写入应用数据库；不保存源文件路径、不扫描相邻文件、不请求远程图片。每张封面编码后最多 512 KiB，服务端验证格式和尺寸，总工作台最多 16 MiB。

## 风险检查与防护

| 检查项 | 改动与验证方法 |
| --- | --- |
| 标题伪装成 Obsidian | 通过 Windows API 查询窗口所属进程映像，发送 WM_CLOSE 前再次核验 |
| 同名仓库或含相同后缀的名称 | 有歧义时拒绝管理窗口，使用登记 ID 发送 URI |
| 主窗口与快速弹窗并发打开 | Rust 原子互斥，重复操作返回明确错误 |
| 跨桌面识别或关闭失败 | 无法识别即退出；关闭超时不继续 URI，不保留强制结束后门 |
| 笔记相对路径逃逸 | 规范化验证、禁止父级/绝对路径/ADS、只允许已存在 Markdown；符号链接不能绕过根目录 |
| 数据库升级或编辑失败 | 旧库先做一致性快照；事务、外键、revision 校验；拒绝删除遗漏项或改变已有关联 |
| 设置替换中断或 JSON 损坏 | 原子替换文件；损坏原件保留；保存队列串行 |
| UI 看起来保存但实际失败 | 保存成功后才更新提交态；错误保留编辑草稿，并通过可见提示报告 |
| 扫描/索引阻塞 UI | 后台任务执行；首屏先渲染既有目录；快速弹窗轮询单飞并在隐藏后暂停 |

实际旧目录库的只读快照迁移测试：47 个仓库、191 条操作记录完整保留，生成 46 个非模板仓库页面，SQLite 完整性检查通过。测试只修改临时副本。

浏览器自动化覆盖主要 UI 流程；Rust 测试覆盖类型/图片校验、事务、冲突、迁移和路径策略。真实跨虚拟桌面关闭/重开与用户 Obsidian 插件的配合未进行破坏性自动试验，不承诺未经验证的“零风险”。
