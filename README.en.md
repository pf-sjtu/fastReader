<p align="center"><img src="public/logo.svg" width="88" alt="Juhua"></p>

<h1 align="center">Juhua</h1>

<p align="center">Savor a whole book, keep the essence</p>

> The name comes from Han Yu's *Jin Xue Jie*: "savor the blossoms, chew the essence" (含英咀华).

Juhua is an AI close-reading tool for EPUB / PDF: chapter summaries, mind maps, cross-chapter connections and a whole-book overview,
with configuration and reading history shared by the whole team.

> Formerly *fastReader*. The repository, the Cloudflare Pages project (`fast-read`), storage keys and CLI env vars (`FASTREADER_*`) keep the old name for compatibility.

## ✨ Features

### 📚 Multi-format Support

- **EPUB Files**: Complete support for parsing and processing EPUB format e-books
- **PDF Files**: Intelligent PDF document parsing with table of contents-based and smart chapter extraction

### 🤖 AI-Powered Content Processing

- **Multiple AI Services**: Support for Google Gemini and OpenAI GPT models
- **Three Processing Modes**:
  - 📝 **Text Summary Mode**: Generate chapter summaries, analyze chapter relationships, output complete book summary
  - 🧠 **Chapter Mind Map Mode**: Generate independent mind maps for each chapter
  - 🌐 **Whole Book Mind Map Mode**: Integrate entire book content into one comprehensive mind map

### 🎯 Smart Chapter Processing

- **Intelligent Chapter Detection**: Automatically identify and extract book chapter structure
- **Chapter Filtering**: Support skipping prefaces, table of contents, acknowledgments and other non-core content
- **Flexible Selection**: Users can freely choose chapters to process
- **Sub-chapter Support**: Configurable sub-chapter extraction depth

### 💾 Efficient Caching Mechanism

- **Smart Caching**: Automatically cache AI processing results to avoid redundant computation
- **Cache Management**: Support clearing cache by mode to save storage space
- **Offline Viewing**: Processed content can be viewed offline

### 🎨 Modern Interface

- **Responsive Design**: Adapts to various screen sizes
- **Real-time Progress**: Visualized processing with real-time step display
- **Interactive Mind Maps**: Support zooming, dragging, node expand/collapse
- **Content Preview**: Support viewing original chapter content
- **Reading Controls**: Font size adjustment and fullscreen mode for better reading experience
- **Theme Support**: Complete dark/light theme support with automatic system theme detection

### 🌐 Enhanced Reading Experience

- **Font Size Control**: Adjustable font size (12px-24px) for EPUB content preview
- **Fullscreen Mode**: Immersive reading experience with fullscreen toggle
- **Adaptive Layout**: Content area automatically adjusts to screen height in fullscreen
- **Theme Consistency**: Preview content follows the selected theme (light/dark/system)

### ☁️ Cloud Sync & Storage

- **WebDAV Support**: Upload and sync mind maps to WebDAV cloud storage
- **Multiple Providers**: Support for坚果云, Nextcloud, ownCloud and other WebDAV services
- **Overwrite Protection**: Smart file existence checking with overwrite confirmation
- **Auto Sync**: Automatic synchronization to cloud storage after processing

## 🚀 Quick Start

### Requirements

- Node.js 18+
- pnpm (recommended) or npm

### Install Dependencies

```bash
# Clone the project
git clone https://github.com/SSShooter/ebook-to-mindmap
cd ebook-to-mindmap

# Install dependencies
pnpm install
# or
npm install
```

### Start Development Server

```bash
pnpm dev
# or
npm run dev
```

Visit `http://localhost:5173` to start using.

## 📁 Project Structure

```
ebook-to-mindmap/
├── 📄 package.json              # Project dependencies and scripts
├── 📄 index.html                 # Entry HTML file
├── 📄 .env                       # Environment variables configuration
├── 📄 .gitignore                 # Git ignore rules
├── 📁 src/                       # Source code directory
│   ├── 📁 components/            # React components
│   │   ├── 📁 ui/               # Basic UI components
│   │   ├── 📁 project/          # Project-related components
│   │   └── 📄 *.tsx              # Other functional components
│   ├── 📁 services/             # Service layer
│   │   ├── 📄 aiService.ts      # AI service
│   │   ├── 📄 pdfProcessor.ts   # PDF processing
│   │   └── 📄 *.ts              # Other services
│   ├── 📁 stores/               # State management
│   ├── 📁 hooks/                # Custom Hooks
│   ├── 📁 i18n/                 # Internationalization configuration
│   ├── 📁 lib/                  # Utility library
│   └── 📄 *.tsx                 # Page components
├── 📁 config/                    # Configuration files directory
│   ├── 📄 vite.config.ts        # Vite build configuration
│   ├── 📄 tailwind.config.js    # Tailwind CSS configuration
│   ├── 📄 eslint.config.js      # ESLint code checking configuration
│   ├── 📄 tsconfig*.json        # TypeScript configuration
│   └── 📄 components.json       # shadcn/ui component configuration
├── 📁 docs/                      # Documentation directory
│   ├── 📄 README.md              # Project documentation
│   ├── 📄 README.en.md           # English documentation
│   ├── 📄 TODO.md                # Todo items
│   ├── 📄 LICENSE                # License
│   ├── 📄 CLAUDE.md              # Claude AI usage guide
│   ├── 📄 EPUB结构说明.md        # EPUB format documentation
│   ├── 📄 PDF处理流程文档.md     # PDF processing documentation
│   └── 📄 浏览器代理解决方案.md   # Proxy configuration guide
├── 📁 test/                      # Test files directory
├── 📁 node_modules/              # Dependencies
└── 📁 dist/                      # Build output directory
```

