#!/bin/bash

#############################################################################
# Linode Deployment Script for Image Gen Pipe V2
#
# Usage: curl -sSL https://raw.githubusercontent.com/jflournoy/image-gen-pipe-v2/main/deploy/linode-setup.sh | bash
# Or: bash linode-setup.sh
#
# This script sets up a fresh Ubuntu 22.04 or 24.04 Linode with:
# - Node.js 22
# - Your app deployed and running as a systemd service
# - Nginx reverse proxy with WebSocket support
# - Optional HTTPS with Let's Encrypt
#############################################################################

set -e  # Exit on error

# Ensure non-interactive mode for apt
export DEBIAN_FRONTEND=noninteractive

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Image Gen Pipe V2 - Linode Setup${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root${NC}"
   exit 1
fi

# Gather user input (can be set via environment variables or interactively)
if [ -z "$DOMAIN_NAME" ] && [ -z "$LETSENCRYPT_EMAIL" ]; then
    echo -e "${YELLOW}Configuration:${NC}"
    echo -e "${GREEN}NOTE: Users will provide their own OpenAI API keys (no server key stored)${NC}"
    read -p "Enter domain name (or leave blank for IP access): " DOMAIN_NAME
    read -p "Enter email for Let's Encrypt (or leave blank to skip HTTPS): " LETSENCRYPT_EMAIL
fi

echo ""
echo -e "${YELLOW}Configuration:${NC}"
echo "Domain: ${DOMAIN_NAME:-'(IP access only)'}"
echo "Email: ${LETSENCRYPT_EMAIL:-'(HTTPS disabled)'}"
echo ""

# Step 1: Update system
echo -e "${YELLOW}Step 1: Updating system packages...${NC}"
apt-get update
apt-get upgrade -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"
apt-get install -y curl wget git build-essential

echo -e "${GREEN}[OK] System updated${NC}"
echo ""

# Step 2: Install Node.js
echo -e "${YELLOW}Step 2: Installing Node.js 22...${NC}"
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

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

# Step 7: Configure firewall
echo -e "${YELLOW}Step 7: Configuring firewall...${NC}"
apt-get install -y ufw

# Configure UFW
ufw --force enable
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS

echo -e "${GREEN}[OK] Firewall configured${NC}"
echo ""

# Step 8: Install and configure Nginx
echo -e "${YELLOW}Step 8: Installing Nginx...${NC}"
apt-get install -y nginx

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

# Step 9: Install certbot (for later HTTPS setup)
echo -e "${YELLOW}Step 9: Installing certbot...${NC}"
apt-get install -y certbot python3-certbot-nginx

echo -e "${GREEN}[OK] Certbot installed${NC}"
echo ""

# Step 10: Create directories
mkdir -p "$APP_DIR/session-history"
chmod 755 "$APP_DIR/session-history"

# Step 11: Display summary
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${GREEN}Service Status:${NC}"
systemctl status image-gen-pipe --no-pager
echo ""
IP=$(hostname -I | awk '{print $1}')
echo -e "${GREEN}Server IP Address:${NC} ${YELLOW}$IP${NC}"
echo ""
echo -e "${GREEN}Access your application at:${NC}"
echo -e "  ${GREEN}http://$IP${NC} (HTTP only - HTTPS not configured yet)"
echo ""
echo -e "${YELLOW}=== IMPORTANT: HTTPS Setup Required ===${NC}"
echo -e "${YELLOW}To enable HTTPS:${NC}"
echo "  1. Update DNS: Point your domain A record to: $IP"
echo "  2. Wait 2-5 minutes for DNS propagation"
echo "  3. Run: bash $APP_DIR/deploy/finish-setup.sh"
echo ""
echo -e "${GREEN}Security:${NC}"
echo "  - Firewall configured (ports 22, 80, 443 allowed)"
echo "  - Users must provide their own OpenAI API keys"
echo "  - No server API key stored"
echo ""
echo -e "${GREEN}Useful commands:${NC}"
echo "  View logs:           journalctl -u image-gen-pipe -f"
echo "  Restart service:     systemctl restart image-gen-pipe"
echo "  Check status:        systemctl status image-gen-pipe"
echo "  Update app:          bash $APP_DIR/deploy/update.sh"
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
