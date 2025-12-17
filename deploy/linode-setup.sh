#!/bin/bash

#############################################################################
# Linode Deployment Script for Image Gen Pipe V2
#
# Usage: curl -sSL https://raw.githubusercontent.com/jflournoy/image-gen-pipe-v2/main/deploy/linode-setup.sh | bash
# Or: bash linode-setup.sh
#
# This script sets up a fresh Ubuntu 22.04 Linode with:
# - Node.js 20
# - Your app deployed and running as a systemd service
# - Nginx reverse proxy
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

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root${NC}"
   exit 1
fi

# Gather user input
echo -e "${YELLOW}Configuration:${NC}"
read -p "Enter your OpenAI API key: " OPENAI_API_KEY
read -p "Enter domain name (or leave blank for IP access): " DOMAIN_NAME
read -p "Enter email for Let's Encrypt (or leave blank to skip HTTPS): " LETSENCRYPT_EMAIL

# Validate OpenAI API key
if [ -z "$OPENAI_API_KEY" ]; then
    echo -e "${RED}Error: OpenAI API key is required${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✓ Configuration saved${NC}"
echo ""

# Step 1: Update system
echo -e "${YELLOW}Step 1: Updating system packages...${NC}"
apt update
apt upgrade -y
apt install -y curl wget git build-essential

echo -e "${GREEN}✓ System updated${NC}"
echo ""

# Step 2: Install Node.js
echo -e "${YELLOW}Step 2: Installing Node.js 20...${NC}"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt install -y nodejs

echo -e "${GREEN}✓ Node.js installed: $(node --version)${NC}"
echo ""

# Step 3: Create app directory and clone repo
echo -e "${YELLOW}Step 3: Cloning repository...${NC}"
APP_DIR="/var/www/image-gen-pipe-v2"
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# Check if already cloned
if [ ! -d ".git" ]; then
    git clone https://github.com/jflournoy/image-gen-pipe-v2.git .
else
    echo "Repository already exists, pulling latest changes..."
    git pull origin main
fi

echo -e "${GREEN}✓ Repository cloned${NC}"
echo ""

# Step 4: Install dependencies
echo -e "${YELLOW}Step 4: Installing Node dependencies...${NC}"
npm install --production

echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# Step 5: Create .env file
echo -e "${YELLOW}Step 5: Creating .env configuration...${NC}"
cat > "$APP_DIR/.env" << EOF
# OpenAI Configuration
OPENAI_API_KEY=$OPENAI_API_KEY

# Server Configuration
NODE_ENV=production
PORT=3000

# Session and Storage
SESSION_HISTORY_DIR=$APP_DIR/session-history
IMAGES_DIR=$APP_DIR/session-history

# Logging (optional)
LOG_LEVEL=info
EOF

chmod 600 "$APP_DIR/.env"
echo -e "${GREEN}✓ .env file created${NC}"
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
    echo -e "${GREEN}✓ Systemd service created and running${NC}"
else
    echo -e "${RED}✗ Service failed to start. Check logs:${NC}"
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
    echo -e "${GREEN}✓ Nginx configured and running${NC}"
else
    echo -e "${RED}✗ Nginx configuration error${NC}"
    exit 1
fi
echo ""

# Step 8: Setup HTTPS (optional)
if [ -n "$LETSENCRYPT_EMAIL" ] && [ -n "$DOMAIN_NAME" ]; then
    echo -e "${YELLOW}Step 8: Setting up HTTPS with Let's Encrypt...${NC}"
    apt install -y certbot python3-certbot-nginx

    certbot certonly --non-interactive --agree-tos --email "$LETSENCRYPT_EMAIL" -d "$DOMAIN_NAME" --nginx || {
        echo -e "${YELLOW}⚠ HTTPS setup skipped (certbot may need manual configuration)${NC}"
    }

    echo -e "${GREEN}✓ HTTPS configured${NC}"
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
echo -e "${GREEN}Useful commands:${NC}"
echo "  View logs:           journalctl -u image-gen-pipe -f"
echo "  Restart service:     systemctl restart image-gen-pipe"
echo "  Check status:        systemctl status image-gen-pipe"
echo "  Update app:          cd $APP_DIR && git pull origin main && npm install && systemctl restart image-gen-pipe"
echo ""
echo -e "${GREEN}Next steps:${NC}"
echo "  1. Test the app at the URL above"
echo "  2. Start a beam search job to verify it's working"
echo "  3. Check logs if you encounter issues"
echo ""

# Create an update script for convenience
cat > "$APP_DIR/update.sh" << 'UPDATE_SCRIPT'
#!/bin/bash
# Quick update script
cd /var/www/image-gen-pipe-v2
git pull origin main
npm install --production
systemctl restart image-gen-pipe
echo "✓ App updated and service restarted"
journalctl -u image-gen-pipe -n 10
UPDATE_SCRIPT

chmod +x "$APP_DIR/update.sh"

echo -e "${GREEN}Created update script: $APP_DIR/update.sh${NC}"
echo ""
