#!/bin/bash

# daily-zora-post.sh - Daily automated Zora posting from TokenMetrics YouTube Shorts
# Runs at 10PM and 3AM GMT+7 daily

# Set up environment
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
cd "$SCRIPT_DIR"

# Set timezone
export TZ='Asia/Bangkok'  # GMT+7

# Log file setup
LOG_FILE="$SCRIPT_DIR/cron-execution.log"
DATE_TIME=$(date '+%Y-%m-%d %H:%M:%S %Z')

echo "=========================================" >> "$LOG_FILE"
echo "Starting daily YouTube Shorts Zora posting: $DATE_TIME" >> "$LOG_FILE"
echo "Working directory: $SCRIPT_DIR" >> "$LOG_FILE"
echo "=========================================" >> "$LOG_FILE"

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "ERROR: .env file not found!" >> "$LOG_FILE"
    echo "Please create .env file with required API keys" >> "$LOG_FILE"
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..." >> "$LOG_FILE"
    pnpm install >> "$LOG_FILE" 2>&1
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to install dependencies!" >> "$LOG_FILE"
        exit 1
    fi
fi

# Run the automated posting script (YouTube Shorts in latest mode)
echo "Executing youtube-shorts-zora.ts in latest mode..." >> "$LOG_FILE"
pnpm tsx youtube-shorts-zora.ts >> "$LOG_FILE" 2>&1
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "SUCCESS: Daily YouTube Shorts posting completed successfully at $DATE_TIME" >> "$LOG_FILE"
    echo "Check youtube-posting.log for detailed results" >> "$LOG_FILE"
else
    echo "ERROR: Daily YouTube Shorts posting failed with exit code $EXIT_CODE at $DATE_TIME" >> "$LOG_FILE"
    echo "Check logs above for error details" >> "$LOG_FILE"
fi

echo "=========================================" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"


exit $EXIT_CODE