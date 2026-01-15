#!/usr/bin/env node
/**
 * @file API Server Entry Point
 * Starts the Express API server with WebSocket support
 */

// Load environment variables from .env file FIRST
import dotenv from 'dotenv';
dotenv.config();

import { startServer, attachWebSocket } from './src/api/server.js';

const PORT = process.env.PORT || 3000;

async function main() {
  try {
    console.log('🚀 Starting Beam Search API Server...');

    const server = await startServer(PORT);

    // Attach WebSocket server to HTTP server
    attachWebSocket(server);
    console.log('🔌 WebSocket server attached');

    console.log('\n✅ Server ready!');
    console.log(`   HTTP: http://localhost:${PORT}`);
    console.log(`   WebSocket: ws://localhost:${PORT}`);
    console.log('\n📡 API Endpoints:');
    console.log('   POST   /api/beam-search       - Start beam search job');
    console.log('   GET    /api/job/:jobId        - Get job status');
    console.log('   GET    /api/images/:imageId   - Serve generated image');
    console.log('   GET    /health                - Health check');
    console.log('\n🔌 WebSocket:');
    console.log('   Subscribe to job updates with: {"type": "subscribe", "jobId": "<id>"}');
    console.log('\nPress Ctrl+C to stop the server\n');

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

main();
