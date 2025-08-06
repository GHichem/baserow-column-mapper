# Baserow CSV Column Mapper

A sophisticated React application for uploading, mapping, and importing large CSV files directly to Baserow with intelligent column matching - **no proxy server required!**

## ✨ Key Features

- **🚀 Single Command Setup**: Just `npm run dev` - that's it!
- **📁 Large File Support**: Handle 50,000+ row files without truncation
- **💾 Smart Storage**: IndexedDB persistence survives page refreshes  
- **🔄 Direct Integration**: Connects directly to Baserow API
- **🎯 Intelligent Column Mapping**: Smart similarity-based column matching with manual override
- **⚡ Optimized Performance**: Parallel batch processing and streaming upload for large datasets
- **🎨 Modern UI**: Built with React, TypeScript, Tailwind CSS, and ShadCN/UI components

## 🛠 Quick Start

```bash
npm install
npm run dev
```

### Environment Setup

Create `.env` file in the project root:
```env
# Your Baserow API Token (found in Account Settings > API Tokens)
VITE_BASEROW_API_TOKEN=your_api_token

# Your Baserow username for JWT authentication
VITE_BASEROW_USERNAME=your_username  

# Your Baserow password for JWT authentication
VITE_BASEROW_PASSWORD=your_password

# Optional: Pre-generated JWT token (expires, so username/password preferred)
VITE_BASEROW_JWT_TOKEN=
```

## 🏗 Architecture

### Direct Baserow Integration
```
Browser App ──HTTPS──> Baserow API
     ↓
 IndexedDB Storage (2GB+)
```

**No proxy server needed!** The application connects directly to Baserow using:
- JWT authentication with auto-refresh
- Multiple fallback auth methods
- Native browser storage for large files

### Problem Solved
- **Before**: Page refresh = data loss, limited file size support, manual column mapping
- **After**: Full file persistence, 50,000+ rows processed correctly, intelligent column matching

## 📁 Project Structure

```
src/
├── components/
│   ├── FileUpload.tsx          # Drag & drop file upload with progress
│   ├── FileUploadForm.tsx      # Form wrapper for file upload
│   ├── ColumnMapping.tsx       # Intelligent column matching interface
│   ├── ImportProgressDialog.tsx # Real-time import progress tracking
│   ├── SuccessMessage.tsx      # Import completion feedback
│   └── ui/                     # ShadCN/UI reusable components
│       ├── button.tsx
│       ├── card.tsx
│       ├── input.tsx
│       ├── progress.tsx
│       ├── searchable-select.tsx
│       └── ...more
├── utils/
│   ├── baserowApi.ts          # Direct Baserow API integration
│   ├── fileStorage.ts         # IndexedDB file management  
│   └── stringMatching.ts     # Column similarity matching algorithms
├── pages/
│   ├── Index.tsx              # Main upload page
│   ├── ColumnMappingPage.tsx  # Column mapping interface
│   └── NotFound.tsx           # 404 page
└── hooks/
    └── use-toast.ts           # Toast notification hook
```

## 🔧 Technical Implementation

### CSV Processing
The application implements **custom CSV parsing** without external dependencies:
- Manual CSV parsing with quote and escape character handling
- Memory-efficient chunked processing for large files
- Smart header detection and column analysis

### File Processing Workflow
1. **Upload**: Files stored in IndexedDB (persistent browser storage)
2. **Analysis**: Headers extracted and analyzed for intelligent matching
3. **Mapping**: Smart similarity-based column suggestions with manual override
4. **Import**: Direct streaming to Baserow with parallel batch processing

### Large File Handling
- **Chunked Processing**: Memory-efficient file processing with IndexedDB storage
- **Progress Tracking**: Real-time upload feedback with speed metrics
- **Error Recovery**: Automatic retry on failures with token refresh
- **Persistent Storage**: Files survive browser refreshes and navigation

### Advanced Features
- **Parallel Batch Processing**: Up to 6 concurrent batches (1200 records at once)
- **Smart Token Management**: JWT auto-refresh with 15-minute buffer
- **Fallback Authentication**: Multiple auth methods (JWT, API token, username/password)
- **Import Cancellation**: Cancel long-running imports with cleanup

## 🏗 Technology Stack

- **Frontend**: React 18 + TypeScript + Vite
- **UI Framework**: Tailwind CSS + ShadCN/UI components
- **Routing**: React Router DOM
- **Storage**: IndexedDB for large file persistence
- **Forms**: React Hook Form + Zod validation
- **Icons**: Lucide React
- **State Management**: React Query for server state

## ⚡ Performance Optimizations

