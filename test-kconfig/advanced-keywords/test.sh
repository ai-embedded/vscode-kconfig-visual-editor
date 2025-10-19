#!/bin/bash
# Kconfig 高级关键字测试脚本

echo "=================================================="
echo "Kconfig 高级关键字测试"
echo "=================================================="
echo ""

# 设置路径
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 使用 Python 脚本验证 Kconfig
python3 -c "
import sys
sys.path.insert(0, '../../third_party/Kconfiglib')
from kconfiglib import Kconfig

try:
    print('正在解析 Kconfig 文件...')
    kconf = Kconfig('Kconfig', warn_to_stderr=False)

    print('✓ Kconfig 文件解析成功！')
    print()
    print(f'统计信息:')
    print(f'  - 配置符号总数: {len(kconf.defined_syms)}')

    # 统计各类符号
    all_symbols = [sym.name for sym in kconf.defined_syms if sym.name]

    module_count = len([s for s in all_symbols if 'MODULE' in s])
    rsource_count = len([s for s in all_symbols if 'RSOURCE' in s])
    imply_count = len([s for s in all_symbols if any(x in s for x in ['IMPLY', 'DEPENDENCY', 'DRIVER_FRAMEWORK', 'USB_HOST', 'PLATFORM_DRIVER'])])

    print(f'  - 模块相关符号: {module_count}')
    print(f'  - rsource 引入符号: {rsource_count}')
    print(f'  - imply 相关符号: {imply_count}')
    print()

    # 验证关键功能
    print('关键功能验证:')

    # 检查 modules
    if 'MODULE_A_ENABLE' in all_symbols:
        print('  ✓ modules/*/Kconfig 通配符加载成功')
    else:
        print('  ✗ modules 加载失败')
        sys.exit(1)

    # 检查 rsource
    if 'RSOURCE_TEST_1' in all_symbols:
        print('  ✓ rsource 相对路径引用成功')
    else:
        print('  ✗ rsource 引用失败')
        sys.exit(1)

    # 检查 imply
    if 'ENABLE_DRIVER_FRAMEWORK' in all_symbols:
        print('  ✓ imply 关键字解析成功')
    else:
        print('  ✗ imply 关键字解析失败')
        sys.exit(1)

    # 检查 tristate
    if 'DYNAMIC_MODULE' in all_symbols:
        print('  ✓ tristate 类型解析成功')
    else:
        print('  ✗ tristate 类型解析失败')
        sys.exit(1)

    print()
    print('================================================')
    print('所有测试通过！✓')
    print('================================================')

except Exception as e:
    print(f'✗ 错误: {e}')
    import traceback
    traceback.print_exc()
    sys.exit(1)
"

exit $?
