import assert from "assert";

import { runUnsavedCloseFlow } from "../menuconfig/unsavedCloseFlow";

interface MessageItem {
    title: string;
    isCloseAffordance?: boolean;
}

export async function runUnsavedCloseFlowTests(): Promise<void> {
    {
        let saveCalled = 0;
        let warningCalled = 0;

        await runUnsavedCloseFlow({
            hasUnsavedChanges: false,
            saveConfig: async () => {
                saveCalled += 1;
            },
            showWarningMessage: async () => {
                warningCalled += 1;
                return undefined;
            },
            showErrorMessage: () => undefined,
            setStatusBarMessage: () => undefined,
            text: {
                unsavedMessage: "unsaved",
                saveButton: "Yes",
                noSaveButton: "No",
                saveSuccess: "saved",
                saveFailed: "save failed",
            },
        });

        assert.strictEqual(warningCalled, 0, "no unsaved changes should not show prompt");
        assert.strictEqual(saveCalled, 0, "no unsaved changes should not trigger save");
    }

    {
        let saveCalled = 0;
        const statusMessages: string[] = [];
        let modalCaptured = false;

        await runUnsavedCloseFlow({
            hasUnsavedChanges: true,
            saveConfig: async () => {
                saveCalled += 1;
            },
            showWarningMessage: async (_message: string, options: { modal?: boolean }, ...items: MessageItem[]) => {
                modalCaptured = options?.modal === true;
                return items[0];
            },
            showErrorMessage: () => undefined,
            setStatusBarMessage: (message: string) => {
                statusMessages.push(message);
            },
            text: {
                unsavedMessage: "unsaved",
                saveButton: "Yes",
                noSaveButton: "No",
                saveSuccess: "saved",
                saveFailed: "save failed",
            },
        });

        assert.strictEqual(modalCaptured, true, "unsaved prompt should be modal");
        assert.strictEqual(saveCalled, 1, "selecting save should save config");
        assert.strictEqual(statusMessages.length, 1, "save success should push status message");
        assert.ok(statusMessages[0].includes("saved"), "status should include success text");
    }

    {
        let saveCalled = 0;
        let errorCalled = 0;

        await runUnsavedCloseFlow({
            hasUnsavedChanges: true,
            saveConfig: async () => {
                saveCalled += 1;
            },
            showWarningMessage: async (_message: string, _options: { modal?: boolean }, ...items: MessageItem[]) => items[1],
            showErrorMessage: () => {
                errorCalled += 1;
            },
            setStatusBarMessage: () => undefined,
            text: {
                unsavedMessage: "unsaved",
                saveButton: "Yes",
                noSaveButton: "No",
                saveSuccess: "saved",
                saveFailed: "save failed",
            },
        });

        assert.strictEqual(saveCalled, 0, "selecting no-save should not call save");
        assert.strictEqual(errorCalled, 0, "selecting no-save should not show error");
    }

    {
        let errorMessage = "";

        await runUnsavedCloseFlow({
            hasUnsavedChanges: true,
            saveConfig: async () => {
                throw new Error("disk full");
            },
            showWarningMessage: async (_message: string, _options: { modal?: boolean }, ...items: MessageItem[]) => items[0],
            showErrorMessage: (message: string) => {
                errorMessage = message;
            },
            setStatusBarMessage: () => undefined,
            text: {
                unsavedMessage: "unsaved",
                saveButton: "Yes",
                noSaveButton: "No",
                saveSuccess: "saved",
                saveFailed: "save failed",
            },
        });

        assert.strictEqual(errorMessage, "save failed", "save failure should show configured error message");
    }
}
