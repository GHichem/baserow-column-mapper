# Baserow CSV Import Tool

A streamlined React application for uploading and importing large CSV files directly to Baserow - **no proxy server required!**

## ✨ Key Features

- **🚀 Single Command Setup**: Just `npm run dev` - that's it!
- **📁 Large File Support**: Handle 50,000+ row files without truncation
- **💾 Smart Storage**: IndexedDB persistence survives page refreshes  
- **🔄 Direct Integration**: Connects directly to Baserow API
- **🎯 Intelligent Mapping**: Smart column matching with manual override
- **⚡ Optimized Performance**: Streaming upload for large datasets

## 🛠 Quick Start

```bash
npm install
npm run dev
```

### Environment Setup

Create `.env.local`:
```env
VITE_BASEROW_API_TOKEN=your_api_token
VITE_BASEROW_USERNAME=your_username  
VITE_BASEROW_PASSWORD=your_password
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
- **Before**: Page refresh = data loss, only ~1000 rows processed
- **After**: Full file persistence, all 50,000+ rows processed correctly

## � Project Structure

```
src/
├── components/
│   ├── FileUpload.tsx          # Drag & drop file upload
│   ├── ColumnMapping.tsx       # Smart column matching
│   └── ui/                     # Reusable components
├── utils/
│   ├── baserowApi.ts          # Direct Baserow integration
│   ├── fileStorage.ts         # IndexedDB file management  
│   └── stringMatching.ts     # Column similarity matching
└── pages/
    └── Index.tsx              # Main application
```

## 🔧 How It Works

### File Processing
1. **Upload**: Files stored in IndexedDB (persistent browser storage)
2. **Analysis**: Headers extracted for column matching
3. **Mapping**: Smart similarity-based column suggestions
4. **Import**: Direct streaming to Baserow with progress tracking

### Authentication Methods
- **JWT Token**: Automatic login with token refresh
- **API Token**: Direct API access from Baserow settings
- **Username/Password**: Generates JWT tokens automatically
- **Public Access**: For open/shared tables

### Large File Handling
- **Chunked Processing**: Memory-efficient file processing
- **Progress Tracking**: Real-time upload feedback
- **Error Recovery**: Automatic retry on failures
- **Persistent Storage**: Files survive browser refreshes

## � Performance

| File Size | Processing Method | Notes |
|-----------|------------------|-------|
| < 10MB | Standard processing | Fast upload |
| 10-100MB | Chunked with IndexedDB | Optimized memory usage |
| 100MB+ | Streaming chunks | Header-only mapping, full import |

## � Troubleshooting

### Common Issues

**Large File Upload Fails**
- Ensure stable internet connection
- Check available browser storage space
- Verify file is not corrupted

**Column Mapping Errors**  
- Check target table exists in Baserow
- Verify column names don't contain special characters
- Ensure required fields are mapped

**Authentication Errors**
- Verify credentials in `.env.local`
- Check API token hasn't expired
- Restart dev server after env changes

## 📊 Browser Compatibility

- **Chrome**: Full support (recommended)
- **Firefox**: Full support  
- **Safari**: Full support (macOS 14+)
- **Edge**: Full support

*Requires modern browser with IndexedDB support*

## 🔄 Technical Details

### Direct API Integration
The application connects directly to Baserow's REST API using:
- HTTPS requests with proper authentication headers
- JWT token management with automatic refresh
- CORS-compliant requests (no proxy needed)
- Rate limiting and error handling

### Storage Strategy
- **SessionStorage**: Quick access for current session data
- **IndexedDB**: Persistent storage for large files (2GB+ capacity)
- **Memory Cache**: Fast access for frequently used data
- **Automatic Cleanup**: Old files removed to prevent storage bloat

## 🛡 Security

- Environment variable configuration prevents credential exposure
- JWT tokens are auto-refreshed before expiration
- No sensitive data logged to console
- Direct HTTPS communication ensures data security

## 📈 Future Enhancements

- [ ] Data validation rules before import
- [ ] Bulk update operations for existing records
- [ ] Export functionality for processed data
- [ ] Advanced column transformation options

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes with proper TypeScript types
4. Test with large files (>50MB recommended)
5. Submit a pull request

## 📄 License

MIT License - feel free to use in your projects!