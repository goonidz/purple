# Render Queue System Documentation

## Overview

The video render service now includes an intelligent queue system that monitors system resources and automatically queues jobs when resources are insufficient.

## Resource Limits (VPS: 8 vCores, 24GB RAM)

| Resource | Threshold | Check Method |
|----------|-----------|--------------|
| **RAM** | Min 4 GB free | `os.freemem()` |
| **CPU** | Load < 6.0 | `os.loadavg()[0]` |
| **Disk** | Min 2 GB free | `df` command |
| **Parallel Jobs** | Max 3 active | Internal counter |

## How It Works

### 1. Job Submission (POST /render)

When a render job is submitted:

1. **Resource Check**: System checks RAM, CPU, disk space, and active jobs
2. **Decision**:
   - **Resources Available** → Job starts immediately (status: `pending`)
   - **Resources Insufficient** → Job queued (status: `queued`)

### 2. Queue Processing

- **Automatic**: Queue checked every 30 seconds
- **Triggered**: After each job completion (success or failure)
- **FIFO**: First job in queue is processed when resources become available

### 3. Persistent Queue

Queue is saved to `render-queue.json`:
```json
{
  "queue": [
    {
      "jobId": "render_1234567890_abc123",
      "renderData": { /* full render config */ },
      "queuedAt": "2025-01-08T20:00:00.000Z",
      "priority": 1
    }
  ],
  "lastProcessed": "2025-01-08T20:05:00.000Z"
}
```

**Benefits**:
- Survives server restarts
- Jobs not lost if service crashes
- Can be manually edited if needed

## API Endpoints

### GET /queue

Get current queue status and resource availability.

**Response**:
```json
{
  "success": true,
  "queue": [
    {
      "jobId": "render_xxx",
      "position": 1,
      "queuedAt": "2025-01-08T20:00:00.000Z",
      "priority": 1
    }
  ],
  "queueLength": 1,
  "resources": {
    "activeJobs": 3,
    "maxJobs": 3,
    "freeMemoryGB": 3.2,
    "requiredMemoryGB": 4,
    "loadAverage": 5.8,
    "maxLoadAverage": 6.0,
    "freeDiskGB": 15,
    "requiredDiskGB": 2
  },
  "resourcesAvailable": false,
  "reasons": ["Insufficient RAM (3.2GB free, need 4GB)"]
}
```

### DELETE /queue/:jobId

Remove a job from the queue.

**Response**:
```json
{
  "success": true,
  "message": "Job removed from queue",
  "jobId": "render_xxx"
}
```

### GET /resources

Get current system resource status.

**Response**:
```json
{
  "success": true,
  "available": true,
  "reasons": [],
  "resources": {
    "activeJobs": 2,
    "maxJobs": 3,
    "freeMemoryGB": 8.5,
    "requiredMemoryGB": 4,
    "loadAverage": 3.2,
    "maxLoadAverage": 6.0,
    "freeDiskGB": 25,
    "requiredDiskGB": 2
  },
  "timestamp": "2025-01-08T20:10:00.000Z"
}
```

## User Experience

### Immediate Start
```json
POST /render
→ Response:
{
  "success": true,
  "jobId": "render_xxx",
  "status": "pending",
  "message": "Render job started"
}
```

### Queued
```json
POST /render
→ Response:
{
  "success": true,
  "jobId": "render_xxx",
  "status": "queued",
  "position": 2,
  "queueLength": 3,
  "message": "Job queued (position 2/3)",
  "reasons": [
    "Max parallel jobs reached (3/3)",
    "Insufficient RAM (3.5GB free, need 4GB)"
  ],
  "estimatedWait": "~6 min"
}
```

### Status Check
```json
GET /status/:jobId
→ Response (queued):
{
  "success": true,
  "jobId": "render_xxx",
  "status": "queued",
  "progress": 0,
  "queuePosition": 2,
  "queueLength": 3
}

→ Response (processing):
{
  "success": true,
  "jobId": "render_xxx",
  "status": "processing",
  "progress": 45,
  "currentStep": "Rendering scene 5/10"
}
```

## Monitoring

### Check Queue
```bash
curl http://localhost:3000/queue
```

### Check Resources
```bash
curl http://localhost:3000/resources
```

### View Queue File
```bash
cat ~/purple/video-render-service/render-queue.json
```

### Server Logs
```bash
pm2 logs video-render | grep queue
```

Example logs:
```
[queue] Starting queue processor (checks every 30s)
[render_xxx] Resource check: INSUFFICIENT
[render_xxx] Reasons: Max parallel jobs reached (3/3)
[queue] Added job render_xxx to queue (position 2)
[queue] Processing queued job render_yyy (2 jobs in queue)
[queue] Resources not available, skipping queue processing: High CPU load (6.5, max 6.0)
```

## Troubleshooting

### Jobs Stuck in Queue

**Check resources**:
```bash
curl http://localhost:3000/resources
```

**Common causes**:
- High CPU load (other processes running)
- Low RAM (memory leak or other services)
- Disk full (clean up old videos)
- Max jobs reached (wait for completion)

**Solutions**:
```bash
# Kill other processes
htop  # Find and kill heavy processes

# Free up RAM
pm2 restart video-render

# Clean up disk
node ~/purple/video-render-service/cleanup.js

# Check active jobs
curl http://localhost:3000/queue
```

### Remove Stuck Job from Queue

```bash
curl -X DELETE http://localhost:3000/queue/render_xxx
```

### Clear Entire Queue (Emergency)

```bash
echo '{"queue":[],"lastProcessed":null}' > ~/purple/video-render-service/render-queue.json
pm2 restart video-render
```

### Adjust Resource Limits

Edit `server.js`:
```javascript
const RESOURCE_LIMITS = {
  minFreeMemoryGB: 4,      // Lower if needed (e.g., 2)
  maxLoadAverage: 6.0,     // Increase if VPS can handle more
  minFreeDiskGB: 2,        // Adjust based on video sizes
  maxParallelJobs: 3       // Increase/decrease based on VPS specs
};
```

Then restart:
```bash
pm2 restart video-render
```

## Performance Tips

### Optimal Settings for Your VPS (8 cores, 24GB RAM)

Current settings are conservative. You can increase:

```javascript
const RESOURCE_LIMITS = {
  minFreeMemoryGB: 3,      // Allow more jobs (was 4)
  maxLoadAverage: 7.0,     // Use more CPU (was 6.0)
  minFreeDiskGB: 2,        // Keep as is
  maxParallelJobs: 4       // One more parallel job (was 3)
};
```

**Trade-offs**:
- More parallel jobs = faster throughput but higher resource usage
- Lower RAM threshold = more jobs but risk of OOM
- Higher CPU load = more jobs but slower individual renders

### Monitor Performance

```bash
# Watch resources in real-time
watch -n 1 'curl -s http://localhost:3000/resources | jq'

# Monitor queue
watch -n 5 'curl -s http://localhost:3000/queue | jq'

# System monitoring
htop
```

## Integration with Frontend

The frontend can poll `/status/:jobId` to show queue position:

```javascript
const response = await fetch(`http://vps:3000/status/${jobId}`);
const { status, queuePosition, queueLength } = await response.json();

if (status === 'queued') {
  showMessage(`En file d'attente (position ${queuePosition}/${queueLength})`);
} else if (status === 'processing') {
  showMessage(`Rendu en cours...`);
}
```
