import * as vscode from 'vscode';
import * as path from 'path';

export type TestResultStatus = 'pass' | 'fail' | 'unknown';

export class TestResultDecorationProvider implements vscode.FileDecorationProvider {
    private readonly _onDidChangeFileDecorations: vscode.EventEmitter<vscode.Uri | vscode.Uri[]> = new vscode.EventEmitter<vscode.Uri[]>();
    public readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | vscode.Uri[]> = this._onDidChangeFileDecorations.event;

    // Use a Map to store the status of each test file URI
    private testFileStatus: Map<string, TestResultStatus> = new Map();

    public provideFileDecoration(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<vscode.FileDecoration> {
        const status = this.testFileStatus.get(uri.fsPath);
        
        if (status === 'pass') {
            return new vscode.FileDecoration(
                '✓', // Badge
                'All tests passed', // Tooltip
                new vscode.ThemeColor('xunit.testPass') // Color ID from package.json
            );
        }

        if (status === 'fail') {
            return new vscode.FileDecoration(
                '❌', // Badge
                'One or more tests failed', // Tooltip
                new vscode.ThemeColor('xunit.testFail') // Color ID from package.json
            );
        }

        // No decoration for other files or tests not yet run
        return undefined;
    }

    /**
     * Updates the status for a specific test file and fires an event to trigger a UI refresh.
     * @param fileUri The URI of the test file to update.
     * @param status The new status ('pass' or 'fail').
     */
    public updateState(fileUri: vscode.Uri, status: TestResultStatus) {
        this.testFileStatus.set(fileUri.fsPath, status);
        this._onDidChangeFileDecorations.fire(fileUri);
    }

    /**
     * Clears all decoration states and refreshes the entire explorer.
     */
    public clearAllStates() {
        const urisToRefresh = Array.from(this.testFileStatus.keys()).map(fsPath => vscode.Uri.file(fsPath));
        this.testFileStatus.clear();
        this._onDidChangeFileDecorations.fire(urisToRefresh);
    }
}