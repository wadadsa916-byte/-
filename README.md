# magpie-lmfp

magpie 的「模型指纹」页面插件。不改 magpie 本体，装成本地文件夹即可。

检测用 [lm-detector](https://github.com/Ikaleio/lm-detector)（MIT）的算法与参考库，已随仓库放在 `vendor/lmfpd`，不需要联网安装。结果是**参考库内的封闭集合排序**，不是模型身份证明；每次检测都会向所选模型发真实请求，消耗你自己的额度。

## 安装

把仓库放到任意目录，在 magpie 的「插件」页把安装路径填成这个目录（例如 `~/magpie-lmfp`），侧栏「插件」分组会出现「模型指纹」。

装好后让本机助手常驻，它负责真正发请求、并把进度写回页面：

```sh
cd ~/magpie-lmfp && node watch.mjs
```

助手启动时会自己做三件事，不需要改代码：

1. 从 magpie 的 `~/.config/magpie/providers.json` 生成本机的模型清单（仓库里不带任何人的模型列表）。
2. 通过 magpie 的插件接口找到本插件自己的安装标识，不依赖固定路径。
3. 补齐运行时文件（进度、结果、历史），这些文件不进仓库。

请求一律发给**本机** magpie 网关（`127.0.0.1:3425`），用的是你本机 magpie 里各供应商已保存的 key。

需要 Node.js 22+ 和 `curl`（macOS 自带）。端口或路径不同时可以用环境变量覆盖：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `MAGPIE_PORT` | `3425` | magpie 网关端口 |
| `MAGPIE_WEB_PORT` | `3430` | magpie 网页面板端口 |
| `MAGPIE_WEB_LOG` | `~/Library/Logs/magpie-web.log` | 取登录链接的日志 |
| `MAGPIE_PROVIDERS` | `~/.config/magpie/providers.json` | 供应商配置 |
| `MAGPIE_SPEC` | 自动发现 | 插件安装标识 |
| `MAGPIE_BASE` | `http://127.0.0.1:3425/v1` | 网关地址 |
| `MAGPIE_KEY` | `magpie` | 网关请求头里的 key（本地网关不校验） |

## 使用

页面上有三个标签：

- **检测**：选模型 → 点「开始取样」。三张样本卡会显示本次真正发出去的题目，取完后给出排名和归因概率。
- **手动**：把模型对题目的回复粘进回复框，点「验证」，走离线校验，不发请求。
- **样本库**：本插件跑过的检测记录（时间 / 模型 / 项目 / 结果 / 方式），可搜索、筛选、排序。
- **文档**：lm-detector 的说明。

请求经 magpie 网关发出，使用所选自定义供应商在 magpie 里已保存的 key，插件页面不保存任何 key。

## 文件

| 路径 | 作用 |
| --- | --- |
| `page/` | 插件页面（检测 / 样本库 / 文档） |
| `ui/` | 供应商详情页里的同名页面 |
| `watch.mjs` | 本机助手：轮询页面写入的任务，调用 `run.mjs`，把进度写回页面 |
| `run.mjs` | 单次检测：指纹走 `vendor/lmfpd`，糖果题/画鹈鹕走网关 |
| `sync.mjs` | 从 magpie 的 `providers.json` 同步模型列表 |
| `challenges.js` | 出题逻辑，取自 lmfpd，保证页面显示的题就是实际发的题 |
| `vendor/lmfpd` | lmfpd 发布包（含参考库、检测器、依赖），未改动 |

## 说明

- 检测请求走 `http://127.0.0.1:3425/v1`（magpie 网关）。
- 页面不能直接联网（magpie 插件页 CSP 限制），所以所有请求都由本机助手发起，页面只通过插件选项接收进度。
- `vendor/lmfpd` 为上游原样拷贝，遵循其 MIT 许可。
