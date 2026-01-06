# Deployment Guide

Quick deployment scripts and guides for running Image Gen Pipe V2.

## Linode Deployment (Recommended for $5/month)

### 1. Create a Linode

1. Go to [Linode Dashboard](https://cloud.linode.com)
2. Click **Create → Linode**
3. Choose:
   - **Image**: Ubuntu 22.04 LTS
   - **Region**: Closest to your users
   - **Linode Plan**: Nanode 1GB ($5/month) or higher
   - **Label**: `image-gen-pipe-v2` (or your choice)
   - **Add SSH Key** during creation (recommended for security)
4. Click **Create Linode**
5. Wait 2-3 minutes for boot

### 2. Run Setup Script

Once your Linode is booted, SSH in and run the setup script:

```bash
# SSH into your Linode
ssh root@<your-linode-ip>

# Download and run setup script
curl -sSL https://raw.githubusercontent.com/jflournoy/image-gen-pipe-v2/main/deploy/linode-setup.sh | bash
```

Or if you have the script locally:

```bash
bash deploy/linode-setup.sh
```

The script will:
- Update system packages
- Install Node.js 22
- Clone your repository
- Install dependencies
- Create `.env` configuration (no server API key stored)
- Set up systemd service (auto-restart on failure)
- Install and configure Nginx (reverse proxy with WebSocket support)
- Optionally set up HTTPS with Let's Encrypt

### 3. Configuration Prompts

When the script runs, you'll be asked for:

```
Domain Name: your-domain.com (optional, for HTTPS)
Email for Let's Encrypt: your@email.com (optional, for HTTPS)
```

**Note:** No OpenAI API key is needed during setup. Users provide their own keys when using the app.

### 4. Access Your App

After deployment completes:

**If you provided a domain:**
- Visit `https://your-domain.com`

**If you only have an IP:**
- Visit `http://<your-linode-ip>`

## Common Tasks

### View Logs

```bash
# Real-time logs
journalctl -u image-gen-pipe -f

# Last 20 lines
journalctl -u image-gen-pipe -n 20

# Since last boot
journalctl -u image-gen-pipe -b
```

### Restart Service

```bash
systemctl restart image-gen-pipe
```

### Check Service Status

```bash
systemctl status image-gen-pipe
```

### Update App

```bash
cd /var/www/image-gen-pipe-v2
bash update.sh
```

Or manually:

```bash
cd /var/www/image-gen-pipe-v2
git pull origin main
npm ci --omit=dev --ignore-scripts
systemctl restart image-gen-pipe
```

## Troubleshooting

### Service won't start

Check logs:
```bash
journalctl -u image-gen-pipe -n 50
```

Common issues:
- **Port 3000 already in use**: Change PORT in `.env`
- **Missing OpenAI API key**: Update `.env` with valid key and restart
- **Missing node_modules**: Run `npm install` in app directory

### Nginx errors

```bash
# Test Nginx config
nginx -t

# Check if listening
netstat -tlnp | grep nginx
```

### App runs but frontend is blank

Check browser console for errors. Ensure:
- You're accessing via the correct URL
- Nginx is proxying WebSocket correctly (check nginx config)
- API key in `.env` is valid

## Monitoring

### Memory Usage

```bash
free -h
```

For $5 Linode (1GB RAM):
- Node.js + Nginx: ~150MB at rest
- Each concurrent session: ~50-100MB
- Should handle 3-5 concurrent beam search jobs

### Disk Usage

```bash
df -h
```

Generated images use ~100KB-1MB each. Monitor session-history:
```bash
du -sh /var/www/image-gen-pipe-v2/session-history
```

For future scale: Add Object Storage ($5/mo) and modify image saving.

### Systemd Service Management

```bash
# Enable (auto-start on boot)
systemctl enable image-gen-pipe

# Disable (don't auto-start)
systemctl disable image-gen-pipe

# Check if enabled
systemctl is-enabled image-gen-pipe
```

## Backup & Recovery

### Backup Session History

```bash
# Create backup
tar czf session-history-backup.tar.gz /var/www/image-gen-pipe-v2/session-history

# Download via SCP
scp root@<linode-ip>:session-history-backup.tar.gz ./
```

### Backup .env (contains API key!)

```bash
# Secure backup
cp /var/www/image-gen-pipe-v2/.env ~/.env.backup
chmod 600 ~/.env.backup
```

## Performance Tuning

### Increase File Descriptors

For many concurrent users (edit `/etc/security/limits.conf`):

```
* soft nofile 65536
* hard nofile 65536
```

### Enable GZIP Compression

Already enabled in Nginx config, but verify:

```bash
curl -I -H "Accept-Encoding: gzip" http://localhost:3000
# Should see: Content-Encoding: gzip
```

### Monitor Process

```bash
# Watch Node.js process
watch -n 1 'ps aux | grep node'

# Check memory usage over time
ps aux | grep node | grep -v grep
```

## Cost Breakdown (Monthly)

| Item | Cost | Notes |
|------|------|-------|
| Linode 1GB | $5 | 1 CPU, 1GB RAM, 25GB SSD |
| Bandwidth | $0 | First 1TB/month included |
| **Total** | **$5** | Plenty for hobby/testing |

To upgrade: `linode-cli linodes update <ID> --type g6-standard-2` (2GB = $10/mo)

## Security Recommendations

### 1. Firewall

```bash
# Allow SSH, HTTP, HTTPS only
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

### 2. Fail2Ban (rate limiting)

```bash
apt install fail2ban
systemctl enable fail2ban
systemctl start fail2ban
```

### 3. Regular Updates

```bash
# Weekly system updates
apt update && apt upgrade
```

### 4. HTTPS Only

Ensure users must use HTTPS when providing their OpenAI API keys. This is handled automatically by the setup script with Let's Encrypt.

## Need Help?

Check:
- Logs: `journalctl -u image-gen-pipe -f`
- Nginx config: `/etc/nginx/sites-available/image-gen-pipe`
- App config: `/var/www/image-gen-pipe-v2/.env`
- GitHub Issues: https://github.com/jflournoy/image-gen-pipe-v2/issues
