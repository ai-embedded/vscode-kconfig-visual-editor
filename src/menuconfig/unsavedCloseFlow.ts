interface UnsavedCloseMessageItem {
    title: string;
    isCloseAffordance?: boolean;
}

interface UnsavedCloseFlowText {
    unsavedMessage: string;
    saveButton: string;
    noSaveButton: string;
    saveSuccess: string;
    saveFailed: string;
}

interface UnsavedCloseFlowOptions {
    hasUnsavedChanges: boolean;
    saveConfig: () => Promise<void>;
    showWarningMessage: (
        _message: string,
        _options: { modal?: boolean },
        ..._items: UnsavedCloseMessageItem[]
    ) => Promise<UnsavedCloseMessageItem | undefined>;
    showErrorMessage: (_message: string) => void;
    setStatusBarMessage: (_message: string, _hideAfterTimeout?: number) => void;
    text: UnsavedCloseFlowText;
}

export async function runUnsavedCloseFlow(options: UnsavedCloseFlowOptions): Promise<void> {
    if (!options.hasUnsavedChanges) {
        return;
    }

    const saveItem: UnsavedCloseMessageItem = {
        title: options.text.saveButton,
        isCloseAffordance: false,
    };
    const noSaveItem: UnsavedCloseMessageItem = {
        title: options.text.noSaveButton,
        isCloseAffordance: true,
    };

    const decision = await options.showWarningMessage(
        options.text.unsavedMessage,
        { modal: true },
        saveItem,
        noSaveItem
    );

    if (decision !== saveItem) {
        return;
    }

    try {
        await options.saveConfig();
        options.setStatusBarMessage(`$(check) ${options.text.saveSuccess}`, 3000);
    } catch {
        options.showErrorMessage(options.text.saveFailed);
    }
}
