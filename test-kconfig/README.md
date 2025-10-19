# test-kconfig Test Suite Overview

## Overview
- End-to-end fixtures for the VS Code Kconfig extension and language services, spanning parsing, highlighting, and menu interactions.
- Ships 16 themed directories, 39+ test files, and over 195 configuration symbols, covering fundamentals through advanced keywords.
- Scenarios are curated from RT-Thread and the Linux kernel to keep every syntax feature grounded in real-world usage.

## Directory Map
| Directory | Theme | Covered Grammar |
| --- | --- | --- |
| `advanced-keywords/` | Advanced keywords | `imply` (with conditional variants), `select` pairing, optional `osource`/`orsource`, wildcard `rsource`, `modules`, `tristate`, `option env/defconfig_list` |
| `basic/` | Fundamentals | Core `config` types, menus, choices, help blocks, ranges |
| `comparison-operators/` | Comparison operators | `= != < > <= >=` with logic chains, range checks, multi-symbol comparisons |
| `complex-conditions/` | Complex conditionals | Extreme `depends on`, 3+ level `if` nesting, menu/choice locking, production-style scenarios |
| `complex-nesting/` | Deep nesting | Multi-level menu/if/choice hierarchies and scope interactions |
| `comprehensive/` | Comprehensive scenario | System-level menus, choices, layered help, dependency orchestration |
| `conditional-properties/` | Conditional properties | Conditional `prompt`, `default`, `select`, `range`, `visible if`, with parentheses/negation/compact forms |
| `config/` | Simple configs | Boolean/numeric options and default handling |
| `depends_on/` | Dependency control | Single and multi-clause `depends on` visibility rules |
| `if/` | `if` blocks | Layered `if`/`endif` scopes and synchronized dependencies |
| `logical-operators/` | Logical operators | Negation, chained `&&`/`||`, precedence via parentheses, compound `depends on` clauses |
| `menu/` | Menu layout | Top-level and nested menus, `visible if`, conditional entries |
| `menuconfig/` | `menuconfig` | Root `menuconfig`, subordinate menus, dependency interplay |
| `select/` | Select chains | Straight and conditional `select`, chained enablement and loop avoidance |
| `simple-if/` | Simple `if` | Minimal `if` blocks for conditional visibility regression |
| `source/` | Include keywords | `source`/`rsource`/`osource`/`orsource`, glob patterns, nested includes, missing-file tolerance |

## Covered Grammar Summary
- **Logical operators**: `!`, `&&`, `||`, precedence control with parentheses, negation combos, mixed expressions.
- **Comparison operators**: `= != < > <= >=`, range bounds, logic combinations.
- **Control structures**: `if`/`endif`, deep nesting, conditional menus and choices.
- **Dependency directives**: Multi-clause `depends on`, conditional `select`, `imply` (including guarded forms), `visible if`.
- **Data types**: `bool`, `tristate`, `int`, `hex`, `string`, module states, conditional defaults.
- **Include family**: `source`, `rsource`, `osource`, `orsource`, wildcards, relative paths, optional files.
- **Advanced keywords**: `modules`, `option env`, `option defconfig_list`, environment variable references and warning handling.
- **Realistic scenarios**: Networking, storage, driver-inspired examples for full UI and parser validation.

## Focus Highlights
### Logic and Condition Composition
- **logical-operators/**: Negation, long AND/OR chains, precedence checks (~30 symbols) to validate parser short-circuiting and evaluation order.
- **depends_on/** and **if/**: Demonstrate condition decomposition and nested scopes, ensuring tree semantics align with menu visibility.

### Conditional Properties
- **conditional-properties/**: Conditional `prompt`/`default`/`select`/`range`/`visible if`, including negations, parentheses, and compact forms such as `if SYMBOL1&&SYMBOL2`.
- **menu/** and **menuconfig/**: Blend `visible if` with block guards to certify conditional menu rendering.

### Numeric Evaluation
- **comparison-operators/**: Combines relational operators with logic expressions to mimic performance thresholds and resource gating.

### Complex Structures
- **complex-conditions/**: Extreme boolean chains, menu-choice interplay, and deep `if` nesting (40+ symbols) derived from production cases.
- **complex-nesting/** and **comprehensive/**: Multi-layer menus and system walkthroughs used for visual regression.

### Advanced Keywords
- **advanced-keywords/**: Exercises `imply`, `modules`, `option env/defconfig_list`, environment-variable warnings, and wildcard `rsource "modules/*/Kconfig"`; includes `test.sh` for rapid verification.
- **source/**: Systematically covers the include family, optional files, nested chains, glob resolution, and error tolerance.

### Baseline Regression
- **basic/**, **config/**, **select/**, and **simple-if/**: Minimal scenarios to keep parser, highlighting, and menu interactions stable.

## Metrics
- **Directories**: 16 total, including new focus areas `logical-operators/`, `conditional-properties/`, `comparison-operators/`, `complex-conditions/`, and `advanced-keywords/`.
- **Files**: 39+, spanning primary `Kconfig`, include files, helper scripts, and README guides.
- **Symbols**: 195+ across bool, tristate, int, hex, and string types.
- **Source projects**: RT-Thread drivers/libc/vdso trees and the official Linux Kconfig specification.

## How to Exercise
- **VS Code**: Open any test `Kconfig` to inspect highlighting and hovers; use “Open Menuconfig” to confirm conditional visibility.
- **Command line**:
  - `python3 -c "import kconfiglib; k = kconfiglib.Kconfig('test-kconfig/logical-operators/Kconfig')"`
  - `make menuconfig KCONFIG_CONFIG=test-kconfig/logical-operators/Kconfig`
- **Focused script**: Run `advanced-keywords/test.sh` to quickly validate wildcard `rsource` and module-based setups.

## Future Enhancements
- Add coverage for string manipulation, concatenation, and regex-like conditions.
- Bring in domain-specific examples (drivers, file systems, embedded profiles) to broaden realism.
- Introduce negative tests for syntax errors, cyclic dependencies, and type conflicts.
- Plan stress scenarios for large configuration trees to assess parser and UI performance.

## References
- [Linux Kernel Kconfig Language](https://www.kernel.org/doc/html/latest/kbuild/kconfig-language.html)
- [Kconfiglib Documentation](https://github.com/ulfalizer/Kconfiglib)
- [RT-Thread Project Kconfig Samples](https://github.com/RT-Thread/rt-thread)

