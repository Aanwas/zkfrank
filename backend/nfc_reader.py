# nfc_reader.py
#
# Reads the credential written by nfc_writer.py off a card and prints it:
# student_id, secret, and the college signature over their commitment.
#
# Usage: python3 nfc_reader.py [--once] [--timeout SECONDS]
#
# With --once the credential is printed to stdout as a single JSON line and
# nothing else, so a remote caller can parse it straight off an SSH pipe.
#
# This script runs on the Raspberry Pi only: `board` and `busio` talk to real
# GPIO/I2C pins, so it cannot run on the PC. The Pi is only ever a card reader -
# the Aztec side of the project lives on the PC and pulls from here over SSH.

# Standard library.
import argparse
import json
import sys
import time

# Third-party, Pi-specific: `board` exposes the named pins of this exact board,
# `busio` opens hardware buses on them, and PN532_I2C is the driver for the NFC
# module wired to those pins.
import board
import busio
from adafruit_pn532.i2c import PN532_I2C

# Shared layout module: the single source of truth for how the credential is
# stored on the card. nfc_writer.py imports the same constants, so the two can
# never disagree about which pages hold what.
from nfc_layout import FIRST_PAGE, LAST_PAGE, PAGE_SIZE, decode_payload


def read_payload(pn532):
    """Read the raw payload bytes out of the card's user memory.

    An NTAG215 is addressed in 4-byte "pages" rather than as one flat blob, so
    the payload has to be collected one page at a time and concatenated back
    together in order.
    """
    # bytearray is the mutable sibling of bytes - it can grow as pages arrive.
    payload = bytearray()

    # LAST_PAGE is inclusive, hence the + 1: range() stops one short.
    for page in range(FIRST_PAGE, LAST_PAGE + 1):
        page_data = pn532.ntag2xx_read_block(page)

        # None means the read failed, usually because the card was moved out of
        # range mid-read. Fail loudly: a partial payload would decode into a
        # plausible-looking but wrong number.
        if page_data is None:
            raise RuntimeError(f"Read error at page {page}")

        # The driver may return a 16-byte window; only the first 4 bytes are this page.
        payload.extend(page_data[0:PAGE_SIZE])

        # Micro-pause to avoid locking up the I2C bus during aggressive reads.
        time.sleep(0.005)

    # Freeze the result: callers get an immutable bytes object.
    return bytes(payload)


def main(once, timeout):
    """Wait for a card, decode the credential off it, print it, and stop.

    `once` selects the output format: True gives one machine-readable JSON line
    on stdout, False gives human-readable lines. `timeout` is how many seconds
    to wait for a card before giving up.
    """
    # Open the I2C bus on the Pi's dedicated clock/data pins, then hand it to the
    # driver. debug=False keeps the driver's own packet dumps off the console.
    i2c_bus = busio.I2C(board.SCL, board.SDA)
    pn532 = PN532_I2C(i2c_bus, debug=False)

    # stdout carries the payload, so every progress message goes to stderr.
    # That split is what lets the caller parse stdout as pure JSON while a human
    # watching the terminal still sees what is happening.
    print("Reader active. Tap a card...", file=sys.stderr)

    # monotonic() is a counter that only ever moves forward, unlike time.time()
    # which follows the wall clock and can jump when NTP corrects the Pi (it has
    # no battery-backed clock, so it resyncs after every boot). Deadlines must be
    # measured against something that cannot jump backwards.
    deadline = time.monotonic() + timeout

    while True:
        # Checked at the top of every pass, so a card that never arrives ends the
        # script instead of hanging an SSH call on the PC forever.
        if time.monotonic() > deadline:
            raise TimeoutError(f"No card presented within {timeout:g} seconds")

        # Ask the reader whether a card is in the field. Returns the card's UID
        # as bytes, or None after waiting 0.5s with nothing there.
        uid = pn532.read_passive_target(timeout=0.5)
        if uid is None:
            # Nothing yet. Idle briefly so the loop does not pin the CPU, then
            # ask again.
            time.sleep(0.2)
            continue

        # Format each UID byte as two uppercase hex digits, e.g. 0426BB3D9E6180.
        # Diagnostic only - the UID is not part of the credential.
        hex_uid = "".join(f"{b:02X}" for b in uid)
        print(f"Card detected, UID: {hex_uid}", file=sys.stderr)

        # Raw bytes in, a whole credential out. decode_payload also rejects a
        # blank or foreign card, whose bytes would not form valid Field elements.
        student_id, secret, signature = decode_payload(read_payload(pn532))

        if once:
            # Field elements run up to 254 bits, so emit decimal strings: a JSON
            # number would be truncated to a float64 by the JavaScript caller.
            # The signature is hex instead, because it is two 32-byte halves
            # rather than one number - see nfc_layout.parse_signature. Whatever
            # form is chosen here, nfc_writer.py --signature must accept it.
            print(json.dumps({
                "student_id": str(student_id),
                "secret": str(secret),
                "signature": signature.hex(),
            }))
        else:
            print(f"  student_id: {student_id}")
            print(f"  secret    : {secret}")
            print(f"  signature : {signature.hex()}")

        # One card is the whole job in both modes - leave the loop by returning.
        return


# Only runs when this file is executed directly, not when another module imports
# it. That keeps read_payload() reusable without triggering the reader loop.
if __name__ == "__main__":
    # argparse turns the raw sys.argv strings into a checked interface: it builds
    # --help for us, and rejects an unknown flag instead of ignoring it. That
    # matters over SSH, where a silently dropped --once would put human text on
    # stdout and break the caller's JSON parse.
    parser = argparse.ArgumentParser(description="Read a student credential from an NFC card.")

    # store_true makes this a switch: present -> True, absent -> False.
    parser.add_argument(
        "--once",
        action="store_true",
        help="wait for one card, print {student_id, secret, signature} as JSON to stdout, then exit",
    )

    # type=float means args.timeout arrives as a number, not the string "30".
    parser.add_argument("--timeout", type=float, default=30.0, help="seconds to wait for a card before exiting")

    # Reads sys.argv and returns an object whose attributes are named after the
    # flags: --once becomes args.once, --timeout becomes args.timeout.
    args = parser.parse_args()

    main(args.once, args.timeout)
