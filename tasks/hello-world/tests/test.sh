#!/bin/bash
# Verifier for hello-world task
# Checks that /root/hello.txt exists and contains "Hello, World!"

mkdir -p /logs/verifier

EXPECTED="Hello, World!"
ACTUAL=$(cat /root/hello.txt 2>/dev/null)

if [ "$ACTUAL" = "$EXPECTED" ]; then
    echo "1.0" > /logs/verifier/reward.txt
    echo "PASS: /root/hello.txt contains '$EXPECTED'"
else
    echo "0.0" > /logs/verifier/reward.txt
    echo "FAIL: expected '$EXPECTED', got '$ACTUAL'"
fi
