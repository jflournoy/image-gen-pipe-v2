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

# Step 6: Create dedicated user for Node.js app (SECURITY FIX)
echo -e "${YELLOW}Step 6: Creating dedicated user for security...${NC}"
if ! id -u nodeapp > /dev/null 2>&1; then
    useradd --system --no-create-home --shell /bin/false nodeapp
    echo -e "${GREEN}[OK] Created nodeapp user${NC}"
else
    echo -e "${GREEN}[OK] nodeapp user already exists${NC}"
fi

# Create home directory for npm cache (npm requires it)
mkdir -p /home/nodeapp
chown nodeapp:nodeapp /home/nodeapp
chmod 755 /home/nodeapp
echo -e "${GREEN}[OK] Created home directory for npm cache${NC}"

# Set ownership of app directory
chown -R nodeapp:nodeapp "$APP_DIR"
echo -e "${GREEN}[OK] Set ownership to nodeapp user${NC}"
echo ""

# Step 7: Create systemd service
echo -e "${YELLOW}Step 7: Setting up systemd service...${NC}"
cat > /etc/systemd/system/image-gen-pipe.service << 'SYSTEMD_EOF'
[Unit]
Description=Image Generation Pipe - Beam Search Demo
After=network.target

[Service]
Type=simple
User=nodeapp
Group=nodeapp
WorkingDirectory=/var/www/image-gen-pipe-v2
ExecStart=/usr/bin/node src/api/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/www/image-gen-pipe-v2/session-history

# Resource limits
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

# Step 8: Configure firewall
echo -e "${YELLOW}Step 8: Configuring firewall...${NC}"
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

# Step 9: Install and configure fail2ban (SECURITY FIX)
echo -e "${YELLOW}Step 9: Installing fail2ban for SSH protection...${NC}"
apt-get install -y fail2ban

# Create fail2ban configuration for SSH
cat > /etc/fail2ban/jail.local << 'FAIL2BAN_EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = 22
logpath = /var/log/auth.log
FAIL2BAN_EOF

systemctl enable fail2ban
systemctl start fail2ban

echo -e "${GREEN}[OK] fail2ban configured${NC}"
echo ""

# Step 10: SSH Hardening (SECURITY FIX)
echo -e "${YELLOW}Step 10: Hardening SSH configuration...${NC}"

# Backup original sshd_config
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup

# Apply SSH hardening
cat >> /etc/ssh/sshd_config << 'SSH_EOF'

# Security hardening added by deployment script
PasswordAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
ChallengeResponseAuthentication no
UsePAM yes
X11Forwarding no
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2
SSH_EOF

echo -e "${GREEN}[OK] SSH hardened (restart SSH later to apply)${NC}"
echo ""

# Step 11: Install and configure Nginx (SECURITY FIX: headers + rate limiting)
echo -e "${YELLOW}Step 11: Installing Nginx with security headers...${NC}"
apt-get install -y nginx

# Determine server name
if [ -n "$DOMAIN_NAME" ]; then
    SERVER_NAME="$DOMAIN_NAME"
else
    SERVER_NAME="_"  # Default - any hostname
fi

# Create Nginx config with rate limiting and security headers
cat > /etc/nginx/sites-available/image-gen-pipe << EOF
# Rate limiting zone (SECURITY FIX)
limit_req_zone \$binary_remote_addr zone=api_limit:10m rate=10r/s;
limit_req_zone \$binary_remote_addr zone=general_limit:10m rate=30r/s;

upstream node_app {
  server localhost:3000;
}

