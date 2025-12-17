# Post-Deployment Checklist

After running the setup script, verify everything is working:

## ✓ Immediate Checks (Do These First)

- [ ] Service is running: `systemctl status image-gen-pipe`
- [ ] No errors in logs: `journalctl -u image-gen-pipe -n 20`
- [ ] Nginx is running: `systemctl status nginx`
- [ ] Can access the app:
  - Via IP: `curl http://<your-linode-ip>`
  - Via domain: `curl https://your-domain.com` (if set up)

## ✓ Functional Tests

Open the app in your browser:

1. **Homepage loads**
   - [ ] UI appears (form, messages, images sections)
   - [ ] No console errors (F12 → Console)

2. **Try a small beam search**
   - [ ] Enter a simple prompt (e.g., "a cat")
   - [ ] Set: n=2, m=1, iterations=1 (fastest)
   - [ ] Click "Start Beam Search"
   - [ ] Messages appear in real-time
   - [ ] Images generate and display
   - [ ] Shows final winner with lineage

3. **Image preview modal**
   - [ ] Click any generated image
   - [ ] Modal popup appears
   - [ ] Press Escape key
   - [ ] Modal closes

4. **Check costs display**
   - [ ] Token counts show up
   - [ ] Estimated cost calculates
   - [ ] Updates as job progresses

## ✓ System Health

Run these on your Linode:

```bash
# Check memory usage (should have <100MB free)
free -h

# Check disk usage (should have >10GB free)
df -h

# Check network
curl -I https://api.openai.com  # Should work (verify API connectivity)

# Check process is consuming resources
ps aux | grep "node src/api" | grep -v grep
```

Expected:
- [ ] Node process running
- [ ] <200MB memory usage at rest
- [ ] Disk >80% free
- [ ] Can reach openai.com

## ✓ Long-Running Test

Run a 2-iteration beam search:

1. Prompt: "a beautiful sunset over mountains"
2. Settings: n=4, m=2, iterations=2
3. Click Start
4. Let it run to completion (~2-3 minutes)
5. Verify:
   - [ ] All 4 iteration-0 images generate
   - [ ] Top 2 are selected
   - [ ] 4 iteration-1 images generate
   - [ ] Final ranking shows all candidates
   - [ ] Lineage shows winner's path
   - [ ] All images have clickable previews

## ✓ Auto-Restart Test

Verify the service auto-restarts on failure:

```bash
# Kill the process
pkill -f "node src/api"

# Wait 2 seconds
sleep 2

# Check if it restarted
systemctl status image-gen-pipe

# Should show "active (running)"
```

If it didn't auto-restart:
- Check .env file is valid: `cat /var/www/image-gen-pipe-v2/.env`
- Check logs: `journalctl -u image-gen-pipe -n 50`

## ✓ Update Script Test

Verify you can update the app:

```bash
cd /var/www/image-gen-pipe-v2
bash update.sh
```

Expected:
- [ ] Script runs without errors
- [ ] Service restarts
- [ ] App still works after restart

## ✓ Security Quick Check

```bash
# Check if firewall is enabled
ufw status

# Check if SSH key-based auth works
# (should be set up already)
ssh root@<linode-ip> "echo 'Connected successfully'"
```

## ⚠️ Common Issues & Fixes

### Issue: "Connection refused" when accessing the app

```bash
# Check if service is running
systemctl status image-gen-pipe

# If not running, check why
journalctl -u image-gen-pipe -n 50

# Restart service
systemctl restart image-gen-pipe
```

### Issue: Images don't generate

```bash
# Check API key is valid
cat /var/www/image-gen-pipe-v2/.env | grep OPENAI_API_KEY

# If wrong, update .env
nano /var/www/image-gen-pipe-v2/.env

# Restart service
systemctl restart image-gen-pipe
```

### Issue: Page loads but is blank

1. Open browser DevTools (F12)
2. Check Console tab for errors
3. Check Network tab - are requests being made?
4. Common causes:
   - OpenAI API key invalid (check logs)
   - Rate limiting (wait a moment)
   - WebSocket connection issues (check Nginx config)

### Issue: HTTPS not working

```bash
# Check certbot status
certbot certificates

# Renew if needed
certbot renew --dry-run

# Check Nginx is serving HTTPS
curl -I https://your-domain.com
```

## 📊 Performance Baseline

After successful deployment, these are normal values for a $5 Linode:

| Metric | Value | Notes |
|--------|-------|-------|
| Memory (idle) | 150-200MB | Node + Nginx |
| Memory (1 job) | 250-350MB | Running beam search |
| Memory (3 jobs) | 600-800MB | Approaching limit |
| CPU (idle) | 0-5% | Mostly waiting for API |
| CPU (active) | 20-50% | During generation |
| Disk (images) | ~100KB-1MB each | Keep <8GB total |
| Request latency | <100ms | Nginx to Node |
| WebSocket latency | <50ms | Real-time updates |

⚠️ **Note**: With only 1GB RAM, running >3 concurrent beam searches may cause slowdowns. Consider upgrading to 2GB ($10/mo) for production use.

## 🎉 You're Ready!

If all checks pass:
- [ ] Bookmark your app URL
- [ ] Save your API key somewhere safe
- [ ] Set a reminder to update dependencies monthly
- [ ] Monitor logs periodically: `journalctl -u image-gen-pipe -f`

## Next Steps

1. **Run more complex searches** to test the system
2. **Monitor resource usage** during peak usage
3. **Set up log rotation** if you plan to keep it running long-term:
   ```bash
   journalctl --vacuum-time=7d  # Keep only 7 days of logs
   ```
4. **Back up your session history** periodically
5. **Subscribe to updates** if you want new features

## Support

If something doesn't work:

1. Check logs first: `journalctl -u image-gen-pipe -f`
2. Review this checklist
3. Review `/deploy/README.md`
4. Check GitHub Issues: https://github.com/jflournoy/image-gen-pipe-v2/issues
5. Open a new issue if it's not covered

---

✨ **Congratulations on your deployment!** ✨
