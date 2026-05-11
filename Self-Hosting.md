# Prism - Self-Hosting Guide

This guide covers self-hosting Prism on your home server using Docker Compose, with support for 20+ cloud and local LLM providers.

## Prerequisites

- Docker and Docker Compose v2
- 4 GB RAM minimum (8 GB+ recommended for local LLMs)
- NVIDIA GPU (optional, for accelerated local inference)
- A domain name (for production with SSL)

## Quick Start

```bash
git clone https://github.com/anomalyco/Prism.git
cd Prism
chmod +x setup.sh
./setup.sh
```

The setup script will prompt for API keys, domain, and options, then build and deploy everything automatically.

To reconfigure without redeploying:

```bash
./setup.sh --env-only
```

## Architecture

```
                    ┌─────────────┐
                    │   Traefik   │ :80/:443
                    │  (reverse   │
                    │   proxy)    │
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
     ┌──────┴──────┐ ┌────┴─────┐ ┌──────┴──────┐
     │  prism-web  │ │prism-api │ │ prism-hono  │
     │  :3001      │ │ :3000    │ │  :3002      │
     │  (Next.js)  │ │ (NestJS) │ │  (Hono)     │
     └─────────────┘ └────┬─────┘ └──────┬──────┘
                          │              │
                 ┌────────┴──────────────┤
                 │                       │
          ┌──────┴──────┐        ┌───────┴──────┐
          │ supabase-db │        │    redis     │
          │   :5432     │        │   :6379      │
          └─────────────┘        └──────────────┘

          ┌─────────────┐
          │   ollama    │  :11434  (optional)
          │ (local LLM) │
          └─────────────┘
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| prism-web | 3001 | Next.js web application |
| prism-api | 3000 | NestJS backend API |
| prism-hono | 3002 | Hono lightweight edge API |
| supabase-db | 5432 | PostgreSQL 15 database |
| supabase-auth | — | GoTrue authentication service |
| traefik | 80/443/8080 | Reverse proxy + SSL |
| redis | 6379 | Caching layer |
| ollama | 11434 | Local LLM inference (optional) |

## Option 1: Docker Compose (Recommended)

### 1. Clone and Configure

```bash
git clone https://github.com/anomalyco/Prism.git
cd Prism
cp .env.example .env
```

### 2. Generate Secure Keys

```bash
# JWT secret (at least 32 characters)
openssl rand -hex 32

# Supabase keys — use https://jwt.io with:
#   anon key payload:      {"iss": "supabase-demo", "role": "anon", "exp": 1950001100}
#   service_role payload:  {"iss": "supabase-demo", "role": "service_role", "exp": 1950001100}
```

### 3. Edit .env

See [.env.example](.env.example) for all available variables. Key sections:

```bash
# Domain and SSL
DOMAIN=yourdomain.com
ACME_EMAIL=you@example.com

# Database
DATABASE_URL=postgresql://postgres:postgres@supabase-db:5432/postgres

# Default LLM
LLM_PROVIDER=openai
LLM_MODEL=gpt-3.5-turbo
```

### 4. Start Services

```bash
docker compose up -d --build
```

### 5. (Optional) Pull an Ollama Model

```bash
docker exec ollama ollama pull llama3.2
```

## Option 2: Hono-Only Deployment

For a lightweight home server, run just the Hono edge API without NestJS:

```bash
docker compose up -d prism-hono supabase-db redis ollama
```

The Hono API provides:
- `GET /health` — health check
- `POST /api/chat` — chat completions (with streaming support)

All OpenAI-compatible providers work through the Hono backend. Set `OLLAMA_API_URL=http://ollama:11434` to use local models.

## LLM Provider Configuration

### Cloud Providers

| Provider | Env Key | Default URL |
|----------|---------|-------------|
| OpenAI | `OPENAI_API_KEY` | `https://api.openai.com/v1` |
| Anthropic | `ANTHROPIC_API_KEY` | `https://api.anthropic.com/v1` |
| Google Gemini | `GOOGLE_API_KEY` | `https://generativelanguage.googleapis.com` |
| DeepSeek | `DEEPSEEK_API_KEY` | `https://api.deepseek.com/v1` |
| Grok (xAI) | `GROK_API_KEY` | `https://api.x.ai/v1` |
| OpenRouter | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1` |
| Poe | `POE_API_KEY` | `https://api.poe.com/bot/` |

### New Cloud Providers

