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
exports.TestExplorerProvider = exports.TestTreeItem = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
class TestTreeItem extends vscode.TreeItem {
    label;
    collapsibleState;
    resourceUri;
    testState;
    counts;
    itemType;
    methodResult;
    parentFilePath;
    constructor(label, collapsibleState, resourceUri, testState, counts, itemType, methodResult, parentFilePath) {
        super(label, collapsibleState);
        this.label = label;
        this.collapsibleState = collapsibleState;
        this.resourceUri = resourceUri;
        this.testState = testState;
        this.counts = counts;
        this.itemType = itemType;
        this.methodResult = methodResult;
        this.parentFilePath = parentFilePath;
        this.resourceUri = resourceUri;
        // Set tooltip based on item type
        if (itemType === 'method' && methodResult?.errorMessage) {
            this.tooltip = `${methodResult.errorMessage}`;
        }
        else if (counts && (counts.passed > 0 || counts.failed > 0)) {
            this.tooltip = `Passed: ${counts.passed}, Failed: ${counts.failed}`;
        }
        else if (itemType === 'file') {
            this.tooltip = 'Click to open file';
        }
        else if (itemType === 'referencedFile') {
            this.tooltip = 'Referenced in test - click to open';
        }
        // Command to open file
        if (resourceUri && (itemType === 'file' || itemType === 'referencedFile')) {
            this.command = {
                command: 'vscode.open',
                title: 'Open',
                arguments: [resourceUri]
            };
        }
        else if (itemType === 'method' && parentFilePath && methodResult) {
            // For methods, use custom command to navigate to the specific method
            this.command = {
                command: 'controller-test-generator.navigateToTestMethod',
                title: 'Navigate to Test Method',
                arguments: [parentFilePath, methodResult.methodName]
            };
        }
        // Set context value and icon based on item type
        switch (itemType) {
            case 'folder':
                this.contextValue = 'testFolder';
                this.iconPath = new vscode.ThemeIcon('folder');
                break;
            case 'file':
                this.contextValue = 'testFile';
                break;
            case 'method':
                this.contextValue = 'testMethod';
                this.iconPath = new vscode.ThemeIcon(methodResult?.outcome === 'Failed' ? 'error' : 'check');
                break;
            case 'referencedFile':
                this.contextValue = 'referencedFile';
                this.iconPath = new vscode.ThemeIcon('file-code');
                break;
        }
    }
}
exports.TestTreeItem = TestTreeItem;
class TestExplorerProvider {
    workspaceRoot;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    // Enhanced tracking for method-level results
    testFileResults = new Map();
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }
    updateTestState(uri, state, counts) {
        // Keep the old simple tracking for backward compatibility
        const filePath = uri.fsPath;
        if (!this.testFileResults.has(filePath)) {
            this.testFileResults.set(filePath, {
                filePath,
                state,
                counts: counts || { passed: 0, failed: 0 },
                methods: []
            });
        }
        else {
            const existing = this.testFileResults.get(filePath);
            existing.state = state;
            existing.counts = counts || existing.counts;
        }
        this.refresh();
    }
    updateTestMethodResults(testResults) {
        // Clear existing results
        this.testFileResults.clear();
        // Store new results
        for (const result of testResults) {
            this.testFileResults.set(result.filePath, result);
        }
        this.refresh();
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (!this.workspaceRoot) {
            vscode.window.showInformationMessage('No tests in empty workspace');
            return [];
        }
        if (!element) {
            // Root level - return folder categories
            return this.createFolderNodes();
        }
        else if (element.itemType === 'folder') {
            // Folder level - return test files for this category
            const cleanFolderName = element.label.replace(/^[✅❌]\s*/, '').replace(/\s*\(\d+\)$/, '');
            return this.getTestFilesForCategory(cleanFolderName);
        }
        else if (element.itemType === 'file') {
            // File level - return failed test methods if any
            return this.getFailedMethodsForFile(element.resourceUri.fsPath);
        }
        else if (element.itemType === 'method') {
            // Method level - return referenced files
            return this.getReferencedFilesForMethod(element.methodResult, element.parentFilePath);
        }
        else {
            // Referenced file level - no children
            return [];
        }
    }
    async createFolderNodes() {
        const folders = ['Controllers', 'Services'];
        const folderNodes = [];
        for (const folderName of folders) {
            const testFiles = await this.getTestFilesForCategory(folderName);
            let totalPassed = 0;
            let totalFailed = 0;
            let hasFailures = false;
            let hasTests = false;
            for (const testFile of testFiles) {
                const result = this.testFileResults.get(testFile.resourceUri.fsPath);
                if (result && (result.counts.passed > 0 || result.counts.failed > 0)) {
                    hasTests = true;
                    totalPassed += result.counts.passed;
                    totalFailed += result.counts.failed;
                }
                if (result?.state === 'fail') {
                    hasFailures = true;
                }
            }
            let folderLabel = folderName;
            if (hasTests) {
                const statusIcon = hasFailures ? '❌' : '✅';
                folderLabel = `${statusIcon} ${folderName} (${totalPassed + totalFailed})`;
            }
            else if (testFiles.length > 0) {
                folderLabel = `${folderName} (${testFiles.length})`;
            }
            if (testFiles.length > 0) {
                folderNodes.push(new TestTreeItem(folderLabel, vscode.TreeItemCollapsibleState.Expanded, undefined, undefined, { passed: totalPassed, failed: totalFailed }, 'folder'));
            }
        }
        return folderNodes;
    }
    async getTestFilesForCategory(categoryName) {
        try {
            const testFiles = await vscode.workspace.findFiles('**/*Tests.cs', '**/node_modules/**');
            const filteredFiles = testFiles.filter(file => {
                try {
                    return this.categorizeTestFile(file) === categoryName;
                }
                catch (error) {
                    console.error(`Error categorizing file ${file.fsPath}:`, error);
                    return false;
                }
            });
            const treeItems = filteredFiles.map(file => {
                const fileName = path.basename(file.fsPath);
                const result = this.testFileResults.get(file.fsPath);
                let displayLabel = fileName;
                let collapsibleState = vscode.TreeItemCollapsibleState.None;
                if (result) {
                    if (result.state === 'pass') {
                        displayLabel = `✅ ${fileName}`;
                    }
                    else if (result.state === 'fail') {
                        const failCount = result.counts.failed || 0;
                        displayLabel = `❌ ${fileName} (${failCount} failed)`;
                        // Make failed files expandable to show failed methods
                        collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
                    }
                }
                return new TestTreeItem(displayLabel, collapsibleState, file, result?.state, result?.counts, 'file');
            });
            return treeItems.sort((a, b) => {
                const aResult = this.testFileResults.get(a.resourceUri.fsPath);
                const bResult = this.testFileResults.get(b.resourceUri.fsPath);
                if (aResult?.state === 'fail' && bResult?.state !== 'fail')
                    return -1;
                if (aResult?.state !== 'fail' && bResult?.state === 'fail')
                    return 1;
                if (aResult?.state === 'pass' && !bResult?.state)
                    return -1;
                if (!aResult?.state && bResult?.state === 'pass')
                    return 1;
                return a.label.localeCompare(b.label);
            });
        }
        catch (error) {
            console.error(`Error getting test files for category ${categoryName}:`, error);
            return [];
        }
    }
    async getFailedMethodsForFile(filePath) {
        const result = this.testFileResults.get(filePath);
        if (!result)
            return [];
        // Only show failed methods
        const failedMethods = result.methods.filter(method => method.outcome === 'Failed');
        return failedMethods.map(method => {
            const shortError = method.errorMessage ?
                method.errorMessage.split('\n')[0].substring(0, 100) + '...' :
                'Test failed';
            return new TestTreeItem(`❌ ${method.methodName}`, vscode.TreeItemCollapsibleState.Collapsed, // Always make failed methods expandable
            undefined, 'fail', undefined, 'method', method, filePath);
        });
    }
    async getReferencedFilesForMethod(methodResult, testFilePath) {
        console.log(`Getting referenced files for method: ${methodResult.methodName} in file: ${testFilePath}`);
        if (!methodResult.referencedFiles || methodResult.referencedFiles.length === 0) {
            // If no referenced files found, try to analyze the test method
            console.log(`No cached referenced files, analyzing method...`);
            const referencedFiles = await this.analyzeTestMethodReferences(methodResult.methodName, testFilePath);
            methodResult.referencedFiles = referencedFiles;
            console.log(`Analysis found ${referencedFiles.length} referenced files:`, referencedFiles);
        }
        if (!methodResult.referencedFiles || methodResult.referencedFiles.length === 0) {
            console.log(`No referenced files found for ${methodResult.methodName}`);
            // Return a placeholder item indicating no files found
            return [new TestTreeItem('📄 No referenced files found', vscode.TreeItemCollapsibleState.None, undefined, undefined, undefined, 'referencedFile')];
        }
        const treeItems = [];
        for (const refFile of methodResult.referencedFiles) {
            try {
                const uri = vscode.Uri.file(refFile);
                const fileName = path.basename(refFile);
                treeItems.push(new TestTreeItem(`📄 ${fileName}`, vscode.TreeItemCollapsibleState.None, uri, undefined, undefined, 'referencedFile'));
            }
            catch (error) {
                console.error(`Error creating tree item for referenced file ${refFile}:`, error);
            }
        }
        console.log(`Returning ${treeItems.length} tree items for referenced files`);
        return treeItems;
    }
    async analyzeTestMethodReferences(methodName, testFilePath) {
        console.log('🚀 USING NEW ENHANCED ANALYSIS VERSION 2.0 🚀');
        try {
            console.log(`\n=== Analyzing references for method: ${methodName} ===`);
            const testFileContent = await fs.promises.readFile(testFilePath, 'utf8');
            const referencedFiles = [];
            // First, analyze the entire test class to understand dependencies
            const classAnalysis = this.analyzeTestClassDependencies(testFileContent);
            // Find the specific test method
            const escapedMethodName = methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const methodPatterns = [
                new RegExp(`(public|private|internal)?\\s*(async\\s+)?(void|Task)\\s+${escapedMethodName}\\s*\\([^)]*\\)\\s*{([\\s\\S]*?)^\\s*}`, 'm'),
                new RegExp(`\\[(?:Fact|Theory)[\\s\\S]*?${escapedMethodName}[\\s\\S]*?{([\\s\\S]*?)^\\s*}`, 'm')
            ];
            let methodBody = '';
            for (const pattern of methodPatterns) {
                const match = testFileContent.match(pattern);
                if (match) {
                    methodBody = match[0];
                    console.log(`✓ Found method, body length: ${methodBody.length} chars`);
                    break;
                }
            }
            if (!methodBody) {
                console.log(`❌ Could not find method ${methodName} in test file`);
                return [];
            }
            // Analyze what variables/services are used in this specific method
            const usedVariables = this.findUsedVariablesInMethod(methodBody);
            // Map used variables to their types using class-level analysis
            const referencedTypes = new Set();
            for (const variable of usedVariables) {
                const type = classAnalysis.fieldTypes.get(variable) || classAnalysis.mockTypes.get(variable);
                if (type) {
                    referencedTypes.add(type);
                    console.log(`✓ ${variable} -> ${type}`);
                }
            }
            // Add all mock types as they're likely dependencies
            for (const mockType of classAnalysis.mockTypes.values()) {
                referencedTypes.add(mockType);
            }
            console.log(`Final referenced types:`, Array.from(referencedTypes));
            // Find actual files for these types
            for (const typeName of referencedTypes) {
                await this.findFilesForType(typeName, referencedFiles);
            }
            // If still no files found, try fallback search
            if (referencedFiles.length === 0) {
                console.log('No files found with type analysis, trying fallback...');
                await this.fallbackFileSearch(methodName, referencedFiles);
            }
            console.log(`=== Final result: ${referencedFiles.length} referenced files ===`);
            console.log(referencedFiles);
            return referencedFiles;
        }
        catch (error) {
            console.error(`Error analyzing test method references for ${methodName}:`, error);
            return [];
        }
    }
    categorizeTestFile(fileUri) {
        const filePath = fileUri.fsPath;
        const fileName = path.basename(filePath, '.cs');
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
        const baseFileName = fileName.replace(/Tests$/, '');
        if (baseFileName.includes('Controller')) {
            return 'Controllers';
        }
        if (baseFileName.includes('Service')) {
            return 'Services';
        }
        return 'Controllers';
    }
    pathExists(p) {
        try {
            fs.accessSync(p);
        }
        catch (err) {
            return false;
        }
        return true;
    }
    analyzeTestClassDependencies(fileContent) {
        const fieldTypes = new Map();
        const mockTypes = new Map();
        const constructorParams = new Map();
        console.log('=== Analyzing Test Class Dependencies ===');
        // Find field declarations: private readonly UserService _userService;
        const fieldPatterns = [
            /private\s+(?:readonly\s+)?([A-Z][a-zA-Z]*(?:<[^>]+>)?)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*;/g,
            /private\s+([A-Z][a-zA-Z]*(?:<[^>]+>)?)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*;/g,
            /(?:private\s+)?(?:readonly\s+)?([A-Z][a-zA-Z]*(?:<[^>]+>)?)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*;/g
        ];
        for (const pattern of fieldPatterns) {
            let match;
            while ((match = pattern.exec(fileContent)) !== null) {
                const type = match[1];
                const fieldName = match[2];
                if (!fieldTypes.has(fieldName)) { // Avoid duplicates from multiple patterns
                    fieldTypes.set(fieldName, type);
                    console.log(`✓ Field found: ${fieldName} -> ${type}`);
                }
            }
        }
        // Find Mock declarations: Mock<IUserService> _mockUserService;
        const mockPattern = /Mock<([A-Z][a-zA-Z]*(?:<[^>]+>)?)>\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
        let mockMatch;
        while ((mockMatch = mockPattern.exec(fileContent)) !== null) {
            const type = mockMatch[1];
            const mockName = mockMatch[2];
            mockTypes.set(mockName, type);
            // Also map the .Object property (common pattern: _mockService.Object)
            const objectName = mockName.replace(/^_mock/, '_').replace(/^mock/, '');
            fieldTypes.set(objectName, type);
            console.log(`✓ Mock found: ${mockName} -> ${type}, Object: ${objectName} -> ${type}`);
        }
        // Find constructor parameters - look for constructor assignments too
        const constructorPattern = /public\s+\w+\s*\(([^)]*)\)/;
        const constructorMatch = fileContent.match(constructorPattern);
        if (constructorMatch && constructorMatch[1].trim()) {
            const params = constructorMatch[1].split(',');
            for (const param of params) {
                const parts = param.trim().match(/([A-Z][a-zA-Z]*(?:<[^>]+>)?)\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
                if (parts) {
                    const type = parts[1];
                    const paramName = parts[2];
                    constructorParams.set(paramName, type);
                    console.log(`✓ Constructor param: ${paramName} -> ${type}`);
                }
            }
        }
        // Also look for direct instantiations in constructor: _userService = new UserService();
        const instantiationPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*new\s+([A-Z][a-zA-Z]*(?:<[^>]+>)?)\s*\(/g;
        let instMatch;
        while ((instMatch = instantiationPattern.exec(fileContent)) !== null) {
            const fieldName = instMatch[1];
            const type = instMatch[2];
            fieldTypes.set(fieldName, type);
            console.log(`✓ Instantiation found: ${fieldName} -> ${type}`);
        }
        console.log(`=== Summary ===`);
        console.log(`Fields found: ${fieldTypes.size}`);
        console.log(`Mocks found: ${mockTypes.size}`);
        console.log(`Constructor params found: ${constructorParams.size}`);
        return { fieldTypes, mockTypes, constructorParams };
    }
    findUsedVariablesInMethod(methodBody) {
        const variables = new Set();
        console.log('=== Finding Used Variables in Method ===');
        console.log('Method body sample:', methodBody.substring(0, 200) + '...');
        // Find variable usage: _userService.Method(), await _service.Call()
        const usagePattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*\./g;
        let match;
        while ((match = usagePattern.exec(methodBody)) !== null) {
            const varName = match[1];
            variables.add(varName);
            console.log(`✓ Variable usage found: ${varName}`);
        }
        // Find assignments and declarations: var result = _service.Method()
        const assignmentPattern = /=\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\./g;
        while ((match = assignmentPattern.exec(methodBody)) !== null) {
            const varName = match[1];
            variables.add(varName);
            console.log(`✓ Assignment usage found: ${varName}`);
        }
        // Also look for await patterns: await _service.Method()
        const awaitPattern = /await\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\./g;
        while ((match = awaitPattern.exec(methodBody)) !== null) {
            const varName = match[1];
            variables.add(varName);
            console.log(`✓ Await usage found: ${varName}`);
        }
        const result = Array.from(variables);
        console.log(`=== Total variables found: ${result.length} ===`);
        console.log(result);
        return result;
    }
    async findFilesForType(typeName, referencedFiles) {
        console.log(`=== Finding Files for Type: ${typeName} ===`);
        // Remove interface prefix if present
        const baseTypeName = typeName.startsWith('I') && typeName.length > 1 && /^I[A-Z]/.test(typeName)
            ? typeName.substring(1)
            : typeName;
        // Remove generic type parameters: List<User> -> List, IRepository<User> -> IRepository
        const cleanTypeName = typeName.replace(/<.*>/, '');
        const cleanBaseTypeName = baseTypeName.replace(/<.*>/, '');
        const possibleFileNames = [
            `${cleanTypeName}.cs`,
            `${cleanBaseTypeName}.cs` // UserService.cs (from IUserService)
        ];
        console.log(`Searching for files: ${possibleFileNames.join(', ')}`);
        for (const fileName of possibleFileNames) {
            console.log(`Searching for pattern: **/${fileName}`);
            const files = await vscode.workspace.findFiles(`**/${fileName}`, '**/node_modules/**');
            console.log(`Found ${files.length} files matching ${fileName}:`);
            for (const file of files) {
                console.log(`  - ${file.fsPath}`);
            }
            for (const file of files) {
                const isTestFile = file.fsPath.includes('Tests') || file.fsPath.includes('Test');
                const isBinObj = file.fsPath.includes('/bin/') || file.fsPath.includes('/obj/');
                const alreadyAdded = referencedFiles.includes(file.fsPath);
                console.log(`  Evaluating ${file.fsPath}:`);
                console.log(`    - Is test file: ${isTestFile}`);
                console.log(`    - Is bin/obj: ${isBinObj}`);
                console.log(`    - Already added: ${alreadyAdded}`);
                if (!isTestFile && !isBinObj && !alreadyAdded) {
                    referencedFiles.push(file.fsPath);
                    console.log(`    ✓ ADDED: ${file.fsPath}`);
                }
                else {
                    console.log(`    ✗ SKIPPED: ${file.fsPath}`);
                }
            }
        }
        console.log(`=== Files found for ${typeName}: ${referencedFiles.length} total ===`);
    }
    async fallbackFileSearch(methodName, referencedFiles) {
        console.log(`=== Fallback File Search for Method: ${methodName} ===`);
        // Extract meaningful words from method name
        const methodWords = methodName.replace(/([A-Z])/g, ' $1').trim().split(/\s+|_/)
            .filter(word => word.length > 3 && !['Test', 'Should', 'When', 'Then', 'Given', 'Async'].includes(word));
        console.log(`Fallback: Searching for files containing: ${methodWords.join(', ')}`);
        for (const word of methodWords) {
            console.log(`Searching for pattern: **/*${word}*.cs`);
            const files = await vscode.workspace.findFiles(`**/*${word}*.cs`, '**/node_modules/**');
            console.log(`Found ${files.length} files containing "${word}":`);
            for (const file of files) {
                console.log(`  - ${file.fsPath}`);
            }
            for (const file of files) {
                const isTestFile = file.fsPath.includes('Tests') || file.fsPath.includes('Test');
                const isBinObj = file.fsPath.includes('/bin/') || file.fsPath.includes('/obj/');
                const alreadyAdded = referencedFiles.includes(file.fsPath);
                if (!isTestFile && !isBinObj && !alreadyAdded) {
                    referencedFiles.push(file.fsPath);
                    console.log(`    ✓ ADDED (fallback): ${file.fsPath}`);
                }
            }
        }
        console.log(`=== Fallback search complete. Total files now: ${referencedFiles.length} ===`);
    }
}
exports.TestExplorerProvider = TestExplorerProvider;
//# sourceMappingURL=TestExplorerProvider.js.map