import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TestExplorerProvider, TestTreeItem, TestFileResult, TestMethodResult } from './TestExplorerProvider';
import { TestResultDecorationProvider } from './TestResultDecorationProvider';
import { parseStringPromise as parseXml } from 'xml2js';
import OpenAI from "openai";

interface TestMethodEntry {
    MethodName: string;
    ClassName: string;
    FilePath: string;
    Outcome: 'Passed' | 'Failed' | 'Skipped';
    Duration?: string;
    ErrorMessage?: string;
    StackTrace?: string;
}

interface TestRunSummary {
    TotalTests: number;
    PassedTests: number;
    FailedTests: number;
    SkippedTests: number;
    Duration?: string;
    TestRunner: string;
    RunType: 'AllTests' | 'FileTests' | 'FolderTests' | 'SingleMethod';
    TargetFile?: string;
    TargetFolder?: string;
    TargetMethod?: string;
}

interface TestDatabaseEntry {
    Timestamp: string;
    RunId: string;
    Summary: TestRunSummary;
    TestMethods: TestMethodEntry[];
    FilesInvolved: string[];
    ProjectRoot: string;
    Success: boolean;
    Message: string;
    TrxFilePath?: string;
    CommandExecuted?: string;
}

interface TestDatabase {
    Version: string;
    Created: string;
    LastUpdated: string;
    TotalRuns: number;
    Tests: TestDatabaseEntry[];
}


const execAsync = promisify(exec);
let decorationProvider: TestResultDecorationProvider;
let outputChannel: vscode.OutputChannel;

/**
 * Determines the root directory for the .NET project.
 * It first checks for a user-defined setting, then falls back to the first workspace folder.
 * @returns A Uri for the project root, or undefined if none can be determined.
 */
async function getProjectRoot(): Promise<vscode.Uri | undefined> {
    const mainWorkspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!mainWorkspaceFolder) {
        return undefined; // No folder open
    }

    const config = vscode.workspace.getConfiguration('xunit-tester');
    const projectRootSetting = config.get<string>('projectRootPath')?.trim();

    if (projectRootSetting) {
        const fullPath = path.join(mainWorkspaceFolder.uri.fsPath, projectRootSetting);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
            return vscode.Uri.file(fullPath);
        } else {
            vscode.window.showWarningMessage(`The configured 'projectRootPath' ("${projectRootSetting}") does not exist. Falling back to auto-detection.`);
        }
    }

    // Try to find a solution file (.sln) in the workspace
    const solutionFiles = await vscode.workspace.findFiles('**/*.sln', '**/node_modules/**', 5);
    if (solutionFiles.length > 0) {
        // Use the directory containing the first solution file found
        const solutionDir = path.dirname(solutionFiles[0].fsPath);
        console.log(`Found solution file at: ${solutionFiles[0].fsPath}, using directory: ${solutionDir}`);
        return vscode.Uri.file(solutionDir);
    }

    // If no solution file found, try to find the common parent directory of all test projects
    const testFiles = await vscode.workspace.findFiles('**/*Tests.cs', '**/node_modules/**');
    if (testFiles.length > 0) {
        // Find the shortest common path that contains all test files
        const testDirs = testFiles.map(file => path.dirname(file.fsPath));
        const commonPath = findCommonParentDirectory(testDirs);
        
        // Go up one level from the common test directory to find the likely solution root
        const potentialRoot = path.dirname(commonPath);
        if (fs.existsSync(potentialRoot) && fs.statSync(potentialRoot).isDirectory()) {
            console.log(`Inferred project root from test files: ${potentialRoot}`);
            return vscode.Uri.file(potentialRoot);
        }
    }

    // Fallback to the main workspace folder
    console.log(`Using workspace root as fallback: ${mainWorkspaceFolder.uri.fsPath}`);
    return mainWorkspaceFolder.uri;
}

/**
 * Finds the common parent directory of a list of directory paths
 */
