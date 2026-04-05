#!/bin/bash
# Verifier for count-files task
# Checks that /root/output/ contains exactly 3 .txt files

mkdir -p /logs/verifier

if [ ! -d /root/output ]; then
    echo "0.0" > /logs/verifier/reward.txt
    echo "FAIL: /root/output/ does not exist"
    exit 0
fi

TXT_COUNT=$(find /root/output -maxdepth 1 -name '*.txt' -type f | wc -l)
TOTAL_COUNT=$(find /root/output -maxdepth 1 -type f | wc -l)

if [ "$TXT_COUNT" -eq 3 ] && [ "$TOTAL_COUNT" -eq 3 ]; then
    echo "1.0" > /logs/verifier/reward.txt
    echo "PASS: found exactly 3 .txt files"
else
    echo "0.0" > /logs/verifier/reward.txt
    echo "FAIL: expected 3 .txt files, found $TXT_COUNT .txt and $TOTAL_COUNT total"
fi
