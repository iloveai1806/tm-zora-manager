# Cron Setup for Daily Zora Posting

## Schedule: 10PM and 3AM GMT+7 (Asia/Bangkok timezone)

To schedule the daily Zora posting script to run twice daily, follow these steps:

### 1. Make script executable
```bash
chmod +x daily-zora-post.sh
```

### 2. Open crontab editor
```bash
crontab -e
```

### 3. Add these cron entries
```bash
# Daily Zora posting at 10PM GMT+7 (15:00 UTC)
0 22 * * * /Users/phattran/TokenMetrics/tm-zora-manager/daily-zora-post.sh

# Daily Zora posting at 3AM GMT+7 (20:00 UTC previous day)
0 3 * * * /Users/phattran/TokenMetrics/tm-zora-manager/daily-zora-post.sh
```

### 4. Verify cron jobs are set
```bash
crontab -l
```

### 5. Check cron service is running (macOS)
```bash
sudo launchctl list | grep cron
```

## Cron Schedule Explanation
- `0 22 * * *` = Every day at 10:00 PM local time (GMT+7)
- `0 3 * * *` = Every day at 3:00 AM local time (GMT+7)
- `*` means "every" (minute, hour, day, month, weekday)

## Log Files
- **Cron execution logs**: `cron-execution.log`
- **Detailed posting logs**: `daily-posting.log`
- **Deduplication tracking**: `posted-tweets.json`

## Timezone Notes
- Script sets `TZ='Asia/Bangkok'` (GMT+7)
- 10PM GMT+7 = 3PM UTC
- 3AM GMT+7 = 8PM UTC (previous day)

## Monitoring
Check the logs regularly to ensure posting is working:
```bash
# Check recent cron executions
tail -50 cron-execution.log

# Check recent posting results  
tail -10 daily-posting.log

# Check posted tweets count
wc -l posted-tweets.json
```

## Troubleshooting
If cron jobs don't run:
1. Check cron service: `sudo launchctl list | grep cron`
2. Check system logs: `tail -f /var/log/system.log | grep cron`
3. Verify file permissions: `ls -la daily-zora-post.sh`
4. Test script manually: `./daily-zora-post.sh`