function findCommonParentDirectory(directories: string[]): string {
    if (directories.length === 0) return '';
    if (directories.length === 1) return directories[0];

    const pathSegments = directories.map(dir => dir.split(path.sep));
    const minLength = Math.min(...pathSegments.map(segments => segments.length));
    
    let commonSegments: string[] = [];
    for (let i = 0; i < minLength; i++) {
        const segment = pathSegments[0][i];
        if (pathSegments.every(segments => segments[i] === segment)) {
            commonSegments.push(segment);
        } else {
            break;
        }
    }
    
    return commonSegments.join(path.sep);
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('Controller Test Generator is now active!');
    decorationProvider = new TestResultDecorationProvider();
    outputChannel = vscode.window.createOutputChannel('Test Runner');
    const runFolderTestsDisposable = vscode.commands.registerCommand('controller-test-generator.runFolderTests', async (item: TestTreeItem) => {
        if (item && item.itemType === 'folder') {
            await runFolderTests(item.label, testExplorerProvider);
        }
    });
    const runSingleTestDisposable = vscode.commands.registerCommand('controller-test-generator.runSingleTest', async (item: TestTreeItem) => {
    if (item && item.itemType === 'method' && item.methodResult && item.parentFilePath) {
        await runSingleTestMethod(item.methodResult.methodName, item.parentFilePath, testExplorerProvider);
        }
    });
    const llmGenerateTestsDisposable = vscode.commands.registerCommand(
    'controller-test-generator.llmGenerateTests',
    async (item: TestTreeItem) => {
        if (!item?.resourceUri) return;
        await generateTestsWithLLM(item.resourceUri);
    }
);


const navigateToTestMethodDisposable = vscode.commands.registerCommand('controller-test-generator.navigateToTestMethod', async (filePath: string, methodName: string) => {
    try {
        // Open the file
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        const editor = await vscode.window.showTextDocument(document);
        
        // Find the method in the document
        const text = document.getText();
        const methodIndex = await findMethodInDocument(text, methodName);
        
        if (methodIndex !== -1) {
            // Convert character index to position
            const position = document.positionAt(methodIndex);
            
            // Create a range for the method line
            const line = document.lineAt(position.line);
            const range = new vscode.Range(position.line, 0, position.line, line.text.length);
            
            // Navigate to the method
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            
            // Optional: Highlight the method line briefly
            const decorationType = vscode.window.createTextEditorDecorationType({
                backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
                isWholeLine: true
            });
            
            editor.setDecorations(decorationType, [range]);
            
            // Remove highlight after 2 seconds
            setTimeout(() => {
                decorationType.dispose();
            }, 2000);
            
        } else {
            vscode.window.showWarningMessage(`Could not find method ${methodName} in ${path.basename(filePath)}`);
        }
        
    } catch (error) {
        console.error('Error navigating to test method:', error);
        vscode.window.showErrorMessage(`Failed to navigate to method ${methodName}`);
    }
});


async function generateTestsWithLLM(testFileUri: vscode.Uri) {
    /* ── 0. config + early exits ──────────────────────────────────────────── */
    const key =
        vscode.workspace.getConfiguration("controllerTestGenerator").get<string>("openAIApiKey") ??
        process.env.OPENAI_API_KEY;
    if (!key) {
        vscode.window.showErrorMessage("OpenAI API key not configured.");
        return;
    }

    const projectRootUri = await getProjectRoot();
    if (!projectRootUri) return;
    /* ── 1. locate companion source file (FooController.cs) ──────────────── */
    const testFileName   = path.basename(testFileUri.fsPath, ".cs");   // FooControllerTests
    const sourceFileBase = testFileName.replace(/Tests$/, "");         // FooController
    const [sourceUri]    = await vscode.workspace.findFiles(
        new vscode.RelativePattern(projectRootUri.fsPath, `**/${sourceFileBase}.cs`),
        "**/node_modules/**",
        1
    );
    if (!sourceUri) {
        vscode.window.showErrorMessage(`Could not find source file ${sourceFileBase}.cs`);
        return;
    }

    /* ── 2. read inputs ──────────────────────────────────────────────────── */
    const [sourceCode, exampleTest] = await Promise.all([
        fs.promises.readFile(sourceUri.fsPath, "utf8"),
        getExampleTest(projectRootUri)
    ]);

    /* ── 3. build prompts (➜ raw C# only) ─────────────────────────────────── */
    const systemPrompt = `
    You are an expert C# developer writing xUnit tests for .NET 8 projects.
    Return **only** the complete C# test file content – no markdown fences, no JSON, no extra text.`;
        const userPrompt = `
    Here is an example test we already like:

    \`\`\`csharp
    ${exampleTest}
    \`\`\`

    Create an xUnit test file for the following ${sourceFileBase}:

    \`\`\`csharp
    ${sourceCode}
    \`\`\`
    `;

    const cfg        = vscode.workspace.getConfiguration("controllerTestGenerator");
    const temperature = Number(cfg.get<string>("openAIApiTemp") ?? 0.2);
    const model       = cfg.get<string>("openAIApiModel") ?? "gpt-4o-mini";
    const maxTokens   = Number(cfg.get<number>("openAIApiMaxTokens") ?? 10_000);

    if (!["gpt-4.1-mini", "gpt-4.1", "gpt-4.1-nano"].includes(model)) {
        vscode.window.showErrorMessage(
            `Unsupported OpenAI model: ${model}. Supported: gpt-4o-mini, gpt-4o, gpt-3.5-turbo.`
        );
        return;
    }

    const openai = new OpenAI({ apiKey: key });

    /* ── 4. stream into the real test file ───────────────────────────────── */
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Generating tests…", cancellable: false },
        async () => {
            try {
                /* (a) open the *actual* test file so we can live-update it */
                const targetDoc    = await vscode.workspace.openTextDocument(testFileUri);
                const targetEditor = await vscode.window.showTextDocument(targetDoc, { preview: false });

                /* clear any stub contents */
                await targetEditor.edit(edit => {
                    edit.delete(
                        new vscode.Range(
                            targetDoc.positionAt(0),
                            targetDoc.positionAt(targetDoc.getText().length)
                        )
                    );
                });

                /* (b) start the streamed request */
                const stream = await openai.chat.completions.create({
                    model,
                    temperature,
                    max_tokens: maxTokens,
                    stream: true,
                    messages: [
                        { role: "system", content: systemPrompt.trim() },
                        { role: "user",   content: userPrompt.trim()  }
                    ]
                });

                /* (c) write chunks to file + editor as they come */
                let codeBuffer = "";
                for await (const chunk of stream) {
                    const part = chunk.choices?.[0]?.delta?.content ?? "";
                    if (!part) continue;
                    codeBuffer += part;

                    // 🔄  grab the current editor for this document, if any
                    const liveEditor = vscode.window.visibleTextEditors
                        .find(e => e.document.uri.toString() === testFileUri.toString());

                    if (liveEditor) {
                        await liveEditor.edit(edit => {
                            const end = liveEditor.document.positionAt(
                                liveEditor.document.getText().length
                            );
                            edit.insert(end, part);
                        });
                        liveEditor.revealRange(
                            new vscode.Range(
                                liveEditor.document.lineCount + 1, 0,
                                liveEditor.document.lineCount + 1, 0),
                            vscode.TextEditorRevealType.Default
                        );
                    }
}


                /* (d) save file once the stream ends */
                await fs.promises.writeFile(testFileUri.fsPath, codeBuffer, "utf8");
                await targetDoc.save();   // so it isn’t “dirty” in the UI

                vscode.window.showInformationMessage(
                    `Test generated ${path.basename(testFileUri.fsPath)} successfully.`
                );
                vscode.window.showWarningMessage(
                    `Review the generated test file (${path.basename(testFileUri.fsPath)}) for correctness and safety before running.`
                );
            } catch (err: any) {
                console.error(err);
                vscode.window.showErrorMessage("Failed to generate tests – see console for details.");
            }
        }
    );
}

