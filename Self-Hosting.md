# Prism - Self-Hosting Guide

This guide will walk you through the process of self-hosting the Prism AI application using Docker and Supabase.

## Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for local development)
- A domain name (for production deployment)

## Option 1: Using Docker Compose (Recommended)

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/prism.git
cd prism
```

### 2. Configure Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

### 3. Generate Secure Keys

For production use, generate secure keys:

```bash
# Generate JWT secret (at least 32 characters)
openssl rand -hex 32

# Generate Supabase anon key (JWT token)
# Use: https://jwt.io with payload:
# {"iss": "supabase-demo", "role": "anon", "exp": 1950001100}
# Secret: your-super-secret-jwt-token-with-at-least-32-characters-long

# Generate Supabase service role key (JWT token)
# Use: https://jwt.io with payload:
# {"iss": "supabase-demo", "role": "service_role", "exp": 1950001100}
# Secret: same as above
```

### 4. Start Services

```bash
# Build and start all services
docker-compose up -d

# Or build first then start
docker-compose build
docker-compose up -d
```

### 5. Initialize Database

Run the initial database setup (see `init.sql` for schema):

```bash
# Connect to the database container
docker exec -it prism-supabase-db psql -U postgres -d postgres

# Or apply your schema changes
docker cp init.sql prism-supabase-db:/tmp/
docker exec -it prism-supabase-db psql -U postgres -d postgres -f /tmp/init.sql
```

## Option 2: Manual Deployment

### 1. Set Up Supabase Project

1. Create a Supabase account at [supabase.com](https://supabase.com)
2. Create a new project
3. Note down your project URL and API keys
4. Configure authentication providers (Email, Google, etc.)

### 2. Configure Database Tables

Create the required tables using the schema from `libs/supabase-client/supabase-schema.sql`

### 3. Deploy Edge Functions

Deploy the Edge Functions from the `supabase/functions` directory:

```bash
# Install Supabase CLI
npm install -g supabase

# Link to your project
supabase link --project-ref <your-project-ref>

# Deploy functions
supabase functions deploy
```

### 4. Set Environment Variables

Configure your environment with the Supabase credentials:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

### 5. Build and Deploy Applications

#### For the API:
```bash
npm run build:api
npm start:api
```

#### For the Web App:
```bash
npm run build:web
npm start:web
```

## Configuration

### Authentication

Prism supports multiple authentication providers. Configure them in your Supabase project:

1. Go to Authentication → Settings in your Supabase dashboard
2. Enable email/password and/or social providers
3. Add your domain to the redirect URLs
4. Configure SMTP for email verification (optional but recommended)

### LLM Providers

Prism supports multiple LLM providers. Configure in your environment:

```bash
# OpenAI
OPENAI_API_KEY=sk-your-openai-api-key
LLM_PROVIDER=openai
LLM_MODEL=gpt-4-turbo

# Or Anthropic
ANTHROPIC_API_KEY=your-anthropic-api-key
LLM_PROVIDER=anthropic
LLM_MODEL=claude-3-sonnet-20240229

# Or local models via Ollama
OLLAMA_HOST=http://localhost:11434
LLM_PROVIDER=ollama
LLM_MODEL=mistral
```

## Production Deployment

### SSL Certificate

The docker-compose file includes Traefik as a reverse proxy with Let's Encrypt integration. Update the email in the compose file:

```yaml
- '--certificatesresolvers.le.acme.email=your-email@example.com'
```

### Security Best Practices

1. Use strong passwords
2. Regularly rotate API keys
3. Use HTTPS in production
4. Restrict database access
5. Monitor logs regularly

## Troubleshooting

### Common Issues

1. **Database Connection Issues**: Check that the database service is running and accessible via the specified host/port.

2. **Authentication Issues**: Verify that the Supabase URL and keys are correctly set.

3. **Build Errors**: Ensure all dependencies are properly installed using `npm install --legacy-peer-deps`.

4. **CORS Errors**: Confirm that your domain is added to the ALLOWED_ORIGINS environment variable.

### Logs

Check service logs to troubleshoot:

```bash
# View all logs
docker-compose logs

# View specific service logs
docker-compose logs prism-api
docker-compose logs prism-web
```

## Updating

To update to the latest version:

```bash
# Pull latest changes
git pull origin main

# Rebuild containers
docker-compose build
docker-compose up -d
```

## Support

If you encounter issues with the self-hosting setup, please check:

1. Our documentation
2. GitHub issues
3. Contact us through the website

**Note**: Self-hosting requires technical knowledge of Docker, databases, and system administration. If you encounter persistent issues, consider using our hosted solution.