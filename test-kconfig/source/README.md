# Source Keyword Series Test Files

This directory contains test files for testing the VSCode Kconfig extension's support for source keyword series.

## Test Coverage

### Supported Keywords
- `source`: Standard source, absolute path or relative to project root
- `rsource`: Relative path source, relative to current file directory
- `osource`: Optional source, no error when file doesn't exist
- `orsource`: Optional relative path source

### Test Scenarios

#### 1. Basic Functionality Test
- **File**: `Kconfig` (main file)
- **Test Content**: Basic usage of each keyword

#### 2. Relative Path Resolution Test
- **Directory**: `sub/`
- **Test Files**:
  - `basic.kconfig` - Included via source
  - `relative.kconfig` - Included via rsource
  - `optional-*.kconfig` - Included via osource/orsource
  - `conditional.kconfig` - Included in conditional block

#### 3. Glob Pattern Test
- **Directory**: `patterns/`
- **Test Files**:
  - `feature*.kconfig` - Tests `*.kconfig` pattern
  - `opt_*.kconfig` - Tests optional glob pattern
  - `rel_*.kconfig` - Tests relative path glob pattern

#### 4. Nested Include Test
- **Directory**: `nested/`
- **Test Files**:
  - `level1.kconfig` - First level nesting
  - `level2.kconfig` - Second level nesting
  - `level2_optional.kconfig` - Optional second level nesting

## Usage

1. Open the main `Kconfig` file in VSCode
2. Check if syntax highlighting correctly displays all keywords
3. Test auto-completion functionality (type keyword prefix)
4. Use Kconfig visual editor to verify all configuration items load correctly
5. Verify that non-existent optional files don't cause errors

## Expected Results

- All source series keywords should have correct syntax highlighting
- Auto-completion should provide suggestions for all four keywords
- All existing configuration files should be parsed and displayed correctly
- Non-existent optional files (like `optional-missing.kconfig`) should not generate errors
- Glob patterns should correctly match and include multiple files
- Nested includes should work properly, showing complete configuration hierarchy

## Troubleshooting

If you encounter issues:
1. Check if file paths are correct
2. Confirm glob package is installed correctly
3. Check error messages in VSCode output panel
4. Verify implementation in KconfigParser.ts is correct