// Simple helper: reuse an existing, committed test as the “style guide”.
async function getExampleTest(projectRoot: vscode.Uri): Promise<string> {
    const [example] =
        await vscode.workspace.findFiles(new vscode.RelativePattern(projectRoot.fsPath, '**/*ControllerTests.cs'), null, 1);
    return example ? fs.promises.readFile(example.fsPath, 'utf8') : '// (no example found)';
}


context.subscriptions.push(llmGenerateTestsDisposable);
    // --- DETERMINE PROJECT ROOT & SETUP UI ---
    const projectRootUri = await getProjectRoot();
    if (!projectRootUri) {
        vscode.window.showErrorMessage("xUnit Tester: Please open a folder to use this extension.");
        return; // Stop activation if no root can be found
    }
    const rootPath = projectRootUri.fsPath;

    const testExplorerProvider = new TestExplorerProvider(rootPath);
    vscode.window.createTreeView('xunitTestExplorer', {
        treeDataProvider: testExplorerProvider
    });


    // --- SETUP FILE SYSTEM WATCHERS ---
    // Note: Watchers still watch the entire workspace, but actions will use the project root.
    const testExplorerWatcher = vscode.workspace.createFileSystemWatcher('**/*Tests.cs', false, false, false);
    
    testExplorerWatcher.onDidCreate(() => testExplorerProvider.refresh());
    testExplorerWatcher.onDidDelete(() => testExplorerProvider.refresh());
    testExplorerWatcher.onDidChange(() => testExplorerProvider.refresh());

    const generationWatcher = vscode.workspace.createFileSystemWatcher('**/*{Controller,Service}.cs', false, true, true);
    generationWatcher.onDidCreate(async (uri) => {
        await handleFileCreation(uri);
        testExplorerProvider.refresh();
    });

    // --- REGISTER COMMANDS ---
    const clearTestResultsDisposable = vscode.commands.registerCommand('xunit-tester.clearTestResults', () => {
        decorationProvider.clearAllStates();
        vscode.window.showInformationMessage('Cleared all test result decorations.');
    });
    
    const refreshTestExplorerDisposable = vscode.commands.registerCommand('xunit-tester.refreshTestExplorer', () => {
        testExplorerProvider.refresh();
    });

    const generateTestDisposable = vscode.commands.registerCommand('controller-test-generator.generateTest', async (uri?: vscode.Uri) => {
        const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
        if (targetUri) {
            await handleFileCreation(targetUri);
            testExplorerProvider.refresh();
        } else {
            vscode.window.showWarningMessage('No active file to generate a test for.');
        }
    });

    const runAllTestsDisposable = vscode.commands.registerCommand('controller-test-generator.runAllTests', async () => {
        await runTestsAndUpdateDecorations(undefined, testExplorerProvider);
    });

    const runCurrentFileTestsDisposable = vscode.commands.registerCommand('controller-test-generator.runCurrentFileTests', async () => {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor && activeEditor.document.fileName.endsWith('Tests.cs')) {
            await runTestsAndUpdateDecorations(activeEditor.document.uri, testExplorerProvider);
        } else {
            vscode.window.showWarningMessage('No active C# test file to run.');
        }
    });

    const runFileTestsDisposable = vscode.commands.registerCommand('controller-test-generator.runFileTests', async (item: TestTreeItem) => {
        if (item && item.resourceUri) {
             await runTestsAndUpdateDecorations(item.resourceUri, testExplorerProvider);
        }
    });

    const runTestsInTerminalDisposable = vscode.commands.registerCommand('controller-test-generator.runTestsInTerminal', async () => {
        const projectRootUri = await getProjectRoot();
        if (!projectRootUri) {
            vscode.window.showErrorMessage('No project root found. Please open a folder.');
            return;
        }

        let terminal = vscode.window.terminals.find(t => t.name === 'Test Runner');
        if (!terminal) {
            terminal = vscode.window.createTerminal({ name: 'Test Runner', cwd: projectRootUri.fsPath });
        }
        terminal.show();
        terminal.sendText('dotnet test');
    });

    // --- SUBSCRIBE ALL DISPOSABLES ---
    context.subscriptions.push(
        testExplorerWatcher,
        generationWatcher,
        refreshTestExplorerDisposable,
        runSingleTestDisposable,
        generateTestDisposable,
        runAllTestsDisposable,
        runCurrentFileTestsDisposable,
        runFileTestsDisposable,
        runTestsInTerminalDisposable,
        vscode.window.registerFileDecorationProvider(decorationProvider),
        runFolderTestsDisposable,
        clearTestResultsDisposable,
        navigateToTestMethodDisposable,
        outputChannel
    );
}

async function findMethodInDocument(text: string, methodName: string): Promise<number> {
    // Escape special regex characters in method name
    const escapedMethodName = methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Try multiple patterns to find the method
    const patterns = [
        // [Fact] or [Theory] attribute followed by method
        new RegExp(`\\[(?:Fact|Theory)(?:[^\\]]*)?\\]\\s*(?:\\/\\/.*?\\n\\s*)*(?:public|private|internal)?\\s*(?:async\\s+)?(?:void|Task)\\s+${escapedMethodName}\\s*\\(`, 'i'),
        
        // Direct method pattern
        new RegExp(`(?:public|private|internal)?\\s*(?:async\\s+)?(?:void|Task)\\s+${escapedMethodName}\\s*\\(`, 'i'),
        
        // Method with any access modifier
        new RegExp(`\\b${escapedMethodName}\\s*\\(`, 'i')
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match.index !== undefined) {
            console.log(`Found method ${methodName} using pattern at index ${match.index}`);
            return match.index;
        }
    }
    
    console.log(`Could not find method ${methodName} in document`);
    return -1;
}


