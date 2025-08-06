# 🛡️ Secure Deployment Guide

## ✅ What We've Set Up

Your application is now **SECURE** with a backend proxy architecture:

### Frontend (Public)
- No sensitive credentials exposed
- Uses proxy server for all Baserow API calls
- Safe to deploy publicly

### Backend (Private Server)
- Stores all sensitive credentials securely
- Acts as authenticated proxy to Baserow
- Runs on your private server

## 🚀 Deployment Steps

### 1. Deploy Backend (First)
```bash
# On your server (VPS, cloud instance, etc.)
cd backend
npm install
# Set your .env variables securely
npm start
```

### 2. Deploy Frontend
```bash
# Update VITE_PROXY_URL to your backend server URL
# Example: VITE_PROXY_URL=https://your-backend-server.com
npm run build
# Deploy dist/ folder to Netlify, Vercel, etc.
```

### 3. Update Environment Variables

#### Backend (.env) - Keep on server only:
```
BASEROW_API_TOKEN=your_token_here
BASEROW_USERNAME=your_username_here  
BASEROW_PASSWORD=your_password_here
ALLOWED_ORIGINS=https://your-frontend-domain.com
```

#### Frontend (.env) - Safe for deployment:
```
VITE_USE_PROXY=true
VITE_PROXY_URL=https://your-backend-server.com
```

## 🔒 Security Benefits

✅ **API Tokens Hidden**: Never exposed to users  
✅ **Credentials Secure**: Stored only on your server  
✅ **Rate Limiting**: Can add server-side controls  
✅ **Validation**: Server validates all requests  
✅ **CORS Protection**: Controls who can access your API  

## 🖥️ Local Development

Run both services:
```bash
# Terminal 1: Backend
cd backend
npm run dev

# Terminal 2: Frontend  
cd ..
npm run dev
```

## ⚠️ Important Notes

1. **Change your Baserow password** (it was exposed before)
2. **Regenerate your API token** in Baserow settings
3. **Never commit backend/.env** to git
4. **Use HTTPS** for production deployments
5. **Update ALLOWED_ORIGINS** with your real frontend domain
