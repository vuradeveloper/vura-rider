# Vura Backend — AWS Deployment Guide

## Prerequisites
- AWS EC2 instance (t3.medium or larger recommended)
- AWS RDS PostgreSQL instance
- Firebase project with a service account key

---

## 1. Set Up AWS RDS

Create a PostgreSQL database on RDS:
- Engine: PostgreSQL 16
- DB identifier: `vura-db`
- Master username: `vura_admin`
- Password: [generate a strong one]
- Public accessibility: Yes (or use VPC peering with EC2)
- Security group: Allow inbound TCP on port 5432 from EC2 security group

Save the endpoint: `vura-db.xxxx.us-east-1.rds.amazonaws.com`

---

## 2. Set Up EC2

```bash
# Launch EC2 with Amazon Linux 2023 / Ubuntu 22.04

# SSH in and install Node 22 + Docker
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Docker
curl -fsSL https://get.docker.com | sudo bash
sudo usermod -aG docker $USER
newgrp docker

# Clone your repo (or scp the server folder)
git clone <your-repo>
cd vura-rider/server
```

---

## 3. Configure Environment

```bash
# Copy and fill in .env
cp .env.example .env

# Encode your Firebase service account JSON:
cat firebase-service-account.json | base64 -w0

# Paste the output into .env:
# FIREBASE_SERVICE_ACCOUNT_BASE64=<the_base64_string>
# DATABASE_URL=postgresql://vura_admin:<password>@vura-db.xxxx.us-east-1.rds.amazonaws.com:5432/vura
```

---

## 4. Run

```bash
# Local dev
npm install
npm run dev

# Production with Docker
docker compose up -d

# Run DB migration (after PostgreSQL is ready)
docker compose exec api node dist/config/migrate.js

# Or without Docker:
npm run build
npm run db:migrate
npm start
```

---

## 5. Security Group Rules (EC2)

| Type     | Port | Source        |
|----------|------|---------------|
| HTTP     | 80   | 0.0.0.0/0     |
| HTTPS    | 443  | 0.0.0.0/0     |
| Custom   | 3000 | 0.0.0.0/0     |
| SSH      | 22   | Your IP       |

---

## 6. Environment Variables (full list)

| Variable                          | Description                          |
|-----------------------------------|--------------------------------------|
| `PORT`                            | Server port (default 3000)           |
| `NODE_ENV`                        | `development` or `production`        |
| `DATABASE_URL`                    | PostgreSQL connection string         |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | Base64-encoded Firebase SA JSON      |
| `GOOGLE_MAPS_API_KEY`             | Google Maps API key (optional)       |

---

## API Testing

```bash
# Health check
curl http://localhost:3000/health

# Sync user (after getting Firebase ID token from client)
curl -X POST http://localhost:3000/api/users/sync \
  -H "Content-Type: application/json" \
  -d '{"token":"<id_token>","role":"driver","phone":"0821234567"}'

# Get profile
curl http://localhost:3000/api/users/me \
  -H "Authorization: Bearer <id_token>"
```