async function runSingleTestMethod(methodName: string, testFilePath: string, provider: TestExplorerProvider) {
    const projectRootUri = await getProjectRoot();
    if (!projectRootUri) {
        vscode.window.showErrorMessage('No project root found. Please open a folder.');
        return;
    }

    const testClassName = path.basename(testFilePath, '.cs');
    
    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `xUnit Tester: Running ${methodName}...`,
        cancellable: false
    }, async (progress) => {
        try {
            outputChannel.clear();
            outputChannel.show(true);
            
            const resultsDir = vscode.workspace.getConfiguration('xunit-tester').get<string>('resultsPath', 'TestResults');
            const resultsPattern = new vscode.RelativePattern(projectRootUri.fsPath, `**/${resultsDir}/*.trx`);

            outputChannel.appendLine('Searching for and deleting old .trx files...');
            const oldResultFiles = await vscode.workspace.findFiles(resultsPattern);
            for (const file of oldResultFiles) {
                await fs.promises.unlink(file.fsPath);
                outputChannel.appendLine(`  - Deleted: ${file.fsPath}`);
            }

            outputChannel.appendLine(`Starting Single Test Method Execution: ${methodName}...`);
            
            // Create filter for specific test method
            const filterPattern = `FullyQualifiedName~${testClassName}.${methodName}`;
            
            let testCommand = `dotnet test --logger "trx;LogFileName=${path.join(resultsDir, 'results.trx')}"`;
            testCommand += ` --filter "${filterPattern}"`;
            
            outputChannel.appendLine(`> ${testCommand}\n`);
            outputChannel.appendLine(`Running single test: ${testClassName}.${methodName}\n`);

            try {
                const { stdout, stderr } = await execAsync(testCommand, { cwd: projectRootUri.fsPath });
                outputChannel.appendLine('--- DOTNET TEST STDOUT ---');
                outputChannel.appendLine(stdout);
                if (stderr) {
                    outputChannel.appendLine('--- DOTNET TEST STDERR ---');
                    outputChannel.appendLine(stderr);
                }
            } catch (error: any) {
                outputChannel.appendLine('--- DOTNET TEST OUTPUT (with failures) ---');
                outputChannel.appendLine(error.stdout || '');
                if (error.stderr) {
                    outputChannel.appendLine('--- DOTNET TEST STDERR ---');
                    outputChannel.appendLine(error.stderr);
                }
            }

            const newResultFiles = await vscode.workspace.findFiles(resultsPattern);
            if (newResultFiles.length > 0) {
                newResultFiles.sort((a, b) => fs.statSync(b.fsPath).mtimeMs - fs.statSync(a.fsPath).mtimeMs);
                const trxFilePath = newResultFiles[0].fsPath;
                outputChannel.appendLine(`\n✅ Found TRX file: ${trxFilePath}`);
                await parseResultsAndUpdateDecorations(
                    trxFilePath, 
                    undefined, 
                    provider, 
                    'SingleMethod', 
                    { 
                        method: methodName, 
                        file: path.basename(testFilePath) 
                    }, 
                    testCommand
                );
                vscode.window.showInformationMessage(`Single test ${methodName} execution finished.`);
            } else {
                vscode.window.showErrorMessage('Test completed but no TRX result file was found. Check the output for errors.');
                outputChannel.appendLine('\n⚠️ Could not find any TRX file after test run.');
            }

        } catch (error: any) {
            vscode.window.showErrorMessage(`An unexpected error occurred: ${error.message}`);
            outputChannel.appendLine(`[FATAL ERROR] ${error.stack}`);
        }
    });
}

async function runTestsAndUpdateDecorations(fileUri: vscode.Uri | undefined, provider: TestExplorerProvider) {
    const projectRootUri = await getProjectRoot();
    if (!projectRootUri) {
        vscode.window.showErrorMessage('No project root found. Please open a folder.');
        return;
    }

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "xUnit Tester: Running tests...",
        cancellable: false
    }, async (progress) => {
        try {
            outputChannel.clear();
            outputChannel.show(true);
            
            const resultsDir = vscode.workspace.getConfiguration('xunit-tester').get<string>('resultsPath', 'TestResults');
            const resultsPattern = new vscode.RelativePattern(projectRootUri.fsPath, `**/${resultsDir}/*.trx`);

            outputChannel.appendLine('Searching for and deleting old .trx files...');
            const oldResultFiles = await vscode.workspace.findFiles(resultsPattern);
            for (const file of oldResultFiles) {
                await fs.promises.unlink(file.fsPath);
                outputChannel.appendLine(`  - Deleted: ${file.fsPath}`);
            }

            outputChannel.appendLine('Starting Test Execution...');
            let testCommand = `dotnet test --logger "trx;LogFileName=${path.join(resultsDir, 'results.trx')}"`;
            
            if (fileUri) {
                const testClassName = path.basename(fileUri.fsPath, '.cs');
                testCommand += ` --filter "FullyQualifiedName~${testClassName}"`;
            }
            
            outputChannel.appendLine(`> ${testCommand}\n`);

            try {
                const { stdout, stderr } = await execAsync(testCommand, { cwd: projectRootUri.fsPath });
                outputChannel.appendLine('--- DOTNET TEST STDOUT ---');
                outputChannel.appendLine(stdout);
                if (stderr) {
                    outputChannel.appendLine('--- DOTNET TEST STDERR ---');
                    outputChannel.appendLine(stderr);
                }
            } catch (error: any) {
                outputChannel.appendLine('--- DOTNET TEST OUTPUT (with failures) ---');
                outputChannel.appendLine(error.stdout || '');
                if (error.stderr) {
                    outputChannel.appendLine('--- DOTNET TEST STDERR ---');
                    outputChannel.appendLine(error.stderr);
                }
            }

            const newResultFiles = await vscode.workspace.findFiles(resultsPattern);
            if (newResultFiles.length > 0) {
                 // Use the most recently modified file.
                newResultFiles.sort((a, b) => fs.statSync(b.fsPath).mtimeMs - fs.statSync(a.fsPath).mtimeMs);
                const trxFilePath = newResultFiles[0].fsPath;
                outputChannel.appendLine(`\n✅ Found TRX file: ${trxFilePath}`);
                await parseResultsAndUpdateDecorations(
                    trxFilePath, 
                    fileUri, 
                    provider, 
                    fileUri ? 'FileTests' : 'AllTests', 
                    fileUri ? { file: path.basename(fileUri.fsPath) } : undefined, 
                    testCommand
                );
                vscode.window.showInformationMessage('Test run finished.');
            } else {
                vscode.window.showErrorMessage('Test completed but no TRX result file was found. Check the output for errors.');
                outputChannel.appendLine('\n⚠️ Could not find any TRX file after test run.');
            }

        } catch (error: any) {
            vscode.window.showErrorMessage(`An unexpected error occurred: ${error.message}`);
            outputChannel.appendLine(`[FATAL ERROR] ${error.stack}`);
        } finally {
            provider.refresh();
        }
    });
}


