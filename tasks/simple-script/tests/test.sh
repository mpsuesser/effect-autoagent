#!/bin/bash
# Verifier for simple-script task
# Checks that /root/result.txt contains "5050"

mkdir -p /logs/verifier

if [ ! -f /root/result.txt ]; then
    echo "0.0" > /logs/verifier/reward.txt
    echo "FAIL: /root/result.txt does not exist"
    exit 0
fi

# Strip whitespace and compare
ACTUAL=$(tr -d '[:space:]' < /root/result.txt)

if [ "$ACTUAL" = "5050" ]; then
    echo "1.0" > /logs/verifier/reward.txt
    echo "PASS: result is 5050"
else
    echo "0.0" > /logs/verifier/reward.txt
    echo "FAIL: expected '5050', got '$ACTUAL'"
fi