| File Size | Processing Method | Batch Strategy | Notes |
|-----------|------------------|----------------|-------|
| < 10MB | Standard processing | 200 records/batch | Fast upload |
| 10-100MB | Chunked with IndexedDB | Parallel batches | Optimized memory usage |
| 100MB+ | Streaming chunks | 6 concurrent batches | Header-only mapping, full import |

### Parallel Processing Architecture
```
File Upload → IndexedDB Storage → Header Analysis → Column Mapping
                     ↓
Batch Creation → 6 Parallel Batches → Baserow API → Progress Tracking
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- A Baserow account with API access
- Modern browser with IndexedDB support

### Installation
1. Clone the repository:
```bash
git clone https://github.com/GHichem/baserow-column-mapper.git
cd baserow-column-mapper
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables in `.env`:
```env
# Get your API token from Baserow Account Settings > API Tokens
VITE_BASEROW_API_TOKEN=your_api_token

# For JWT authentication (recommended for large imports)
VITE_BASEROW_USERNAME=your_username
VITE_BASEROW_PASSWORD=your_password
```

4. Start the development server:
```bash
npm run dev
```

### Build for Production
```bash
npm run build
npm run preview
```

## 📋 Usage Guide

1. **Upload CSV File**: Drag and drop or select your CSV file
2. **Review Headers**: The app automatically detects and displays column headers
3. **Map Columns**: Use the intelligent matching suggestions or manually map columns
4. **Start Import**: Monitor real-time progress with speed metrics
5. **Verify Results**: Check the created Baserow table with imported data

## 🛠 Troubleshooting

### Common Issues

**Large File Upload Fails**
- Ensure stable internet connection
- Check available browser storage space (requires ~2x file size free)
- Verify file is valid CSV format
- Try splitting very large files (>100MB) into smaller chunks

**Column Mapping Errors**  
- Check target table exists in Baserow
- Verify column names don't contain special characters
- Ensure required fields are mapped
- Check for duplicate column names in CSV

**Authentication Errors**
- Verify credentials in `.env` file
- Check API token hasn't expired in Baserow settings
- Restart dev server after environment changes
- Ensure username/password are correct for JWT auth

**Import Performance Issues**
- Large files automatically use optimized parallel processing
- Check browser console for memory warnings
- Consider splitting files larger than 200MB
- Ensure stable internet connection for best performance

## 📊 Browser Compatibility

- **Chrome**: Full support (recommended for best performance)
- **Firefox**: Full support  
- **Safari**: Full support (macOS 14+)
- **Edge**: Full support

*Requires modern browser with IndexedDB and ES2020 support*

## 🔄 Technical Details

### Direct API Integration
The application connects directly to Baserow's REST API using:
- HTTPS requests with proper authentication headers
- JWT token management with automatic refresh (15-minute buffer)
- CORS-compliant requests (no proxy needed)
- Rate limiting and intelligent error handling
- Fallback authentication methods for reliability

### Storage Strategy
- **SessionStorage**: Quick access for current session data and metadata
- **IndexedDB**: Persistent storage for large files (2GB+ capacity)
- **Memory Cache**: Fast access for frequently used data during processing
- **Automatic Cleanup**: Old files removed to prevent storage bloat

### CSV Parsing Implementation
- **Custom Parser**: No external dependencies, handles quoted fields and escape characters
- **Streaming Support**: Memory-efficient processing for large files
- **Header Detection**: Automatic column header identification and analysis
- **Encoding Support**: UTF-8 and common CSV encodings

### Performance Features
- **Parallel Batch Processing**: Up to 6 concurrent API calls (1200 records/batch)
- **Smart Batching**: Automatic batch size optimization based on file size
- **Progress Tracking**: Real-time metrics including speed and ETA
- **Error Recovery**: Automatic retry with exponential backoff

## 🛡 Security

- Environment variable configuration prevents credential exposure
- JWT tokens are auto-refreshed before expiration with secure caching
- No sensitive data logged to console in production
- Direct HTTPS communication ensures data security
- Client-side processing keeps data private until upload

## 📈 Future Enhancements

- [ ] Data validation rules and type checking before import
- [ ] Bulk update operations for existing records
- [ ] Export functionality for processed data
- [ ] Advanced column transformation options (date formats, data cleaning)
- [ ] Template saving for recurring import patterns
- [ ] Webhook support for import completion notifications
- [ ] Multi-table import support

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes with proper TypeScript types
4. Test with large files (>50MB recommended)
5. Ensure all components follow ShadCN/UI patterns
6. Submit a pull request with detailed description

### Development Guidelines
- Use TypeScript for all new code
- Follow the existing component structure
- Add proper error handling and user feedback
- Test with various CSV formats and file sizes
- Update documentation for new features

## 📄 License

MIT License - feel free to use in your projects!

---

**Built with ❤️ using React, TypeScript, and ShadCN/UI**