async function runFolderTests(folderName: string, provider: TestExplorerProvider) {
    const projectRootUri = await getProjectRoot();
    if (!projectRootUri) {
        vscode.window.showErrorMessage('No project root found. Please open a folder.');
        return;
    }

    // Clean folder name (remove status icons and counts)
    const cleanFolderName = folderName.replace(/^[✅❌]\s*/, '').replace(/\s*\(\d+\)$/, '');
    
    // Get all test files for this category
    const allTestFiles = await vscode.workspace.findFiles('**/*Tests.cs', '**/node_modules/**');
    const categoryFiles = allTestFiles.filter(file => categorizeTestFile(file) === cleanFolderName);
    
    if (categoryFiles.length === 0) {
        vscode.window.showWarningMessage(`No test files found in ${cleanFolderName} category.`);
        return;
    }
    
    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `xUnit Tester: Running ${cleanFolderName} tests...`,
        cancellable: false
    }, async (progress) => {
        try {
            outputChannel.clear();
            outputChannel.show(true);
            
            const resultsDir = vscode.workspace.getConfiguration('xunit-tester').get<string>('resultsPath', 'TestResults');
            const resultsPattern = new vscode.RelativePattern(projectRootUri.fsPath, `**/${resultsDir}/*.trx`);

            outputChannel.appendLine('Searching for and deleting old .trx files...');
            const oldResultFiles = await vscode.workspace.findFiles(resultsPattern);
            for (const file of oldResultFiles) {
                await fs.promises.unlink(file.fsPath);
                outputChannel.appendLine(`  - Deleted: ${file.fsPath}`);
            }

            outputChannel.appendLine(`Starting ${cleanFolderName} Test Execution...`);
            
            // Create filter pattern by combining all test class names in this category
            const testClassNames = categoryFiles.map(file => path.basename(file.fsPath, '.cs'));
            const filterPattern = testClassNames.map(name => `FullyQualifiedName~${name}`).join('|');
            
            let testCommand = `dotnet test --logger "trx;LogFileName=${path.join(resultsDir, 'results.trx')}"`;
            if (filterPattern) {
                testCommand += ` --filter "${filterPattern}"`;
            }
            
            outputChannel.appendLine(`> ${testCommand}\n`);
            outputChannel.appendLine(`Running tests for: ${testClassNames.join(', ')}\n`);

            try {
                const { stdout, stderr } = await execAsync(testCommand, { cwd: projectRootUri.fsPath });
                outputChannel.appendLine('--- DOTNET TEST STDOUT ---');
                outputChannel.appendLine(stdout);
                if (stderr) {
                    outputChannel.appendLine('--- DOTNET TEST STDERR ---');
                    outputChannel.appendLine(stderr);
                }
            } catch (error: any) {
                outputChannel.appendLine('--- DOTNET TEST OUTPUT (with failures) ---');
                outputChannel.appendLine(error.stdout || '');
                if (error.stderr) {
                    outputChannel.appendLine('--- DOTNET TEST STDERR ---');
                    outputChannel.appendLine(error.stderr);
                }
            }

            const newResultFiles = await vscode.workspace.findFiles(resultsPattern);
            if (newResultFiles.length > 0) {
                newResultFiles.sort((a, b) => fs.statSync(b.fsPath).mtimeMs - fs.statSync(a.fsPath).mtimeMs);
                const trxFilePath = newResultFiles[0].fsPath;
                outputChannel.appendLine(`\n✅ Found TRX file: ${trxFilePath}`);
                await parseResultsAndUpdateDecorations(
                        trxFilePath, 
                        undefined, 
                        provider, 
                        'FolderTests', 
                        { folder: cleanFolderName }, 
                        testCommand
                    );
                vscode.window.showInformationMessage(`${cleanFolderName} test run finished.`);
            } else {
                vscode.window.showErrorMessage('Test completed but no TRX result file was found. Check the output for errors.');
                outputChannel.appendLine('\n⚠️ Could not find any TRX file after test run.');
            }

        } catch (error: any) {
            vscode.window.showErrorMessage(`An unexpected error occurred: ${error.message}`);
            outputChannel.appendLine(`[FATAL ERROR] ${error.stack}`);
        } finally {
            provider.refresh();
        }
    });
}

