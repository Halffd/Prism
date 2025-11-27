# Prism API Documentation

## Overview
The Prism API provides endpoints for managing chat sessions, user authentication, and AI-powered conversations with contextual awareness.

## Base URL
```
https://api.prism.app/v1 or http://localhost:3000/api
```

## Authentication
Most endpoints require authentication. Include your JWT token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## Endpoints

### Authentication

#### Register User
```
POST /api/auth/register
```
Create a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "name": "John Doe"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "user-id",
    "email": "user@example.com",
    "name": "John Doe",
    "token": "jwt-token"
  }
}
```

#### Login User
```
POST /api/auth/login
```
Authenticate an existing user.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "user-id",
    "email": "user@example.com", 
    "name": "John Doe",
    "token": "jwt-token"
  }
}
```

#### Get Current User
```
GET /api/auth/me
```
Get information about the authenticated user.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "user-id",
    "email": "user@example.com",
    "name": "John Doe"
  }
}
```

### Chat

#### Send Message
```
POST /api/chat
```
Send a message to the AI assistant with optional context.

**Headers:**
```
Authorization: Bearer <jwt-token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "content": "What is this page about?",
  "context": {
    "type": "page",
    "url": "https://example.com/article",
    "title": "Example Article Title",
    "selectedText": "Some selected text from the page",
    "fullText": "Full text content of the page...",
    "metadata": {
      "description": "Page description",
      "author": "Author name"
    }
  },
  "sessionId": "optional-session-id" 
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "message-id",
    "role": "assistant",
    "content": "AI response content...",
    "context": { ... },
    "timestamp": 1234567890,
    "tokens": 50
  },
  "metadata": {
    "contextRelevance": 85,
    "keywords": ["keyword1", "keyword2"],
    "sentiment": "neutral"
  }
}
```

#### Get Chat History
```
GET /api/chat/history/:sessionId
```
Retrieve message history for a specific session.

**Headers:**
```
Authorization: Bearer <jwt-token>
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "message-id",
      "role": "user",
      "content": "User message",
      "context": { ... },
      "timestamp": 1234567890
    },
    {
      "id": "message-id",
      "role": "assistant", 
      "content": "AI response",
      "context": { ... },
      "timestamp": 1234567891
    }
  ]
}
```

### Sessions

#### List Sessions
```
GET /api/sessions
```
Get all sessions for the authenticated user.

**Headers:**
```
Authorization: Bearer <jwt-token>
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "session-id",
      "userId": "user-id",
      "messages": [],
      "createdAt": 1234567890,
      "updatedAt": 1234567890
    }
  ]
}
```

#### Create Session
```
POST /api/sessions
```
Create a new chat session.

**Headers:**
```
Authorization: Bearer <jwt-token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "messages": []
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "session-id",
    "userId": "user-id",
    "messages": [],
    "createdAt": 1234567890,
    "updatedAt": 1234567890
  }
}
```

#### Get Session
```
GET /api/sessions/:id
```
Get a specific session.

**Headers:**
```
Authorization: Bearer <jwt-token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "session-id",
    "userId": "user-id",
    "messages": [],
    "createdAt": 1234567890,
    "updatedAt": 1234567890
  }
}
```

#### Update Session
```
PUT /api/sessions/:id
```
Update a specific session.

**Headers:**
```
Authorization: Bearer <jwt-token>
Content-Type: application/json
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "session-id",
    "userId": "user-id",
    "messages": [],
    "createdAt": 1234567890,
    "updatedAt": 1234567890
  }
}
```

#### Delete Session
```
DELETE /api/sessions/:id
```
Delete a specific session.

**Headers:**
```
Authorization: Bearer <jwt-token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Session deleted successfully"
  }
}
```

## Data Models

### User
- `id`: string - Unique identifier
- `email`: string - User's email address
- `name`: string - User's display name
- `createdAt`: number - Unix timestamp
- `updatedAt`: number - Unix timestamp

### Message
- `id`: string - Unique identifier
- `role`: 'user' | 'assistant' | 'system' - Message role
- `content`: string - Message content
- `context`: ContextData - Optional context data
- `timestamp`: number - Unix timestamp
- `tokens`: number (optional) - Token count

### ContextData
- `type`: 'page' | 'screen' | 'selection' - Context type
- `url`: string (optional) - URL if context is web page
- `title`: string (optional) - Title of the context
- `selectedText`: string (optional) - Selected text
- `fullText`: string (optional) - Full text content
- `appName`: string (optional) - App name for mobile context
- `metadata`: Record<string, any> (optional) - Additional metadata

### ChatSession
- `id`: string - Unique identifier
- `userId`: string - User identifier
- `messages`: Message[] - Array of messages
- `createdAt`: number - Unix timestamp
- `updatedAt`: number - Unix timestamp

## Error Handling
All error responses follow this format:
```json
{
  "success": false,
  "error": "Error message details"
}
```

## Status Codes
- `200`: Success
- `201`: Created
- `400`: Bad Request
- `401`: Unauthorized
- `403`: Forbidden
- `404`: Not Found
- `409`: Conflict
- `500`: Internal Server Error