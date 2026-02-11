---
allowed-tools: [Bash]
description: Efficiently resume work by extracting recent session from .claude-current-status
approach: script-delegation
token-cost: ~100 (extracts only relevant recent context)
best-for: Picking up where you left off after context limits
---

# Continue - Resume Work Session

Extracts the most recent session information from `.claude-current-status` to efficiently resume work after context limits.

## How It Works

1. Finds the last session heading (`## Session Resume` or `## Session Start`)
2. Extracts from that heading to end of file (most recent work)
3. Falls back to last 150 lines if no heading found
4. Shows file metadata (size, modification time)

## Your Task

Run the continue script to see recent context:

```bash
#!/bin/bash

STATUS_FILE=".claude-current-status"
ARCHIVE_DIR=".claude-archive"

echo "🔍 Claude Current Status - Recent Session"
echo "=========================================="
echo ""

if [ ! -f "$STATUS_FILE" ]; then
    echo "❌ Status file not found: $STATUS_FILE"
    echo "   No previous session context available."
    exit 0
fi

# File metadata
FILE_SIZE=$(wc -l < "$STATUS_FILE")
MOD_TIME=$(stat -c "%y" "$STATUS_FILE" 2>/dev/null || stat -f "%Sm" "$STATUS_FILE" 2>/dev/null)
echo "📄 File: $STATUS_FILE"
echo "   Lines: $FILE_SIZE | Modified: $MOD_TIME"
echo ""

# Check for newer archives (potential prepending issue)
if [ -d "$ARCHIVE_DIR" ]; then
    # Find newest archive file by modification time
    NEWEST_ARCHIVE=$(find "$ARCHIVE_DIR" -name "status-archive-*.txt" -type f -exec stat -c "%Y %n" {} \; 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
    if [ -n "$NEWEST_ARCHIVE" ] && [ -f "$NEWEST_ARCHIVE" ]; then
        ARCHIVE_MOD_TIME=$(stat -c "%y" "$NEWEST_ARCHIVE" 2>/dev/null || stat -f "%Sm" "$NEWEST_ARCHIVE" 2>/dev/null)
        ARCHIVE_MTIME_SEC=$(stat -c "%Y" "$NEWEST_ARCHIVE" 2>/dev/null || stat -f "%m" "$NEWEST_ARCHIVE" 2>/dev/null)
        FILE_MTIME_SEC=$(stat -c "%Y" "$STATUS_FILE" 2>/dev/null || stat -f "%m" "$STATUS_FILE" 2>/dev/null)

        # If archive is newer than main file, warn about possible prepending issue
        if [ "$ARCHIVE_MTIME_SEC" -gt "$FILE_MTIME_SEC" ]; then
            echo "⚠️  WARNING: Archive newer than main file (possible prepending issue)"
            echo "   Archive: $(basename "$NEWEST_ARCHIVE") ($ARCHIVE_MOD_TIME)"
            echo "   Main file: $MOD_TIME"
            echo "   Recent work may have been archived due to prepending."
            echo "   Check: $NEWEST_ARCHIVE"
            echo ""
        fi
    fi
fi

# Find the last session heading (## Session Resume or ## Session Start)
# Skip the "Archive Note" and "Recent Work" headings in condensed files
LAST_HEADING_LINE=$(awk '/^## Session (Resume|Start)/ {last=NR} END {print last}' "$STATUS_FILE")

if [ -n "$LAST_HEADING_LINE" ] && [ "$LAST_HEADING_LINE" -gt 0 ]; then
    echo "📌 Most recent session found at line $LAST_HEADING_LINE"
    echo "────────────────────────────────────────────────────────"
    tail -n +"$LAST_HEADING_LINE" "$STATUS_FILE"
else
    # Fallback: find any ## heading except Archive Note and Recent Work
    # Use grep to find lines, then awk to get the last one
    LAST_HEADING_LINE=$(grep -n '^## ' "$STATUS_FILE" | grep -v 'Archive Note' | grep -v 'Recent Work' | tail -1 | cut -d: -f1)
    if [ -n "$LAST_HEADING_LINE" ] && [ "$LAST_HEADING_LINE" -gt 0 ]; then
        echo "📌 Last relevant heading found at line $LAST_HEADING_LINE"
        echo "────────────────────────────────────────────────────────"
        tail -n +"$LAST_HEADING_LINE" "$STATUS_FILE"
    else
        # Final fallback: skip archive note and show recent content
        echo "📌 Showing recent content (skipping archive note):"
        echo "────────────────────────────────────────────────────────"
        # Find line after "Recent Work" heading or show last 150 lines
        RECENT_WORK_LINE=$(awk '/^## Recent Work/ {print NR+2}' "$STATUS_FILE")
        if [ -n "$RECENT_WORK_LINE" ] && [ "$RECENT_WORK_LINE" -gt 0 ]; then
            tail -n +"$RECENT_WORK_LINE" "$STATUS_FILE"
        else
            tail -n 150 "$STATUS_FILE"
        fi
    fi
fi

echo ""
echo "💡 Use this context to resume work. Update .claude-current-status as you progress."
echo "💡 CRITICAL: Always APPEND (>>) to .claude-current-status, never prepend."
echo "💡 If recent work missing, check archives in $ARCHIVE_DIR/"
```

## Notes

- **Efficient**: Extracts only recent session (~100-200 lines) instead of entire file
- **Robust**: Multiple fallback strategies for different file structures
- **Context-aware**: Finds session markers for optimal relevance
- **Lightweight**: Minimal token usage for maximum context utility

## Usage

```bash
/continue
```

No arguments needed. Run whenever you need to resume work after context limits.