// Helper function to categorize test files (same logic as in TestExplorerProvider)
function categorizeTestFile(fileUri: vscode.Uri): string {
    const filePath = fileUri.fsPath;
    const fileName = path.basename(filePath, '.cs');
    
    // First, try to categorize by file path (if organized in subfolders)
    if (filePath.includes(path.sep + 'Controllers' + path.sep) || 
        filePath.includes('/Controllers/')) {
        return 'Controllers';
    }
    
    if (filePath.includes(path.sep + 'Services' + path.sep) || 
        filePath.includes('/Services/') ||
        filePath.includes(path.sep + 'Service' + path.sep) || 
        filePath.includes('/Service/')) {
        return 'Services';
    }
    
    // If not in subfolders, categorize by naming convention
    if (fileName.includes('Controller')) {
        return 'Controllers';
    }
    
    if (fileName.includes('Service')) {
        return 'Services';
    }
    
    // Default to Controllers if can't determine
    return 'Controllers';
}

async function saveTestResultsToDatabase(
    testResults: TestFileResult[], 
    projectRootPath: string,
    runType: 'AllTests' | 'FileTests' | 'FolderTests' | 'SingleMethod',
    targetInfo?: { file?: string; folder?: string; method?: string },
    commandExecuted?: string,
    trxFilePath?: string
): Promise<void> {
    try {
        const databasePath = path.join(projectRootPath, 'database.json');
        const timestamp = new Date().toISOString();
        const runId = `run_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Read existing database or create new one
        let database: TestDatabase;
        
        if (fs.existsSync(databasePath)) {
            try {
                const existingData = await fs.promises.readFile(databasePath, 'utf8');
                const parsed = JSON.parse(existingData);
                
                // Migrate old format or ensure correct structure
                if (parsed.Tests && Array.isArray(parsed.Tests)) {
                    database = {
                        Version: parsed.Version || "1.0",
                        Created: parsed.Created || timestamp,
                        LastUpdated: timestamp,
                        TotalRuns: parsed.TotalRuns || parsed.Tests.length,
                        Tests: parsed.Tests
                    };
                } else {
                    database = {
                        Version: "1.0",
                        Created: timestamp,
                        LastUpdated: timestamp,
                        TotalRuns: 0,
                        Tests: []
                    };
                }
            } catch (parseError) {
                console.warn('Could not parse existing database.json, creating new one:', parseError);
                database = {
                    Version: "1.0",
                    Created: timestamp,
                    LastUpdated: timestamp,
                    TotalRuns: 0,
                    Tests: []
                };
            }
        } else {
            database = {
                Version: "1.0",
                Created: timestamp,
                LastUpdated: timestamp,
                TotalRuns: 0,
                Tests: []
            };
        }
        
        // Calculate summary statistics
        let totalTests = 0;
        let passedTests = 0;
        let failedTests = 0;
        let skippedTests = 0;
        const testMethods: TestMethodEntry[] = [];
        const filesInvolved = new Set<string>();
        
        // Process each test file result
        for (const fileResult of testResults) {
            filesInvolved.add(fileResult.filePath);
            
            if (fileResult.methods && fileResult.methods.length > 0) {
                // Process individual test methods
                for (const method of fileResult.methods) {
                    totalTests++;
                    
                    const methodEntry: TestMethodEntry = {
                        MethodName: method.methodName,
                        ClassName: path.basename(fileResult.filePath, '.cs'),
                        FilePath: fileResult.filePath,
                        Outcome: method.outcome,
                        ErrorMessage: method.errorMessage,
                        StackTrace: method.errorMessage // In case we want to separate these later
                    };
                    
                    testMethods.push(methodEntry);
                    
                    if (method.outcome === 'Passed') {
                        passedTests++;
                    } else if (method.outcome === 'Failed') {
                        failedTests++;
                    } else {
                        skippedTests++;
                    }
                }
            } else {
                // File-level results (fallback when method details aren't available)
                totalTests += fileResult.counts.passed + fileResult.counts.failed;
                passedTests += fileResult.counts.passed;
                failedTests += fileResult.counts.failed;
                
                // Create a summary entry for the file
                if (totalTests > 0) {
                    const fileEntry: TestMethodEntry = {
                        MethodName: `[File Summary: ${fileResult.counts.passed + fileResult.counts.failed} tests]`,
                        ClassName: path.basename(fileResult.filePath, '.cs'),
                        FilePath: fileResult.filePath,
                        Outcome: fileResult.state === 'pass' ? 'Passed' : 'Failed',
                        ErrorMessage: fileResult.state === 'fail' ? `${fileResult.counts.failed} test(s) failed in this file` : undefined
                    };
                    testMethods.push(fileEntry);
                }
            }
        }
        
        // Create summary
        const summary: TestRunSummary = {
            TotalTests: totalTests,
            PassedTests: passedTests,
            FailedTests: failedTests,
            SkippedTests: skippedTests,
            TestRunner: "dotnet test",
            RunType: runType,
            TargetFile: targetInfo?.file,
            TargetFolder: targetInfo?.folder,
            TargetMethod: targetInfo?.method
        };
        
        // Create descriptive message
        let message = '';
        switch (runType) {
            case 'AllTests':
                message = `Ran all tests: ${passedTests} passed, ${failedTests} failed`;
                break;
            case 'FileTests':
                message = `Ran tests in ${targetInfo?.file}: ${passedTests} passed, ${failedTests} failed`;
                break;
            case 'FolderTests':
                message = `Ran tests in ${targetInfo?.folder} folder: ${passedTests} passed, ${failedTests} failed`;
                break;
            case 'SingleMethod':
                message = `Ran single test ${targetInfo?.method}: ${passedTests > 0 ? 'PASSED' : 'FAILED'}`;
                break;
        }
        
        // Create main database entry
        const entry: TestDatabaseEntry = {
            Timestamp: timestamp,
            RunId: runId,
            Summary: summary,
            TestMethods: testMethods,
            FilesInvolved: Array.from(filesInvolved),
            ProjectRoot: projectRootPath,
            Success: failedTests === 0,
            Message: message,
            TrxFilePath: trxFilePath,
            CommandExecuted: commandExecuted
        };
        
        // Add to database
        database.Tests.push(entry);
        database.TotalRuns = database.Tests.length;
        database.LastUpdated = timestamp;
        
        // Write updated database back to file with pretty formatting
        await fs.promises.writeFile(databasePath, JSON.stringify(database, null, 2), 'utf8');
        
        // Enhanced logging output
        outputChannel.appendLine(`📊 === TEST RUN SUMMARY ===`);
        outputChannel.appendLine(`🆔 Run ID: ${runId}`);
        outputChannel.appendLine(`📁 Run Type: ${runType}`);
        outputChannel.appendLine(`📈 Results: ${passedTests} passed, ${failedTests} failed, ${skippedTests} skipped`);
        outputChannel.appendLine(`📂 Files Involved: ${filesInvolved.size}`);
        outputChannel.appendLine(`💾 Database: ${database.Tests.length} total runs stored`);
        outputChannel.appendLine(`✅ Test results saved to database.json`);
        
        // Show user notification for significant failures
        if (failedTests > 0) {
            const failedMethodNames = testMethods
                .filter(m => m.Outcome === 'Failed')
                .map(m => m.MethodName)
                .slice(0, 3); // Show first 3 failed tests
            
            const moreFailures = failedTests > 3 ? ` (and ${failedTests - 3} more)` : '';
            vscode.window.showWarningMessage(
                `${failedTests} test(s) failed: ${failedMethodNames.join(', ')}${moreFailures}`
            );
        }
        
    } catch (error) {
        console.error('Error saving test results to database:', error);
        outputChannel.appendLine(`❌ Error saving test results to database: ${error}`);
        vscode.window.showErrorMessage(`Failed to save test results to database: ${error}`);
    }
}

// Enhanced parseResultsAndUpdateDecorations function with database integration
async function parseResultsAndUpdateDecorations(
    trxFilePath: string, 
    fileUri: vscode.Uri | undefined, 
    testExplorerProvider: TestExplorerProvider,
    runType: 'AllTests' | 'FileTests' | 'FolderTests' | 'SingleMethod' = 'AllTests',
    targetInfo?: { file?: string; folder?: string; method?: string },
    commandExecuted?: string
) {
    try {
        outputChannel.appendLine(`\n--- Parsing Test Results ---`);
        outputChannel.appendLine(`Reading TRX file: ${trxFilePath}`);

        if (!fs.existsSync(trxFilePath)) {
            outputChannel.appendLine(`[ERROR] TRX file not found at path. Aborting.`);
            return;
        }

        const xmlContent = await fs.promises.readFile(trxFilePath, 'utf-8');
        const result = await parseXml(xmlContent);

        if (!result.TestRun?.Results?.[0]?.UnitTestResult || !result.TestRun?.TestDefinitions?.[0]?.UnitTest) {
            outputChannel.appendLine("[WARNING] TRX file was parsed, but seems empty or malformed.");
            return;
        }

        const unitTestResults = result.TestRun.Results[0].UnitTestResult;
        const testDefinitions = result.TestRun.TestDefinitions[0].UnitTest;
        outputChannel.appendLine(`Found ${unitTestResults.length} test results and ${testDefinitions.length} test definitions.`);

        const testDefsMap = new Map<string, any>(testDefinitions.map((def: any) => [def.$.id, def]));
        
        // Enhanced data structures for method-level tracking
        const fileTestResults = new Map<string, TestFileResult>();

        for (const testResult of unitTestResults) {
            const testId = testResult.$.testId;
            const outcome: 'Passed' | 'Failed' | string = testResult.$.outcome;
            const testDef = testDefsMap.get(testId);

            if (!testDef) continue;

            const fullClassName = testDef.TestMethod[0].$.className.split(',')[0];
            const testClassName = fullClassName.split('.').pop();
            
            // Extract method name from testResult first, then testDef as fallback
            let methodName = testResult.$.testName || 
                           testDef.TestMethod[0].$.testName || 
                           testDef.$.name || 
                           testDef.TestMethod[0].$.methodName;
            
            // If still no method name, try extracting from testResult testName
            if (!methodName && testResult.$.testName) {
                const parts = testResult.$.testName.split('.');
                methodName = parts[parts.length - 1];
            }
            
            // Clean up method name - remove namespace prefix if present
            if (methodName && methodName.includes('.')) {
                const parts = methodName.split('.');
                methodName = parts[parts.length - 1];
            }
            
            outputChannel.appendLine(`  Method: ${methodName}, Outcome: ${outcome}`);
            
            if (!methodName) {
                outputChannel.appendLine(`  WARNING: Could not determine method name for test ${testId}`);
                continue;
            }
            
            if (!testClassName) continue;

            // Get error message if test failed
            let errorMessage: string | undefined;
            if (outcome === 'Failed') {
                if (testResult.Output?.[0]?.ErrorInfo?.[0]?.Message?.[0]) {
                    errorMessage = testResult.Output[0].ErrorInfo[0].Message[0];
                } else if (testResult.Output?.[0]?.ErrorInfo?.[0]?.StackTrace?.[0]) {
                    errorMessage = testResult.Output[0].ErrorInfo[0].StackTrace[0];
                } else if (testResult.Output?.[0]?.StdOut?.[0]) {
                    errorMessage = testResult.Output[0].StdOut[0];
                } else {
                    errorMessage = `Test ${methodName} failed`;
                }
            }

            const globPattern = `**/${testClassName}.cs`;
            const matchingFiles = await vscode.workspace.findFiles(globPattern, '**/node_modules/**', 1);
            
            if (matchingFiles.length > 0) {
                const fileUri = matchingFiles[0];
                const filePath = fileUri.fsPath;
                
                if (!fileTestResults.has(filePath)) {
                    fileTestResults.set(filePath, {
                        filePath,
                        state: 'pass',
                        counts: { passed: 0, failed: 0 },
                        methods: []
                    });
                }
                
                const fileResult = fileTestResults.get(filePath)!;
                
                const methodResult: TestMethodResult = {
                    methodName,
                    outcome: outcome as 'Passed' | 'Failed',
                    errorMessage,
                    referencedFiles: []
                };
                
                fileResult.methods.push(methodResult);
                
                if (outcome === 'Failed') {
                    fileResult.state = 'fail';
                    fileResult.counts.failed++;
                } else if (outcome === 'Passed') {
                    fileResult.counts.passed++;
                }
            }
        }
        
        outputChannel.appendLine("\n--- Updating Decorations and Test Explorer ---");
        
        const testResults = Array.from(fileTestResults.values());
        
        testExplorerProvider.updateTestMethodResults(testResults);
        
        for (const fileResult of testResults) {
            const uri = vscode.Uri.file(fileResult.filePath);
            const counts = fileResult.counts;
            
            outputChannel.appendLine(`Updating: ${path.basename(fileResult.filePath)} -> ${fileResult.state.toUpperCase()} (${counts.passed} passed, ${counts.failed} failed)`);
            
            const failedMethods = fileResult.methods.filter(m => m.outcome === 'Failed');
            if (failedMethods.length > 0) {
                outputChannel.appendLine(`  Failed methods: ${failedMethods.map(m => m.methodName).join(', ')}`);
            }
            
            decorationProvider.updateState(uri, fileResult.state);
        }

        // 🆕 SAVE ENHANCED TEST RESULTS TO DATABASE
        const projectRootUri = await getProjectRoot();
        if (projectRootUri && testResults.length > 0) {
            await saveTestResultsToDatabase(
                testResults, 
                projectRootUri.fsPath, 
                runType, 
                targetInfo, 
                commandExecuted, 
                trxFilePath
            );
        }
        
        outputChannel.appendLine("---------------------------\n");

    } catch (e: any) {
        console.error("Failed to parse TRX file:", e);
        vscode.window.showErrorMessage("Failed to parse test results. See 'Test Runner' output.");
        outputChannel.appendLine(`[FATAL ERROR] Error during parsing: ${e.message}`);
    }
}
// --- Test Generation Logic ---

async function handleFileCreation(uri: vscode.Uri) {
    const projectRootUri = await getProjectRoot();
    if (!projectRootUri) return;

    const fileName = path.basename(uri.fsPath, '.cs');
    if (!fileName.includes('Controller') && !fileName.includes('Service')) return;
    if (fileName.includes('Tests')) return;

    const config = vscode.workspace.getConfiguration('controllerTestGenerator');
    const testDirectoryName = config.get<string>('testDirectory', 'Tests');
    const testDirectoryPath = path.join(projectRootUri.fsPath, testDirectoryName);

    if (path.normalize(uri.fsPath).startsWith(path.normalize(testDirectoryPath))) {
        return;
    }

    const type = fileName.includes('Controller') ? 'Controller' : 'Service';
    await createTestFile(uri, fileName, type);
}

async function createTestFile(sourceUri: vscode.Uri, sourceFileName: string, type: 'Controller' | 'Service') {
    const projectRootUri = await getProjectRoot();
    if (!projectRootUri) {
        vscode.window.showErrorMessage('Cannot create test file: No project root found.');
        return;
    }

    const config = vscode.workspace.getConfiguration('controllerTestGenerator');
    const testDirectoryRoot = config.get<string>('testDirectory', 'Tests');
    const subfolder = type === 'Controller' ? 'Controllers' : 'Service';

    const testFileName = `${sourceFileName}Tests.cs`;
    const testDirectoryPath = path.join(projectRootUri.fsPath, testDirectoryRoot, subfolder);
    const testFilePath = path.join(testDirectoryPath, testFileName);

    if (fs.existsSync(testFilePath)) {
        console.log(`Test file already exists, skipping: ${testFilePath}`);
        return;
    }

    fs.mkdirSync(testDirectoryPath, { recursive: true });
    const testContent = generateTestFileContent(sourceFileName, type);
    fs.writeFileSync(testFilePath, testContent);

    const action = await vscode.window.showInformationMessage(`Created ${testFileName}`, 'Open File');
    if (action === 'Open File') {
        await vscode.window.showTextDocument(vscode.Uri.file(testFilePath));
    }
}

function generateTestFileContent(sourceFileName: string, type: 'Controller' | 'Service'): string {
    const className = sourceFileName;
    const testClassName = `${sourceFileName}Tests`;

    return `using Xunit;
// Add relevant using statements for your project, e.g.:
// using Moq;
// using Microsoft.AspNetCore.Mvc;
// using YourProject.Controllers;

namespace YourProject.Tests.${type}s
{
    public class ${testClassName}
    {
        // Example with a mocked dependency
        // private readonly Mock<IMyService> _mockService;
        // private readonly ${className} _controller;

        public ${testClassName}()
        {
            // _mockService = new Mock<IMyService>();
            // _controller = new ${className}(_mockService.Object);
        }

        [Fact]
        public void SampleTest_ShouldReturnTrue_WhenConditionIsMet()
        {
            // Arrange

            // Act

            // Assert
            Assert.True(true);
        }
    }
}
`;
}

export function deactivate() {}