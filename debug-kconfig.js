const { KconfigParser } = require('./out/menuconfig/KconfigParser');
const path = require('path');

async function debugKconfig() {
    const parser = await KconfigParser.create({
        workspaceFolder: __dirname,
        mainKconfigFile: path.join(__dirname, 'test-kconfig/if/Kconfig')
    });

    const menus = await parser.parse();

    // 查找 FINAL_CONFIG
    function findConfig(items, name) {
        for (const item of items) {
            if (item.name === name) {
                return item;
            }
            if (item.children && item.children.length > 0) {
                const found = findConfig(item.children, name);
                if (found) return found;
            }
        }
        return null;
    }

    const finalConfig = findConfig(menus, 'FINAL_CONFIG');

    if (finalConfig) {
        console.log('\n========== FINAL_CONFIG 数据 ==========');
        console.log('name:', finalConfig.name);
        console.log('title:', finalConfig.title);
        console.log('type:', finalConfig.type);
        console.log('isMenuconfig:', finalConfig.isMenuconfig);
        console.log('isVisible:', finalConfig.isVisible);
        console.log('hasPrompt:', finalConfig.hasPrompt);
        console.log('value:', finalConfig.value);
        console.log('dependsOn:', finalConfig.dependsOn);
        console.log('id:', finalConfig.id);
        console.log('indentLevel:', finalConfig.indentLevel);
        console.log('========================================\n');
    } else {
        console.log('\nFINAL_CONFIG 未找到！\n');
    }

    // 输出所有menu类型的项
    console.log('\n========== 所有 menu 类型的项 ==========');
    function listMenus(items, prefix = '') {
        for (const item of items) {
            if (item.type === 'menu') {
                console.log(`${prefix}${item.title || item.name} (type: ${item.type}, isMenuconfig: ${item.isMenuconfig})`);
            }
            if (item.children && item.children.length > 0) {
                listMenus(item.children, prefix + '  ');
            }
        }
    }
    listMenus(menus);
    console.log('========================================\n');
}

debugKconfig().catch(console.error);