| Provider | Env Key | Default URL |
|----------|---------|-------------|
| NVIDIA NIM | `NVIDIA_NIM_API_KEY` | `https://integrate.api.nvidia.com/v1` |
| Groq | `GROQ_API_KEY` | `https://api.groq.com/openai/v1` |
| Cerebras | `CEREBRAS_API_KEY` | `https://api.cerebras.ai/v1` |
| Cloudflare Workers | `CLOUDFLARE_WORKERS_API_KEY` | `https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/` |
| Fireworks | `FIREWORKS_API_KEY` | `https://api.fireworks.ai/inference/v1` |
| Z.AI | `ZAI_API_KEY` | `https://api.z.ai/v1` |

### Local / Self-Hosted Providers

| Provider | Env Key | Default URL |
|----------|---------|-------------|
| Ollama | `OLLAMA_API_URL` | `http://localhost:11434` |
| KoboldCpp | `KOBOLDCPP_API_URL` | `http://localhost:5001` |
| llama.cpp | `LLAMACPP_API_URL` | `http://localhost:8080` |
| SGLang | `SGLANG_API_URL` | `http://localhost:30000` |

Example — Groq with Llama 3:

```bash
GROQ_API_KEY=gsk_your_key
LLM_PROVIDER=groq
LLM_MODEL=llama-3.1-8b-instant
```

Example — Local Ollama:

```bash
OLLAMA_API_URL=http://ollama:11434
LLM_PROVIDER=ollama
LLM_MODEL=llama3.2
```

Example — Cerebras (fastest inference):

```bash
CEREBRAS_API_KEY=csk-your-key
LLM_PROVIDER=cerebras
LLM_MODEL=llama3.1-8b
```

## SSL / HTTPS

Traefik handles TLS via Let's Encrypt automatically. Set in `.env`:

```bash
DOMAIN=yourdomain.com
ACME_EMAIL=you@example.com
```

Traefik routes:
- `app.yourdomain.com` → prism-web
- `api.yourdomain.com` → prism-api
- `hono.yourdomain.com` → prism-hono

## GPU Acceleration for Ollama

The docker-compose includes NVIDIA GPU passthrough for Ollama. Requirements:

1. Install [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
2. Restart Docker daemon
3. Ollama will automatically detect and use available GPUs

For CPU-only, remove the `deploy.resources.reservations.devices` block from the `ollama` service.

## Authentication

Prism uses Supabase GoTrue for authentication:

1. Go to Authentication → Settings in Supabase dashboard
2. Enable email/password and/or social providers
3. Add your domain to redirect URLs
4. Configure SMTP for email verification:

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
```

## Production Security Checklist

- [ ] Change `POSTGRES_PASSWORD` from default
- [ ] Set a strong `JWT_SECRET` (32+ characters)
- [ ] Restrict `ALLOWED_ORIGINS` to your domain only
- [ ] Enable HTTPS via Traefik/Let's Encrypt
- [ ] Set `ENABLE_TELEMETRY=false`
- [ ] Rotate API keys regularly
- [ ] Restrict database access to internal network
- [ ] Set `LOG_LEVEL=warn` in production
- [ ] Use `PRISM_API_KEY` for API authentication
- [ ] Disable Traefik dashboard (`--api.insecure=false`) in production

## Troubleshooting

### Database Connection Issues
```bash
docker compose logs supabase-db
# Verify database is healthy:
docker compose exec supabase-db pg_isready -U postgres
```

### Ollama Not Responding
```bash
# Check if Ollama is running
docker compose logs ollama
# Test manually
curl http://localhost:11434/api/tags
```

### CORS Errors
Add your origin to `.env`:
```bash
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001,https://yourdomain.com
```

### Build Errors
```bash
# Clean rebuild
docker compose build --no-cache
npm install --legacy-peer-deps
```

### Hono API Not Starting
```bash
docker compose logs prism-hono
# Ensure Redis is running:
docker compose logs redis
```

## Updating

```bash
git pull origin main
docker compose build
docker compose up -d
```

## Ports Summary

| Port | Service | External |
|------|---------|----------|
| 3000 | prism-api (NestJS) | Yes |
| 3001 | prism-web (Next.js) | Yes |
| 3002 | prism-hono (Hono) | Yes |
| 5432 | PostgreSQL | No (internal) |
| 6379 | Redis | No (internal) |
| 8080 | Traefik dashboard | Yes |
| 80/443 | Traefik HTTP/HTTPS | Yes |
| 11434 | Ollama | Yes |

## Support

- [GitHub Issues](https://github.com/anomalyco/Prism/issues)
- [Documentation](https://opencode.ai)