### Configuration Files Description

- **config/**: Unified management of all configuration files to improve project maintainability
- **docs/**: Centralized storage of project documentation, including guides and technical docs
- **src/**: Source code organized by functional modules, following best practices

## 📖 User Guide

### 1. Configure AI Service

First-time use requires AI service configuration:

1. Click the "Configure" button
2. Select AI service provider:
   - **Google Gemini** (recommended): Requires Gemini API Key
   - **OpenAI GPT**: Requires OpenAI API Key and API address
3. Enter the corresponding API Key
4. Select model (optional, default model works fine)

#### Getting API Keys

**Google Gemini API Key**:

1. Visit [Google AI Studio](https://aistudio.google.com/)
2. Sign in with Google account
3. Create a new API Key
4. Copy the API Key to configuration

**OpenAI API Key**:

1. Visit [OpenAI Platform](https://platform.openai.com/)
2. Sign in and go to API Keys page
3. Create a new API Key
4. Copy the API Key to configuration

Here are some [free alternatives](https://github.com/SSShooter/Video-Summary/blob/master/guide/index.md) for reference.

### 2. Upload E-book File

1. Click "Select EPUB or PDF File" button
2. Choose the e-book file to process
3. Supported formats: `.epub`, `.pdf`

### 3. Configure Processing Options

Set processing parameters in the configuration dialog:

#### Processing Mode

- **Text Summary Mode**: Suitable for scenarios requiring text summaries
- **Chapter Mind Map Mode**: Generate independent mind maps for each chapter
- **Whole Book Mind Map Mode**: Generate unified mind map for the entire book

#### Book Type

- **Fiction**: Suitable for novels and story books
- **Non-fiction**: Suitable for textbooks, reference books, technical books, etc.

#### Advanced Options

- **Smart Chapter Detection**: When enabled, uses AI to intelligently identify chapter boundaries
- **Skip Irrelevant Chapters**: Automatically skip prefaces, table of contents, acknowledgments, etc.
- **Sub-chapter Depth**: Set the hierarchy depth for extracting sub-chapters (0-3)

### 4. Extract Chapters

1. Click "Extract Chapters" button
2. System will automatically parse the file and extract chapter structure
3. After extraction, chapter list will be displayed
4. You can select chapters to process (all selected by default)

### 5. Start Processing

1. Confirm selected chapters
2. Click "Start Processing" button
3. System will display processing progress and current steps
4. Results will be shown after completion

### 6. View Results

Depending on the selected processing mode, you can view different types of results:

#### Text Summary Mode

- **Chapter Summaries**: Detailed summary of each chapter
- **Chapter Relationships**: Analysis of logical relationships between chapters
- **Book Summary**: Core content summary of the entire book

#### Mind Map Mode

- **Interactive Mind Maps**: Zoomable, draggable mind maps
- **Node Details**: Click nodes to view detailed content
- **Export Function**: Support exporting as images or other formats

## 🛠️ Technical Architecture

### Core Technology Stack

- **Frontend Framework**: React 19 + TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS + shadcn/ui
- **State Management**: Zustand
- **File Parsing**:
  - EPUB: @smoores/epub + epubjs
  - PDF: pdfjs-dist
- **Mind Maps**: mind-elixir
- **AI Services**:
  - Google Gemini: @google/generative-ai
  - OpenAI: Custom implementation

## 🔧 Advanced Features

### Cache Management

System automatically caches AI processing results for improved efficiency:

- **Auto Caching**: Processing results are automatically saved locally
- **Smart Reuse**: Identical content won't be processed repeatedly
- **Cache Cleanup**: Can clear specific types of cache by mode
- **Storage Optimization**: Cache data is compressed to save storage space

### Batch Processing

- **Chapter Selection**: Support batch select/deselect chapters
- **Concurrent Processing**: Multiple chapters can be processed in parallel (subject to API limits)
- **Resume Processing**: Can continue from last position after interruption

### Export Functions

- **Mind Map Export**: Support exporting as PNG, SVG and other formats
- **Text Summary Export**: Support exporting as Markdown, TXT formats
- **Data Backup**: Support exporting processing result data

## 📄 License

This project is licensed under the MIT License. See [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

Thanks to the following open source projects:

- [React](https://reactjs.org/)
- [Vite](https://vitejs.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [mind-elixir](https://github.com/ssshooter/mind-elixir-core)
- [PDF.js](https://mozilla.github.io/pdf.js/)
- [epub.js](https://github.com/futurepress/epub.js/)

---

For questions or suggestions, please submit an Issue or contact the developer.
