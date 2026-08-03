#!/bin/sh
# The only command the automation SSH key is allowed to run.
#
# It is wired up in ~/.ssh/authorized_keys on the Pi as:
#
#   command="/path/to/zkfrank/backend/pi_agent.sh",restrict ssh-ed25519 ... wsl-zkfrank
#
# The path has to be absolute and point at wherever this repo is checked out on
# the Pi - sshd expands neither ~ nor $HOME inside command=. 'restrict' needs
# OpenSSH 7.2 or newer; it turns off port, agent and X11 forwarding plus pty
# allocation, so a leaked key still buys nothing but the two actions below.
#
# With a forced command, whatever the client asked for lands in
# SSH_ORIGINAL_COMMAND and is ignored by sshd. This script reads that request and
# allows exactly two actions. Anything else is refused.
#
# Why a dispatcher rather than one forced command per key: the Pi decides what it
# can be asked to do, instead of trusting a path sent by the caller. That also
# means no caller-supplied string is ever interpolated into a shell command here.
set -eu

DIR=$(dirname "$0")

case "${SSH_ORIGINAL_COMMAND:-}" in
    read)
        # Wait for a card and print the credential as one JSON line on stdout.
        exec python3 "$DIR/nfc_reader.py" --once
        ;;
    write)
        # Read a credential as JSON on stdin and write it to a card.
        exec python3 "$DIR/nfc_writer.py" --stdin
        ;;
    *)
        echo "pi_agent: refused '${SSH_ORIGINAL_COMMAND:-}' - only 'read' and 'write' are allowed" >&2
        exit 1
        ;;
esac
