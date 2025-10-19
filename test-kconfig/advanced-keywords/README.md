# Kconfig 高级关键字测试用例

本目录包含 Kconfig 高级特性的完整测试用例。

## 目录结构

```
advanced-keywords/
├── Kconfig                        # 主配置文件
├── advanced-keywords-sub.kconfig  # osource 引用的配置文件
├── test.sh                        # 自动化测试脚本
├── modules/                       # 模块目录（用于测试 rsource 通配符）
│   ├── module-a/
│   │   └── Kconfig               # 模块 A 配置
│   ├── module-b/
│   │   └── Kconfig               # 模块 B 配置
│   └── module-c/
│       └── Kconfig               # 模块 C 配置
└── sub/
    └── relative-config.kconfig    # rsource 引用的配置文件
```

## 测试的高级特性

### 1. imply 关键字
- 弱依赖：建议启用但不强制
- 与 select 对比：select 是强制依赖
- 条件 imply：根据不同条件建议不同选项
- 位置：测试 1、2、3、9、11

### 2. osource（可选 source）
- 文件可选，不存在也不报错
- 支持环境变量路径
- 位置：测试 4

### 3. rsource 和 orsource
- rsource：相对路径 source
- orsource：可选的相对路径 source
- **通配符支持**：`rsource "modules/*/Kconfig"`
- 位置：测试 5

### 4. modules 关键字
- tristate 类型：n/m/y 三种状态
- 模块加载/卸载支持
- 位置：测试 6

### 5. option 关键字
- defconfig_list：默认配置文件列表
- allnoconfig_y：allnoconfig 时仍然启用
- env：环境变量绑定
- 位置：测试 7、8

### 6. tristate 高级用法
- 条件默认值：`default m if MODULES_SUPPORT`
- 依赖限制：模块状态受依赖项影响
- 位置：测试 10

### 7. 复杂表达式
- 复杂的条件 imply
- 逻辑运算符组合
- 位置：测试 11

### 8. 真实场景
- 文件系统配置示例
- select 和 imply 组合使用
- 位置：测试 12

## 运行测试

### 方法 1：使用测试脚本（推荐）
```bash
./test.sh
```

### 方法 2：使用 Python 手动验证
```bash
python3 -c "
import sys
sys.path.insert(0, '../../third_party/Kconfiglib')
from kconfiglib import Kconfig
kconf = Kconfig('Kconfig')
print(f'✓ 解析成功，找到 {len(kconf.defined_syms)} 个配置符号')
"
```

### 方法 3：使用 menuconfig（需要交互式终端）
```bash
python3 ../../third_party/Kconfiglib/menuconfig.py Kconfig
```

## 关键符号统计

- **总配置符号数**：55
- **模块相关符号**：19 个
  - MODULE_A_*, MODULE_B_*, MODULE_C_* 等
- **rsource 引入符号**：3 个
  - RSOURCE_TEST_1, RSOURCE_TEST_2, RSOURCE_MENU_ITEM
- **imply 相关符号**：6 个
  - ENABLE_DRIVER_FRAMEWORK, WEAK_DEPENDENCY 等

## 修复的问题

原问题：运行 `menuconfig.py` 时报错：
```
'modules/*/Kconfig' not found (in 'rsource "modules/*/Kconfig"')
```

解决方案：
1. 创建 `modules/` 目录
2. 在其下创建 `module-a/`, `module-b/`, `module-c/` 子目录
3. 在每个子目录中创建 `Kconfig` 文件
4. 确保 `sub/relative-config.kconfig` 文件存在

## 注意事项

1. **环境变量警告**：测试 8 中的环境变量相关配置会产生警告，这是正常的（用于测试环境变量功能）。

2. **通配符匹配**：`rsource "modules/*/Kconfig"` 会匹配 modules 目录下所有子目录中的 Kconfig 文件。

3. **imply vs select**：
   - `select`：强制启用，用户无法禁用
   - `imply`：建议启用，用户可以禁用

4. **tristate 状态**：
   - `n`：不编译
   - `m`：编译为可加载模块
   - `y`：编译进内核/程序

## 参考资源

- [Kconfig 语言规范](https://www.kernel.org/doc/html/latest/kbuild/kconfig-language.html)
- [Kconfiglib 文档](https://github.com/ulfalizer/Kconfiglib)
