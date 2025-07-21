# CSV Import Application

A secure and robust React application for uploading and importing CSV files to Baserow.

## 🔒 Security Features

- Environment variable configuration for sensitive data
- JWT token authentication with automatic refresh
- Safe field mapping validation
- Protected against missing/undefined field errors

## 🚀 Recent Improvements

### Security Enhancements
- **Environment Variables**: Sensitive tokens now loaded from environment variables
- **Safe Field Access**: Added safety checks for undefined/missing fields
- **Validation**: Warns about missing field mappings during column mapping

### Large File Support
- **No Row Limits**: Removed artificial 999-row limit for large files
- **Progress Tracking**: Added progress callbacks for UI feedback
- **Streaming Support**: UTF-8 explicit decoding for better file handling
- **Memory Optimization**: Improved chunk processing for very large files

### Stability Improvements
- **Better Error Handling**: Enhanced error messages and recovery
- **Retry Logic**: Automatic retry for failed operations
- **Rate Limiting**: Handles API rate limits gracefully

## 🛠 Setup

### Environment Configuration

Create a `.env.local` file in your project root:

```env
# Baserow Configuration
VITE_BASEROW_API_TOKEN=your_api_token_here
VITE_BASEROW_USERNAME=your_username_here
VITE_BASEROW_PASSWORD=your_password_here
VITE_BASEROW_JWT_TOKEN=your_jwt_token_here  # Optional
```

**Security Note**: Never commit actual credentials to version control. Use the `.env.example` file as a template.

### Installation

```bash
npm install
npm run dev
```

## 📁 Project Structure

```
src/
├── components/
│   ├── FileUpload.tsx          # File upload component
│   ├── ColumnMapping.tsx       # Column mapping interface
│   └── ui/                     # Reusable UI components
├── utils/
│   ├── baserowApi.ts          # Baserow API integration
│   └── stringMatching.ts     # Smart column matching
└── pages/
    └── Index.tsx              # Main application page
```

## 🔧 Key Features

### File Upload
- Drag & drop support
- File validation (CSV, XLS, XLSX)
- Large file handling (no size limits)
- Progress tracking

### Column Mapping
- Smart automatic matching
- Manual column assignment
- Similarity scoring
- Ignore unused columns

### Data Processing
- Batch processing for performance
- Memory-efficient streaming
- Error recovery and retry logic
- Progress feedback

## 📊 Performance

- **Small Files (<50MB)**: Standard chunk processing
- **Large Files (50-100MB)**: Streaming approach
- **Very Large Files (>100MB)**: Optimized limited processing
- **Batch Size**: Dynamic based on file size

## 🐛 Troubleshooting

### Common Issues

1. **Environment Variables Not Loading**
   - Ensure `.env.local` exists in project root
   - Restart development server after adding variables

2. **Large File Upload Fails**
   - Check network timeout settings
   - Verify file is not corrupted
   - Ensure sufficient memory available

3. **Column Mapping Errors**
   - Verify target table schema matches expected columns
   - Check for special characters in column names

### Debug Mode

Enable detailed logging by checking browser console. All operations are logged with timestamps and progress indicators.

## 🔄 API Integration

The application integrates with Baserow using:
- REST API for data operations
- JWT authentication for secure access
- Automatic token refresh
- Rate limiting compliance

## 📈 Future Enhancements

- [ ] Excel file format support
- [ ] Data validation rules
- [ ] Custom field types mapping
- [ ] Bulk update operations
- [ ] Export functionality

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.