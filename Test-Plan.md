# Testing Supabase Integration

## Prerequisites
Before running tests, ensure:

1. Docker is running
2. All environment variables are set
3. Supabase project is created and configured
4. Database schema is loaded

## Manual Tests

### 1. Authentication Tests
- [ ] Sign up with email/password
- [ ] Sign in with email/password
- [ ] Sign in with Google
- [ ] Sign out
- [ ] Password reset functionality

### 2. Chat Functionality Tests
- [ ] Create new chat session
- [ ] Send message and receive response
- [ ] Load chat history
- [ ] Load multiple sessions
- [ ] Delete session
- [ ] Clear chat history

### 3. Sync Functionality Tests
- [ ] Sync chat history to Supabase
- [ ] Sync from Supabase to local
- [ ] Sync prompt shortcuts
- [ ] Verify data integrity after sync

### 4. Extension Tests
- [ ] Extension popup opens correctly
- [ ] Authentication works in extension
- [ ] Chat functionality works in extension
- [ ] Extension can sync with web app via API

### 5. Web App Tests
- [ ] Web app loads correctly
- [ ] Authentication works in web app
- [ ] Chat functionality works in web app
- [ ] Web app can sync with extension via API

## Automated Tests
Run the following to execute automated tests:

```bash
# Run unit tests
npm run test

# Run integration tests
npm run test:integration

# Run E2E tests
npm run test:e2e
```

## API Endpoint Tests
Verify all API endpoints work with Supabase:

1. `POST /api/chat` - Send message and get AI response
2. `GET /api/chat/history/:sessionId` - Get chat history
3. `POST /api/sync/messages` - Sync messages to Supabase
4. `POST /api/sync/sessions` - Sync sessions to Supabase
5. `POST /api/sync/prompts` - Sync prompts to Supabase
6. `GET /api/sync/data` - Get all synced data
7. `DELETE /api/sync/clear` - Clear synced data

## Environment Checks
- [ ] Environment variables are properly set
- [ ] Database connections are established
- [ ] Supabase client initialization works
- [ ] API keys are properly configured

## Performance Tests
- [ ] Load times are reasonable (< 3 seconds)
- [ ] API requests respond within 10 seconds
- [ ] Database queries execute efficiently
- [ ] Memory usage is optimal

## Security Checks
- [ ] Authentication required for protected endpoints
- [ ] Input validation is in place
- [ ] Rate limiting is functioning
- [ ] No sensitive data is exposed in client code