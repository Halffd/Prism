# Prism

<a alt="Nx logo" href="https://nx.dev" target="_blank" rel="noreferrer"><img src="https://raw.githubusercontent.com/nrwl/nx/master/images/nx-logo.png" width="45"></a>

✨ Your new, shiny [Nx workspace](https://nx.dev) is almost ready ✨.

[Learn more about this workspace setup and its capabilities](https://nx.dev/nx-api/expo?utm_source=nx_project&amp;utm_medium=readme&amp;utm_campaign=nx_projects) or run `npx nx graph` to visually explore what was created. Now, let's get you up to speed!

## Finish your CI setup

[Click here to finish setting up your workspace!](https://cloud.nx.app/connect/06GaHLZmgg)


## Run tasks

To run the dev server for your app, use:

```sh
npx nx serve Prism
```

To create a production bundle:

```sh
npx nx build Prism
```

To see all available targets to run for a project, run:

```sh
npx nx show project Prism
```

These targets are either [inferred automatically](https://nx.dev/concepts/inferred-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) or defined in the `project.json` or `package.json` files.

[More about running tasks in the docs &raquo;](https://nx.dev/features/run-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## AI Provider Support

Prism now supports multiple AI provider services:

- **OpenAI (ChatGPT)**: Use GPT models for advanced language understanding
- **Google Gemini**: Access Google's state-of-the-art Gemini models
- **Alibaba Qwen**: Leverage Alibaba's powerful Qwen language models
- **Prism API**: Connect to your own custom Prism backend service

### Configuration

You can configure the AI provider and settings in each application:

#### Expo App (Mobile)
1. Navigate to the Settings screen
2. Select your preferred AI provider from the dropdown
3. Enter your API key (for OpenAI, Gemini, or Qwen)
4. Optionally specify a custom model name

#### Web App
1. Click the "⚙️ Settings" button in the chat interface
2. Choose your AI provider from the dropdown
3. Enter your API key if using OpenAI, Gemini, or Qwen
4. Save your settings

#### Browser Extension
1. Click the gear icon (⚙️) in the popup interface
2. Select your AI provider
3. Enter your API key and model settings
4. Click "Save Settings" to apply changes

## New Features

### Markdown Support
All applications now support rich markdown formatting in chat messages, including:

- **Headers**: `# Header`, `## Subheader`
- **Text styling**: `**bold**`, `*italic*`, `~~strikethrough~~`
- **Lists**: Both ordered and unordered lists
- **Code blocks**: Syntax highlighting for multiple programming languages
- **Links and images**: Embedded links and image support
- **Tables**: Data tables with alignment support

### Code Syntax Highlighting
The extension and web app now highlight code in messages with support for over 100 programming languages, including:

- JavaScript, TypeScript, Python, Java, C++, C#
- HTML, CSS, SQL, Go, Rust, PHP, Ruby, Swift
- And many more languages with accurate syntax highlighting

### Floating Chat Icon
The browser extension now displays a floating chat icon on every webpage:

- Positioned in the top-right corner for easy access
- Diamond-shaped icon with gradient styling
- Click the icon to instantly open the chat interface
- Right-click the icon to hide it temporarily
- Automatically reappears on page navigation

### Chat History and Session Management
- **Persistent Chat Sessions**: Your conversations are saved automatically and can be resumed later
- **Multiple Sessions**: Create and switch between different chat contexts
- **Session Organization**: Manage and organize your chat history with titled sessions
- **Cross-Platform Sync**: Chat history syncs across extension, web, and mobile apps

### Enhanced Menu System
- **Navigation Menu**: Access all app features from a centralized menu
- **Session Switching**: Quickly switch between different chat sessions
- **Quick Actions**: Access common functions like settings and clearing history
- **Prompt Shortcuts**: Access your saved prompts directly from the menu

### Prompt Shortcuts
- **Save Common Prompts**: Store frequently used prompts for quick access
- **Categorization**: Organize prompts into different categories
- **Quick Insertion**: One-click insertion of saved prompts into the chat input
- **Manage Library**: Add, edit, and delete prompts as needed

### Performance Caching
- **Response Caching**: Frequently asked questions are cached for faster response times
- **Intelligent Expiration**: Cached responses expire after 1 hour to ensure freshness
- **Offline Availability**: Cached content available even when offline
- **Reduced API Calls**: Decreases API usage by avoiding duplicate requests

### Local and Online Storage
- **IndexedDB Storage**: Local NoSQL database for fast offline access
- **Cloud Sync**: Optional online synchronization with secure API endpoints
- **Data Encryption**: All synced data encrypted in transit and at rest
- **Conflict Resolution**: Smart merging of local and remote changes

## Add new projects

While you could add new projects to your workspace manually, you might want to leverage [Nx plugins](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) and their [code generation](https://nx.dev/features/generate-code?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) feature.

Use the plugin's generator to create new projects.

To generate a new application, use:

```sh
npx nx g @nx/expo:app demo
```

To generate a new library, use:

```sh
npx nx g @nx/react:lib mylib
```

You can use `npx nx list` to get a list of installed plugins. Then, run `npx nx list <plugin-name>` to learn about more specific capabilities of a particular plugin. Alternatively, [install Nx Console](https://nx.dev/getting-started/editor-setup?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) to browse plugins and generators in your IDE.

[Learn more about Nx plugins &raquo;](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) | [Browse the plugin registry &raquo;](https://nx.dev/plugin-registry?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)


[Learn more about Nx on CI](https://nx.dev/ci/intro/ci-with-nx#ready-get-started-with-your-provider?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Install Nx Console

Nx Console is an editor extension that enriches your developer experience. It lets you run tasks, generate code, and improves code autocompletion in your IDE. It is available for VSCode and IntelliJ.

[Install Nx Console &raquo;](https://nx.dev/getting-started/editor-setup?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Useful links

Learn more:

- [Learn more about this workspace setup](https://nx.dev/nx-api/expo?utm_source=nx_project&amp;utm_medium=readme&amp;utm_campaign=nx_projects)
- [Learn about Nx on CI](https://nx.dev/ci/intro/ci-with-nx?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Releasing Packages with Nx release](https://nx.dev/features/manage-releases?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [What are Nx plugins?](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

And join the Nx community:
- [Discord](https://go.nx.dev/community)
- [Follow us on X](https://twitter.com/nxdevtools) or [LinkedIn](https://www.linkedin.com/company/nrwl)
- [Our Youtube channel](https://www.youtube.com/@nxdevtools)
- [Our blog](https://nx.dev/blog?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
