#!/bin/bash
# <UDF name="domain_name" label="Domain Name - leave blank for IP access" default="" example="demo.example.com" />
# <UDF name="letsencrypt_email" label="Email for SSL certificate - leave blank to skip HTTPS" default="" example="you@example.com" />

#############################################################################
# Linode StackScript for Image Gen Pipe V2
#
# Copy and paste this entire script into:
# Linode Dashboard > Create > StackScript > Paste here
#
# Or use the script directly with:
# curl -sSL https://raw.githubusercontent.com/jflournoy/image-gen-pipe-v2/main/deploy/linode-stackscript.sh | bash
#
# This script sets up a fresh Ubuntu 22.04 or 24.04 Linode with:
# - Node.js 22
# - Your app deployed and running as a systemd service
# - Nginx reverse proxy with WebSocket support
# - Optional HTTPS with Let's Encrypt
#############################################################################

set -e  # Exit on error

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Image Gen Pipe V2 - Linode Setup${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Use UDF variables from Linode dashboard, or allow manual input
DOMAIN_NAME="${DOMAIN_NAME:-}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"

echo -e "${YELLOW}Configuration:${NC}"
echo "Domain: ${DOMAIN_NAME:-'(IP access only)'}"
echo "Email: ${LETSENCRYPT_EMAIL:-'(HTTPS disabled)'}"
echo ""

# Step 1: Update system
echo -e "${YELLOW}Step 1: Updating system packages...${NC}"
apt update
apt upgrade -y
apt install -y curl wget git build-essential

echo -e "${GREEN}[OK] System updated${NC}"
echo ""

# Step 2: Install Node.js
echo -e "${YELLOW}Step 2: Installing Node.js 22...${NC}"
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
apt install -y nodejs

echo -e "${GREEN}[OK] Node.js installed: $(node --version)${NC}"
echo ""

# Step 3: Create app directory and clone repo
echo -e "${YELLOW}Step 3: Cloning repository...${NC}"
APP_DIR="/var/www/image-gen-pipe-v2"
mkdir -p "$APP_DIR"
cd "$APP_DIR"

if [ ! -d ".git" ]; then
    git clone https://github.com/jflournoy/image-gen-pipe-v2.git .
else
    echo "Repository already exists, pulling latest changes..."
    git pull origin main
fi

echo -e "${GREEN}[OK] Repository cloned${NC}"
echo ""

# Step 4: Install dependencies
echo -e "${YELLOW}Step 4: Installing Node dependencies...${NC}"
npm ci --omit=dev --ignore-scripts

echo -e "${GREEN}[OK] Dependencies installed${NC}"
echo ""

# Step 5: Create .env file
echo -e "${YELLOW}Step 5: Creating .env configuration...${NC}"
cat > "$APP_DIR/.env" << EOF
# Server Configuration
NODE_ENV=production
PORT=3000

# Session and Storage
SESSION_HISTORY_DIR=$APP_DIR/session-history
IMAGES_DIR=$APP_DIR/session-history

# OpenAI API Key
# NOTE: Users provide their own API keys via X-OpenAI-API-Key header
# Do NOT set OPENAI_API_KEY here - this ensures all API calls use user-provided keys only
# OPENAI_API_KEY=

# Logging (optional)
LOG_LEVEL=info
EOF

chmod 600 "$APP_DIR/.env"
echo -e "${GREEN}[OK] .env file created (no server API key stored)${NC}"
echo ""

# Step 6: Create systemd service
echo -e "${YELLOW}Step 6: Setting up systemd service...${NC}"
cat > /etc/systemd/system/image-gen-pipe.service << 'SYSTEMD_EOF'
[Unit]
Description=Image Generation Pipe - Beam Search Demo
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/image-gen-pipe-v2
ExecStart=/usr/bin/node src/api/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Resource limits (adjust as needed)
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
SYSTEMD_EOF

systemctl daemon-reload
systemctl enable image-gen-pipe
systemctl start image-gen-pipe

# Wait for service to start
sleep 2

if systemctl is-active --quiet image-gen-pipe; then
    echo -e "${GREEN}[OK] Systemd service created and running${NC}"
else
    echo -e "${RED}[FAIL] Service failed to start. Check logs:${NC}"
    journalctl -u image-gen-pipe -n 20
    exit 1
fi
echo ""

# Step 7: Install and configure Nginx
echo -e "${YELLOW}Step 7: Installing Nginx...${NC}"
apt install -y nginx

# Determine server name
if [ -n "$DOMAIN_NAME" ]; then
    SERVER_NAME="$DOMAIN_NAME"
else
    SERVER_NAME="_"  # Default - any hostname
fi

# Create Nginx config
cat > /etc/nginx/sites-available/image-gen-pipe << EOF
upstream node_app {
  server localhost:3000;
}

server {
  listen 80;
  server_name $SERVER_NAME;

  client_max_body_size 50M;

  # Gzip compression
  gzip on;
  gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

  location / {
    proxy_pass http://node_app;
    proxy_http_version 1.1;

    # WebSocket support
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";

    # Standard headers
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;

    # Timeouts for long-running requests
    proxy_connect_timeout 60s;
    proxy_send_timeout 3600s;
    proxy_read_timeout 3600s;
  }
}
EOF

# Enable Nginx config
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/image-gen-pipe /etc/nginx/sites-enabled/

# Test and restart Nginx
if nginx -t; then
    systemctl restart nginx
    echo -e "${GREEN}[OK] Nginx configured and running${NC}"
else
    echo -e "${RED}[FAIL] Nginx configuration error${NC}"
    exit 1
fi
echo ""

# Step 8: Setup HTTPS (optional)
if [ -n "$LETSENCRYPT_EMAIL" ] && [ -n "$DOMAIN_NAME" ]; then
    echo -e "${YELLOW}Step 8: Setting up HTTPS with Let's Encrypt...${NC}"
    apt install -y certbot python3-certbot-nginx

    certbot certonly --non-interactive --agree-tos --email "$LETSENCRYPT_EMAIL" -d "$DOMAIN_NAME" --nginx || {
        echo -e "${YELLOW}[WARN] HTTPS setup skipped (certbot may need manual configuration)${NC}"
    }

    echo -e "${GREEN}[OK] HTTPS configured${NC}"
    echo ""
else
    if [ -z "$DOMAIN_NAME" ]; then
        echo -e "${YELLOW}Skipped: No domain name provided (using HTTP for IP access)${NC}"
    else
        echo -e "${YELLOW}Skipped: No email provided for Let's Encrypt${NC}"
    fi
    echo ""
fi

# Step 9: Create directories
mkdir -p "$APP_DIR/session-history"
chmod 755 "$APP_DIR/session-history"

# Step 10: Display summary
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${GREEN}Service Status:${NC}"
systemctl status image-gen-pipe --no-pager
echo ""
echo -e "${GREEN}Access your application at:${NC}"
if [ -n "$DOMAIN_NAME" ]; then
    echo -e "  ${GREEN}https://$DOMAIN_NAME${NC}"
else
    IP=$(hostname -I | awk '{print $1}')
    echo -e "  ${GREEN}http://$IP${NC}"
fi
echo ""
echo -e "${GREEN}API Key Configuration:${NC}"
echo -e "  ${YELLOW}Users must provide their own OpenAI API keys${NC}"
echo "  - No server API key is configured"
echo "  - Keys are passed via X-OpenAI-API-Key header"
echo "  - Keys are NOT stored on the server"
echo "  - Each user is responsible for their own costs"
echo ""
echo -e "${GREEN}Useful commands:${NC}"
echo "  View logs:           journalctl -u image-gen-pipe -f"
echo "  Restart service:     systemctl restart image-gen-pipe"
echo "  Check status:        systemctl status image-gen-pipe"
echo "  Update app:          cd $APP_DIR && git pull origin main && npm install && systemctl restart image-gen-pipe"
echo ""
echo -e "${GREEN}Next steps:${NC}"
echo "  1. Test the app at the URL above"
echo "  2. When starting a beam search, you'll be asked for your OpenAI API key"
echo "  3. Check logs if you encounter issues: journalctl -u image-gen-pipe -f"
echo ""

# Create an update script for convenience
cat > "$APP_DIR/update.sh" << 'UPDATE_SCRIPT'
#!/bin/bash
# Quick update script
cd /var/www/image-gen-pipe-v2
git pull origin main
npm ci --omit=dev --ignore-scripts
systemctl restart image-gen-pipe
echo "[OK] App updated and service restarted"
journalctl -u image-gen-pipe -n 10
UPDATE_SCRIPT

chmod +x "$APP_DIR/update.sh"

echo -e "${GREEN}Created update script: $APP_DIR/update.sh${NC}"
echo ""
