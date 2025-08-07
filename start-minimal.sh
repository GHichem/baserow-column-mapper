#!/bin/bash
# Minimal startup script for the application
# This starts both backend and frontend with minimal output

echo "🚀 Starting Baserow Column Mapper..."

# Start backend silently in background
cd backend && npm start > /dev/null 2>&1 &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 2

# Start frontend with minimal output
cd .. && npm run dev:frontend 2>/dev/null | grep -E "(Local:|Network:|ready in)"

# Cleanup function
cleanup() {
    echo "🛑 Shutting down services..."
    kill $BACKEND_PID 2>/dev/null
    exit 0
}

# Handle Ctrl+C
trap cleanup SIGINT

# Keep script running
wait
