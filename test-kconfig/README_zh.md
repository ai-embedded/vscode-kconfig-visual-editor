# test-kconfig 测试用例说明

## 概述
- 提供 VS Code Kconfig 扩展与语言服务的端到端基准，覆盖语法解析、语法高亮与菜单交互。
- 当前包含 16 个主题目录，39+ 测试文件与 195+ 配置符号，既保留基础语法也涵盖复杂与高级关键字。
- 所有用例整理自 RT-Thread、Linux Kernel 等真实项目，确保语法特性具备实际使用场景。

## 目录总览
| 目录 | 主题 | 主要覆盖语法 |
| --- | --- | --- |
| `advanced-keywords/` | 高级关键字 | `imply`、条件 `imply`、`select` 组合，`osource`/`orsource`、通配符 `rsource`，`modules`、`tristate`、`option env/defconfig_list` |
| `basic/` | 基础语法 | 基础 `config` 类型、菜单、choice、help、range |
| `comparison-operators/` | 比较运算 | `= != < > <= >=` 与逻辑组合、范围判断、多变量比较 |
| `complex-conditions/` | 复杂条件组合 | 极端 `depends on`、3 层以上 if 嵌套、menu/choice 条件互锁、真实场景模拟 |
| `complex-nesting/` | 深度嵌套 | 多级 menu/if/choice 层级及作用域滚动 |
| `comprehensive/` | 综合场景 | 系统级菜单、choice、多级 help、依赖编排 |
| `conditional-properties/` | 条件属性 | 条件 `prompt`、`default`、`select`、`range`、`visible if`、括号/否定/紧凑写法 |
| `config/` | 基础配置 | 布尔、数值配置与默认值控制 |
| `depends_on/` | 依赖控制 | 单条件、多条件 `depends on` 显隐逻辑 |
| `if/` | if 块 | 多层 `if`/`endif`、块内依赖同步 |
| `logical-operators/` | 逻辑运算 | 否定 `!`、链式 `&&`/`||`、括号优先级、混合表达式、多个 `depends on` |
| `menu/` | 菜单结构 | 顶层/内嵌菜单、`visible if`、条件化条目 |
| `menuconfig/` | menuconfig | 顶级 `menuconfig`、子菜单、依赖联动 |
| `select/` | select 链 | `select`、条件 `select`、连锁启用与循环避免 |
| `simple-if/` | 简单 if | 最小 if 块、基础条件显隐 |
| `source/` | include 关键字 | `source`/`rsource`/`osource`/`orsource`、glob 模式、嵌套引用、缺失文件容错 |

## 已覆盖语法特性
- **逻辑运算符**：`!`、`&&`、`||`、括号优先级、否定组合、混合运算。
- **比较运算符**：`= != < > <= >=`，范围条件、逻辑组合。
- **控制结构**：`if`/`endif`、多层嵌套、条件化菜单与 choice。
- **依赖声明**：`depends on` 多条件组合、条件 `select`、`imply`（含条件）、`visible if`。
- **数据类型**：`bool`、`tristate`、`int`、`hex`、`string`，含模块态与条件默认值。
- **include 语法**：`source`、`rsource`、`osource`、`orsource`、通配符、相对路径与可选文件。
- **高级关键字**：`modules`、`option env`、`option defconfig_list`、环境变量引用与警告处理。
- **实战场景**：网络/存储/驱动等模拟案例，覆盖系统级条件组合与 UI 交互测试。

## 目录聚焦
### 逻辑与条件组合
- **logical-operators/**：否定、链式 AND/OR、括号优先级，约 30+ 配置项，验证解析器短路与组合解析。
- **depends_on/**、**if/**：拆解条件与嵌套作用域，确保语法树与菜单显隐一致。

### 条件属性
- **conditional-properties/**：条件 `prompt`/`default`/`select`/`range`/`visible if`，覆盖否定、括号与紧凑写法（如 `if SYMBOL1&&SYMBOL2`）。
- **menu/**、**menuconfig/**：`visible if` 与块级条件结合，测试 UI 条件渲染。

### 数值判断
- **comparison-operators/**：比较运算符与逻辑条件组合，模拟性能阈值、资源限制场景。

### 复杂结构
- **complex-conditions/**：高度复杂 `depends on`、menu 与 choice 的联动、if 深层嵌套（40+ 配置项）。
- **complex-nesting/**、**comprehensive/**：多级菜单、系统配置全景案例，可用于可视化菜单回归。

### 高级关键字
- **advanced-keywords/**：`imply`、`modules`、`option env/defconfig_list`、环境变量警告、`rsource "modules/*/Kconfig"` 通配符；附带 `test.sh` 脚本便于批量验证。
- **source/**：系统化验证 include 语法族、可选文件、嵌套链、glob 匹配与容错。

### 基础回归
- **basic/**、**config/**、**select/**、**simple-if/**：维持最小可复现样例，用于解析器/高亮/菜单交互的基础回归。

## 测试统计
- **测试目录**：16 个（含新增 `logical-operators/`、`conditional-properties/`、`comparison-operators/`、`complex-conditions/`、`advanced-keywords/`）。
- **测试文件**：39+（主 `Kconfig`、子 include、脚本与 README）。
- **配置符号**：195+，覆盖常见数据类型与模块状态。
- **来源项目**：RT-Thread drivers/libc/vdso 模块、Linux Kernel 官方 Kconfig 规范。

## 使用建议
- **VS Code**：打开任意测试目录的 `Kconfig` 验证语法高亮、悬浮信息；右键 “Open Menuconfig” 检查条件显隐。
- **命令行解析**：
  - `python3 -c "import kconfiglib; k = kconfiglib.Kconfig('test-kconfig/logical-operators/Kconfig')"`
  - `make menuconfig KCONFIG_CONFIG=test-kconfig/logical-operators/Kconfig`
- **专项脚本**：`advanced-keywords/test.sh` 快速验证 `rsource` 通配符与模块化配置。

## 后续补充建议
- 增补字符串操作、正则匹配、环境变量运算等高级语法。
- 引入驱动、文件系统、嵌入式特定场景，提升覆盖广度。
- 添加负向用例，如语法错误、循环依赖、类型冲突。
- 计划面向大型配置树进行性能与内存评估。

## 参考资料
- [Linux Kernel Kconfig Language](https://www.kernel.org/doc/html/latest/kbuild/kconfig-language.html)
- [Kconfiglib Documentation](https://github.com/ulfalizer/Kconfiglib)
- [RT-Thread 项目 Kconfig 实例](https://github.com/RT-Thread/rt-thread)

