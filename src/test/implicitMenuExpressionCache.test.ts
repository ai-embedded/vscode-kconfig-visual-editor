import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";

import { KconfigParser } from "../menuconfig/KconfigParser";

export async function runImplicitMenuExpressionCacheTests(): Promise<void> {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kconfig-expr-cache-"));
    const kconfigPath = path.join(tempDir, "Kconfig");

    fs.writeFileSync(
        kconfigPath,
        [
            'mainmenu "Expression Cache Test"',
            "",
            "config PARENT",
            '    bool "Parent"',
            "",
            "config CHILD_1",
            '    bool "Child 1"',
            "    depends on PARENT && OTHER_SYMBOL",
            "",
            "config CHILD_2",
            '    bool "Child 2"',
            "    depends on PARENT && OTHER_SYMBOL",
            "",
            "config CHILD_3",
            '    bool "Child 3"',
            "    depends on PARENT && OTHER_SYMBOL",
            "",
        ].join("\n"),
        "utf8"
    );

    try {
        const parser = new KconfigParser({
            workspaceFolder: tempDir,
            mainKconfigFile: kconfigPath,
        });

        const expressionParser = (parser as any).exprParser;
        const originalParse = expressionParser.parse.bind(expressionParser);
        let parseCalls = 0;

        expressionParser.parse = (expression: string) => {
            parseCalls += 1;
            return originalParse(expression);
        };

        await parser.parse();

        assert.strictEqual(
            parseCalls,
            1,
            `expected repeated dependency expression to be parsed once, got ${parseCalls}`
        );
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}
