# xUnit-Test-Extension# xUnit Testing Extension for VS Code

Streamline your .NET testing workflow with the xUnit Testing Extension. This extension provides a dedicated Test Explorer, automates the creation of test files for your controllers and services, and offers a simple interface to run your xUnit tests directly within Visual Studio Code.

![xUnit Tester Demo](https://user-images.githubusercontent.com/1021434/230876936-234f9e05-3465-4a8f-84e6-bbc0322b724b.gif)  
*(It's highly recommended to replace this placeholder GIF with a real one showing your extension in action!)*

---

## Features

This extension is designed to boost your productivity when working with xUnit in a .NET project.

### 🧪 Dedicated Test Explorer

- **Focused View**: A new "xUnit Tester" icon appears in the Activity Bar, opening a view that lists *only* your test files (any file ending in `Tests.cs`).
- **One-Click Test Execution**: Run tests for a specific file by clicking the play icon that appears on hover.
- **Run All Tests**: A "Run All Tests" button is available at the top of the view to execute your entire test suite.
- **Auto-Refresh**: The explorer automatically updates when you create, delete, or rename test files. A manual refresh button is also provided.

![Test Explorer Screenshot](https://user-images.githubusercontent.com/1021434/230877028-1b7f7318-c21c-4375-9e63-71a74d7c07e2.png)

### 📄 Automatic Test File Generation

- **Smart Detection**: Automatically creates a corresponding test file when you create a new C# file ending in `Controller.cs` or `Service.cs`.
- **Organized Structure**: New test files are placed in a configurable test directory, under `Controllers` or `Services` subfolders.
- **Boilerplate Content**: The generated test file includes a basic xUnit class structure, `using` statements, and a sample test method to get you started immediately.
- **Manual Generation**: Right-click any `Controller.cs` or `Service.cs` file in the main File Explorer and select "Generate Test File" to create one on demand.

### ⚙️ Seamless Test Runner

- **Integrated Output**: Test results are displayed in a dedicated "Test Runner" output channel, showing the full `dotnet test` command and its results.
- **Context-Aware Commands**:
  - Run tests for the currently open file from the editor's title bar.
  - Run all tests from the Command Palette.

---

## Getting Started

1.  **Install the Extension**: Install "xUnit Testing Extension" from the Visual Studio Code Marketplace.
2.  **Open a .NET Project**: Open a folder containing your .NET solution.
3.  **Find the Test Explorer**: Click the new **beaker** (`🧪`) icon in the Activity Bar to open the xUnit Test Explorer.
4.  **Run Tests**:
    - Click the main play button at the top of the Test Explorer to run all tests.
    - Hover over a file in the list and click the inline play button to run tests for just that file.
5.  **Generate Tests**:
    - Create a new file, e.g., `ProductsController.cs`. The extension will automatically create `Tests/Controllers/ProductsControllerTests.cs`.
    - Or, right-click an existing `ProductsController.cs` and choose "Generate Test File".

---

## Requirements

- [.NET SDK](https://dotnet.microsoft.com/download) must be installed and available in your system's PATH.
- Your project must be configured to use [xUnit](https://xunit.net/).
- The `dotnet test` command must be able to run successfully from your workspace's root directory.

---

## Extension Settings

You can configure the extension's behavior by modifying the following settings in your `settings.json` file:

-   **`controllerTestGenerator.testDirectory`**: Specifies the name of the root directory where test files should be created.
    -   **Default**: `"Tests"`

**Example `/.vscode/settings.json`:**
```json
{
  "controllerTestGenerator.testDirectory": "MyProject.UnitTests"
}