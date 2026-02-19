# Service STOP_LOCK Mechanism

## Overview

The **STOP_LOCK** mechanism prevents accidental auto-restart of services after a user has manually stopped them. This is critical for preventing race conditions where:

1. User clicks "Stop Service" button in UI
2. Service stops, marking `shouldBeRunning = false`
3. Auto-restart health check runs before UI can be updated
4. Service auto-restarts against user's intent
5. User sees confused state: service shows "stopped" but is actually running

## How It Works

### Stop Workflow

When you stop a service via the UI button:

```
POST /api/services/{name}/stop
↓
1. Create STOP_LOCK file: /tmp/{serviceName}_service.STOP_LOCK
2. Stop the service process
3. Mark service intent as shouldBeRunning = false
4. Return success response
```

### Restart Blocking

While STOP_LOCK exists, restarts are blocked:

```
POST /api/services/{name}/restart
↓
Check for STOP_LOCK
↓
If STOP_LOCK exists:
  → Return 409 Conflict
  → Message: "Service restart blocked: STOP_LOCK exists"

If STOP_LOCK doesn't exist:
  → Proceed with restart normally
```

### Auto-Restart Blocking

Health checks respect STOP_LOCK:

```
Health Check (runs every N seconds)
↓
Check if service is running and shouldBeRunning = true
↓
If service crashed and shouldBeRunning = true:
  Check for STOP_LOCK
  ↓
  If STOP_LOCK exists:
    → Skip auto-restart
    → Log: "Service needs restart but STOP_LOCK exists - skipping"

  If STOP_LOCK doesn't exist:
    → Auto-restart the service
```

### Unlock Workflow

After confirming no pending restarts will occur:

```
DELETE /api/services/{name}/stop-lock
↓
1. Check if STOP_LOCK exists
2. If it exists:
   - Delete the lock file
   - Return success
   - Auto-restart is now allowed
3. If it doesn't exist:
   - Return 404 Not Found
```

## API Endpoints

### Stop Service (Creates STOP_LOCK)

```bash
POST /api/services/{name}/stop

Response: 200 OK
{
  "success": true,
  "message": "Service {name} stopped successfully (restart prevented by STOP_LOCK)"
}
```

### Restart Service (Blocked by STOP_LOCK)

```bash
POST /api/services/{name}/restart

Response: 409 Conflict (if STOP_LOCK exists)
{
  "error": "Service restart blocked",
  "message": "Service {name} was manually stopped. Remove STOP_LOCK to allow restarts."
}

Response: 200 OK (if STOP_LOCK doesn't exist)
{
  "success": true,
  "pid": 12345,
  "port": 8001,
  "message": "Service {name} restarted successfully"
}
```

### Remove STOP_LOCK (Allow Restarts)

```bash
DELETE /api/services/{name}/stop-lock

Response: 200 OK
{
  "success": true,
  "message": "STOP_LOCK removed for {name}. Auto-restart on crashes is now enabled."
}

Response: 404 Not Found (if no lock exists)
{
  "error": "No STOP_LOCK found",
  "message": "Service {name} does not have an active STOP_LOCK"
}
```

## File Locations

STOP_LOCK files are stored at:

```
/tmp/{serviceName}_service.STOP_LOCK
```

Content: Unix timestamp (milliseconds) when the lock was created, useful for debugging.

### Examples

```
/tmp/flux_service.STOP_LOCK       → Flux service is manually stopped
/tmp/llm_service.STOP_LOCK         → LLM service is manually stopped
/tmp/vision_service.STOP_LOCK      → Vision service is manually stopped
/tmp/vlm_service.STOP_LOCK         → VLM service is manually stopped
```

## UI Integration

### Stopping a Service

When user clicks "Stop" button:

1. UI sends: `POST /api/services/{name}/stop`
2. UI receives: Success response with message about STOP_LOCK
3. UI shows: Service status as "Stopped" (grayed out, no restart button)
4. UI disables: Any "Restart" buttons until lock is removed

### Checking Lock Status

The status endpoint should include lock information:

```
GET /api/services/status

Response:
{
  "flux": {
    "running": false,
    "stopped_by_user": true,  // Has STOP_LOCK
    "can_restart": false,      // Blocked by lock
    "message": "Click 'Reset' to allow auto-restart"
  }
}
```

### Removing Lock (Reset Service)

When user wants to re-enable auto-restart:

1. UI sends: `DELETE /api/services/{name}/stop-lock`
2. UI receives: Success response
3. UI shows: Service status as "Stopped" but now with enabled restart
4. Next crash will auto-restart the service

## Implementation Details

### Lock File Format

Simple file containing the creation timestamp for debugging:

```
1708372945123
```

This is a Unix timestamp in milliseconds, allowing you to determine when the service was stopped.

### Service Manager Functions

```javascript
// Get lock file path for a service
ServiceManager.getStopLockPath(serviceName)
// → '/tmp/{serviceName}_service.STOP_LOCK'

// Check if lock exists
await ServiceManager.hasStopLock(serviceName)
// → true/false

// Create lock (called by stop endpoint)
await ServiceManager.createStopLock(serviceName)

// Delete lock (called by unlock endpoint)
await ServiceManager.deleteStopLock(serviceName)
```

## Why This Matters

Without STOP_LOCK, here's what could happen:

```
User Action: Click "Stop Service"
↓
Backend: Service stops, sets shouldBeRunning = false
↓
UI: Updates to show "Stopped"
↓
(Meanwhile) Health check runs...
↓
Health check: "Service crashed! Restarting..."
↓
Backend: Auto-restarts service, sets shouldBeRunning = true
↓
User sees: "Stopped" button grayed out (outdated)
User tries to start: "Already running!" error
User is confused ❌
```

With STOP_LOCK:

```
User Action: Click "Stop Service"
↓
Backend: Create STOP_LOCK + Stop service + Set shouldBeRunning = false
↓
UI: Updates to show "Stopped" (with reset option)
↓
(Meanwhile) Health check runs...
↓
Health check: "Service crashed, but STOP_LOCK exists - skipping restart"
↓
Backend: Respects user intent, doesn't auto-restart
↓
User sees: "Stopped" with "Reset to Allow Auto-Restart" button
↓
User clicks reset when ready
↓
Auto-restart is now enabled again ✅
```

## Debugging

To see STOP_LOCK activity in logs:

```bash
grep "STOP_LOCK" /tmp/beam-search-services/*.log
```

To manually check for locks:

```bash
ls -la /tmp/*_service.STOP_LOCK

# Check timestamp
cat /tmp/flux_service.STOP_LOCK | xargs -I {} date -d @{}/1000
```

To manually remove a lock (only if you know what you're doing):

```bash
rm /tmp/{serviceName}_service.STOP_LOCK
```

## Testing

STOP_LOCK functionality is covered by:

- Unit tests: `test/api/service-stop-lock.test.js` (11 tests)
- Integration tests: `test/api/service-stop-lock-integration.test.js` (7 tests)

Run tests:

```bash
node --test test/api/service-stop-lock.test.js
node --test test/api/service-stop-lock-integration.test.js
```