server {
  listen 80;
  server_name $SERVER_NAME;

  # Reduced upload limit (SECURITY FIX: was 50M)
  client_max_body_size 10M;

  # Security headers (SECURITY FIX)
  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-XSS-Protection "1; mode=block" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;

  # Gzip compression
  gzip on;
  gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

  # Let's Encrypt ACME challenge (must be before other location blocks)
  location ^~ /.well-known/acme-challenge/ {
    root /var/www/html;
    default_type text/plain;
  }

  # API endpoints with stricter rate limiting
  location ~ ^/api/(demo|generate) {
    limit_req zone=api_limit burst=20 nodelay;
    limit_req_status 429;

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

  # All other requests with general rate limiting
  location / {
    limit_req zone=general_limit burst=50 nodelay;
    limit_req_status 429;

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

# Step 12: Install certbot (for later HTTPS setup)
echo -e "${YELLOW}Step 12: Installing certbot...${NC}"
apt-get install -y certbot python3-certbot-nginx

echo -e "${GREEN}[OK] Certbot installed${NC}"
echo ""

# Step 13: Configure automatic security updates (SECURITY FIX)
echo -e "${YELLOW}Step 13: Configuring automatic security updates...${NC}"
apt-get install -y unattended-upgrades apt-listchanges

# Configure unattended-upgrades
cat > /etc/apt/apt.conf.d/50unattended-upgrades << 'UNATTENDED_EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::MinimalSteps "true";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
UNATTENDED_EOF

cat > /etc/apt/apt.conf.d/20auto-upgrades << 'AUTO_UPGRADES_EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
APT::Periodic::Unattended-Upgrade "1";
AUTO_UPGRADES_EOF

echo -e "${GREEN}[OK] Automatic security updates enabled${NC}"
echo ""

# Step 14: Create directories
mkdir -p "$APP_DIR/session-history"
chmod 755 "$APP_DIR/session-history"

# Create webroot for Let's Encrypt ACME challenges
mkdir -p /var/www/html/.well-known/acme-challenge
chmod -R 755 /var/www/html

# Step 15: Display summary
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
echo -e "${GREEN}Security Features Enabled:${NC}"
echo "  [OK] App runs as dedicated 'nodeapp' user (not root)"
echo "  [OK] Firewall configured (UFW: ports 22, 80, 443 only)"
echo "  [OK] fail2ban protecting SSH (max 5 attempts in 10 min)"
echo "  [OK] SSH hardened (no password auth, pubkey only)"
echo "  [OK] Rate limiting (10 req/s API, 30 req/s general)"
echo "  [OK] Security headers (XSS, clickjacking protection)"
echo "  [OK] Automatic security updates enabled"
echo "  [OK] Upload limit: 10M (reduced from 50M)"
echo "  [OK] Users provide their own OpenAI API keys"
echo "  [OK] No server API key stored"
echo ""
echo -e "${YELLOW}IMPORTANT: SSH Configuration${NC}"
echo "  - SSH now requires public key authentication"
echo "  - Make sure you have SSH keys set up before logging out!"
echo "  - Restart SSH to apply: systemctl restart sshd"
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
set -e

cd /var/www/image-gen-pipe-v2

# Run git as nodeapp user (directory owner)
echo "Pulling latest changes..."
sudo -u nodeapp git pull origin main

# Ensure nodeapp home directory exists (for npm cache)
echo "Ensuring home directory exists..."
mkdir -p /home/nodeapp
chown nodeapp:nodeapp /home/nodeapp

# Fix ownership of entire directory (in case root created files)
echo "Fixing file ownership..."
chown -R nodeapp:nodeapp /var/www/image-gen-pipe-v2

# Install dependencies as nodeapp user
echo "Installing dependencies..."
sudo -u nodeapp npm ci --omit=dev --ignore-scripts

# Restart service (requires root)
echo "Restarting service..."
systemctl restart image-gen-pipe

echo "[OK] App updated and service restarted"
echo ""
echo "Recent logs:"
journalctl -u image-gen-pipe -n 10 --no-pager
UPDATE_SCRIPT

chmod +x "$APP_DIR/update.sh"

echo -e "${GREEN}Created update script: $APP_DIR/update.sh${NC}"
echo ""
