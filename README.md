# xUnit Testing Extension

A powerful Visual Studio Code extension that enhances .NET testing workflows with intelligent test organization, execution, and AI-powered test generation.

![xUnit Tester](https://img.shields.io/badge/VS%20Code-Extension-blue)
![.NET](https://img.shields.io/badge/.NET-8.0-purple)
![xUnit](https://img.shields.io/badge/xUnit-Testing-green)

## ✨ Features

### 🗂️ **Smart Test Organization**
- **Hierarchical Test Explorer**: Automatically organizes your test files into `Controllers` and `Services` folders
- **Visual Status Indicators**: See pass/fail status at a glance with color-coded icons and counts
- **Failed Test Drilling**: Expand failed test files to see individual failing test methods

### 🔍 **Intelligent Failure Analysis**
- **Method-Level Details**: View exactly which test methods failed within a file
- **Source File Detection**: Automatically discovers and displays the source files referenced by failing tests
- **Smart Navigation**: Click on test methods to jump directly to the failing test code

### ⚡ **Flexible Test Execution**
- **Run All Tests**: Execute your entire test suite with one click
- **Category Testing**: Run all Controller tests or all Service tests separately  
- **File-Level Testing**: Run tests for a specific test file
- **Method-Level Testing**: Execute individual failing test methods
- **Terminal Integration**: Run tests in the integrated terminal when needed

### 🤖 **AI-Powered Test Generation**
- **GPT Integration**: Generate comprehensive test files using OpenAI's GPT models
- **Context-Aware**: Uses existing test files as examples for consistent coding style
- **Live Streaming**: Watch your tests being generated in real-time
- **Smart Templates**: Automatically creates test file templates for new Controllers and Services

### 🎯 **Developer Experience**
- **Real-time Updates**: Test results update automatically as you run tests
- **File Decorations**: See test status directly in the file explorer
- **Error Tooltips**: Hover over failed tests to see error messages
- **Quick Actions**: Right-click context menus for common operations

## 📦 Installation

1. Open Visual Studio Code
2. Go to the Extensions view (`Ctrl+Shift+X`)
3. Search for "xUnit Testing Extension"
4. Click Install

## 🚀 Quick Start

1. **Open a .NET project** with xUnit tests
2. **View the Test Explorer** in the Activity Bar (look for the checklist icon)
3. **Run tests** by clicking the play button next to any folder or file
4. **Explore failures** by expanding failed test files to see individual methods
5. **Navigate to code** by clicking on test methods or referenced files

## 🏗️ Project Structure

The extension works best with this recommended structure:

```
YourProject/
├── Controllers/
│   ├── UserController.cs
│   └── ProductController.cs
├── Services/
│   ├── UserService.cs
│   └── ProductService.cs
└── Tests/
    ├── Controllers/
    │   ├── UserControllerTests.cs
    │   └── ProductControllerTests.cs
    └── Services/
        ├── UserServiceTests.cs
        └── ProductServiceTests.cs
```

## ⚙️ Configuration

### Required Settings

For AI test generation, configure your OpenAI API key:

```json
{
  "controllerTestGenerator.openAIApiKey": "your-api-key-here"
}
```

### Optional Settings

```json
{
  // Project structure
  "xunit-tester.projectRootPath": "",
  "controllerTestGenerator.testDirectory": "Tests",
  "xunit-tester.resultsPath": "TestResults",
  
  // AI Configuration
  "controllerTestGenerator.openAIApiModel": "gpt-4o-mini",
  "controllerTestGenerator.openAIApiTemp": 0.2,
  "controllerTestGenerator.openAIApiMaxTokens": 10000
}
```

## 🎮 Commands

| Command | Description |
|---------|-------------|
| `Run All Tests` | Execute all tests in the project |
| `Run Tests in Folder` | Run all Controller or Service tests |
| `Run Tests for File` | Execute tests in a specific file |
| `Run Single Test Method` | Execute an individual test method |
| `Generate Tests with AI` | Create tests using GPT |
| `Generate Test File` | Create a basic test template |
| `Refresh Test Explorer` | Reload the test tree view |
| `Clear Test Results` | Reset all test status indicators |

## 🖱️ Usage Examples

### Running Tests

**Folder Level:**
```
✅ Controllers (25) ← Click play button to run all Controller tests
├── ✅ UserControllerTests.cs
└── ❌ ProductControllerTests.cs (2 failed)
```

**Method Level:**
```
❌ UserServiceTests.cs (1 failed)
  └── ❌ GetAllUsersAsync_ShouldReturnAllUsers ← Click to navigate to method
      ├── 📄 UserService.cs ← Click to view source file
      └── 📄 IUserRepository.cs
```

### Test Generation

1. Right-click on a test file in the explorer
2. Select "Generate Tests with GPT-4o-mini"
3. Watch as comprehensive tests are generated in real-time
4. Review and customize the generated tests

### Navigation

- **Click test methods** → Jump directly to the test code
- **Click source files** → Open referenced implementation files
- **Hover over failures** → See error messages and stack traces

## 🔧 Development

### Prerequisites

- Node.js 16.x or higher
- Visual Studio Code 1.74.0 or higher
- .NET 8 SDK

### Building from Source

```bash
# Clone the repository
git clone <repository-url>
cd xunit-testing-extension

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Package the extension (optional)
vsce package
```

### Project Structure

```
src/
├── extension.ts              # Main extension entry point
├── TestExplorerProvider.ts   # Tree view and test organization
├── TestResultDecorationProvider.ts  # File decorations
└── package.json             # Extension manifest
```

## 🤝 Contributing

We welcome contributions! Please feel free to submit issues and pull requests.

### Development Guidelines

1. Follow TypeScript best practices
2. Add tests for new features
3. Update documentation for user-facing changes
4. Use meaningful commit messages

## 📋 Requirements

- **.NET 8 or higher**: For running xUnit tests
- **xUnit Framework**: Test framework dependency
- **OpenAI API Key**: Required for AI test generation features (optional)

## 🐛 Known Issues

- Test file categorization requires either folder structure or naming conventions
- AI test generation requires internet connection and OpenAI API access
- Very large test suites may experience performance impacts

## 📚 FAQ

**Q: How does the extension categorize tests?**
A: Tests are categorized by folder structure (Controllers/, Services/) or by naming convention (ControllerTests, ServiceTests).

**Q: Can I use this without OpenAI?**
A: Yes! The AI features are optional. All test execution and organization features work without an API key.

**Q: Does this work with other test frameworks?**
A: Currently optimized for xUnit, but basic functionality works with other .NET test frameworks.

**Q: How do I configure the project root?**
A: Set `xunit-tester.projectRootPath` to point to your solution or project folder.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built for the .NET and xUnit testing community
- Powered by OpenAI's GPT models for AI features
- Inspired by modern testing workflows and developer productivity tools

---

**Happy Testing!** 🧪✨

For support, feature requests, or bug reports, please visit our [GitHub repository](https://github.com/your-repo/xunit-testing-extension).