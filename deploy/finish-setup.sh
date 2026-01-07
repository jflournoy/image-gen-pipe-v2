#!/bin/bash

#############################################################################
# Finish Setup Script for Image Gen Pipe V2
#
# Run this AFTER:
# 1. Initial deployment with linode-stackscript.sh
# 2. DNS A record points to your server IP
# 3. DNS has propagated (wait 2-5 minutes)
#
# Usage: bash finish-setup.sh
#############################################################################

set -e  # Exit on error

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Image Gen Pipe V2 - HTTPS Setup${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root${NC}"
   exit 1
fi

# Get user input
echo -e "${YELLOW}HTTPS Configuration${NC}"
read -p "Enter your domain name: " DOMAIN_NAME
read -p "Enter your email for Let's Encrypt: " LETSENCRYPT_EMAIL

if [ -z "$DOMAIN_NAME" ] || [ -z "$LETSENCRYPT_EMAIL" ]; then
    echo -e "${RED}Both domain name and email are required!${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}Configuration:${NC}"
echo "Domain: $DOMAIN_NAME"
echo "Email: $LETSENCRYPT_EMAIL"
echo ""

# Verify DNS is pointing to this server
echo -e "${YELLOW}Step 1: Verifying DNS configuration...${NC}"
SERVER_IP=$(hostname -I | awk '{print $1}')
DNS_IP=$(dig +short "$DOMAIN_NAME" | tail -n1)

echo "Server IP: $SERVER_IP"
echo "DNS points to: $DNS_IP"

if [ "$SERVER_IP" != "$DNS_IP" ]; then
    echo -e "${RED}[WARN] DNS does not point to this server!${NC}"
    echo "Expected: $SERVER_IP"
    echo "Got: $DNS_IP"
    echo ""
    read -p "Continue anyway? (y/N): " CONTINUE
    if [ "$CONTINUE" != "y" ] && [ "$CONTINUE" != "Y" ]; then
        echo "Aborting. Please update DNS and try again."
        exit 1
    fi
fi

echo -e "${GREEN}[OK] DNS check complete${NC}"
echo ""

# Test HTTP connectivity
echo -e "${YELLOW}Step 2: Testing HTTP connectivity...${NC}"
if curl -s -I "http://$DOMAIN_NAME" | head -n 1 | grep -q "200\|301\|302"; then
    echo -e "${GREEN}[OK] Domain is accessible via HTTP${NC}"
else
    echo -e "${RED}[FAIL] Cannot reach domain via HTTP${NC}"
    echo "Make sure:"
    echo "  - DNS has propagated (try: dig $DOMAIN_NAME)"
    echo "  - Firewall allows port 80 (already configured)"
    echo "  - Nginx is running (systemctl status nginx)"
    exit 1
fi
echo ""

# Ensure ACME webroot exists
echo -e "${YELLOW}Step 3: Preparing for Let's Encrypt...${NC}"
mkdir -p /var/www/html/.well-known/acme-challenge
chmod -R 755 /var/www/html

# Test ACME challenge path
echo "test" > /var/www/html/.well-known/acme-challenge/test
if curl -s "http://$DOMAIN_NAME/.well-known/acme-challenge/test" | grep -q "test"; then
    echo -e "${GREEN}[OK] ACME challenge path is accessible${NC}"
    rm /var/www/html/.well-known/acme-challenge/test
else
    echo -e "${RED}[WARN] ACME challenge path may not be accessible${NC}"
    echo "This might cause issues, but attempting anyway..."
fi
echo ""

# Run certbot
echo -e "${YELLOW}Step 4: Obtaining SSL certificate...${NC}"
certbot --nginx \
  --non-interactive \
  --agree-tos \
  --email "$LETSENCRYPT_EMAIL" \
  -d "$DOMAIN_NAME" \
  --redirect \
  --preferred-challenges http

if [ $? -eq 0 ]; then
    echo -e "${GREEN}[OK] HTTPS configured successfully${NC}"
else
    echo -e "${RED}[FAIL] HTTPS setup failed${NC}"
    echo ""
    echo "Debug information:"
    echo "  - Check logs: tail -50 /var/log/letsencrypt/letsencrypt.log"
    echo "  - Verify nginx config: nginx -t"
    echo "  - Test ACME path: curl http://$DOMAIN_NAME/.well-known/acme-challenge/test"
    echo ""
    echo "Common issues:"
    echo "  1. DNS not fully propagated (wait 10-15 more minutes)"
    echo "  2. Port 80 not accessible from internet"
    echo "  3. Nginx not serving ACME challenge path correctly"
    exit 1
fi
echo ""

# Verify certificate
echo -e "${YELLOW}Step 5: Verifying SSL certificate...${NC}"
certbot certificates

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}HTTPS Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${GREEN}Your site is now accessible at:${NC}"
echo -e "  ${GREEN}https://$DOMAIN_NAME${NC}"
echo ""
echo -e "${GREEN}Certificate Details:${NC}"
echo "  - Issued by: Let's Encrypt"
echo "  - Auto-renewal: Configured (certbot.timer)"
echo "  - Check renewal: systemctl status certbot.timer"
echo ""
echo -e "${GREEN}Security Features:${NC}"
echo "  - HTTPS enabled with valid SSL certificate"
echo "  - HTTP automatically redirects to HTTPS"
echo "  - Firewall configured (UFW)"
echo "  - User API keys only (no server key stored)"
echo ""
echo -e "${YELLOW}Test your site:${NC}"
echo "  curl -I https://$DOMAIN_NAME"
echo ""
