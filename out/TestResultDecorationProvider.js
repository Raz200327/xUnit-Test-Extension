"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestResultDecorationProvider = void 0;
const vscode = __importStar(require("vscode"));
class TestResultDecorationProvider {
    _onDidChangeFileDecorations = new vscode.EventEmitter();
    onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
    // Use a Map to store the status of each test file URI
    testFileStatus = new Map();
    provideFileDecoration(uri, token) {
        const status = this.testFileStatus.get(uri.fsPath);
        if (status === 'pass') {
            return new vscode.FileDecoration('✓', // Badge
            'All tests passed', // Tooltip
            new vscode.ThemeColor('xunit.testPass') // Color ID from package.json
            );
        }
        if (status === 'fail') {
            return new vscode.FileDecoration('❌', // Badge
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
    updateState(fileUri, status) {
        this.testFileStatus.set(fileUri.fsPath, status);
        this._onDidChangeFileDecorations.fire(fileUri);
    }
    /**
     * Clears all decoration states and refreshes the entire explorer.
     */
    clearAllStates() {
        const urisToRefresh = Array.from(this.testFileStatus.keys()).map(fsPath => vscode.Uri.file(fsPath));
        this.testFileStatus.clear();
        this._onDidChangeFileDecorations.fire(urisToRefresh);
    }
}
exports.TestResultDecorationProvider = TestResultDecorationProvider;
//# sourceMappingURL=TestResultDecorationProvider.js.map