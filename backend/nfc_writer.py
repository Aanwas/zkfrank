# nfc_writer.py
#
# Writes one credential onto an NTAG215 card:
#
#   [ 32 bytes student_id ][ 32 bytes secret ][ 64 bytes college signature ]
#
# See nfc_layout.py for the layout itself - this file only moves bytes onto a
# card and reads them back to check they landed.
#
# Every value is supplied by the caller. Nothing is generated here, and that is
# deliberate: the college signs poseidon2([student_id, secret]), so whoever
# produces the signature must already know the secret. Issuance therefore lives
# on the PC (scripts/issue_card.mjs), which has both the college private key and
# a way to compute poseidon2. The Pi is a card-writing terminal, nothing more -
# the college key never touches it.
#
# Usage:
#   python3 nfc_writer.py --student-id 1001 --secret <decimal> --signature <hex>
import argparse
import time

import board
import busio
from adafruit_pn532.i2c import PN532_I2C

from nfc_layout import (
    FIRST_PAGE,
    LAST_PAGE,
    PAGE_SIZE,
    PAYLOAD_BYTES,
    encode_payload,
    parse_field,
    parse_signature,
)


def write_payload(pn532, payload):
    """Write the payload page by page, then read it back and verify."""
    for offset in range(0, len(payload), PAGE_SIZE):
        page = FIRST_PAGE + offset // PAGE_SIZE
        pn532.ntag2xx_write_block(page, payload[offset:offset + PAGE_SIZE])
        # NTAG215 needs a moment to commit each page.
        time.sleep(0.015)

    written = bytearray()
    for page in range(FIRST_PAGE, LAST_PAGE + 1):
        page_data = pn532.ntag2xx_read_block(page)
        if page_data is None:
            raise RuntimeError(f"Verification failed: page {page} could not be read back")
        # The driver may return a 16-byte window; only the first 4 bytes are this page.
        written.extend(page_data[0:PAGE_SIZE])
        time.sleep(0.005)

    if bytes(written) != payload:
        raise RuntimeError("Verification failed: data read back does not match what was written")


def main(student_id_raw, secret_raw, signature_raw, timeout):
    """Parse the credential, wait for a card, write it, verify it, and stop."""
    # Parse before touching the hardware: a typo in an argument should fail
    # instantly, not after the user has already tapped a card.
    student_id = parse_field(student_id_raw, "student_id")
    secret = parse_field(secret_raw, "secret")
    signature = parse_signature(signature_raw)

    payload = encode_payload(student_id, secret, signature)

    i2c_bus = busio.I2C(board.SCL, board.SDA)
    pn532 = PN532_I2C(i2c_bus, debug=False)

    print(f"Writing {PAYLOAD_BYTES} bytes into pages {FIRST_PAGE}..{LAST_PAGE}")
    print("Tap the NTAG215 card to the reader...")

    # monotonic() only ever moves forward, unlike time.time(), which follows the
    # wall clock and can jump when NTP corrects the Pi's clock after boot.
    deadline = time.monotonic() + timeout

    while True:
        if time.monotonic() > deadline:
            raise TimeoutError(f"No card presented within {timeout:g} seconds")

        uid = pn532.read_passive_target(timeout=0.5)
        if uid is None:
            time.sleep(0.2)
            continue

        hex_uid = "".join(f"{b:02X}" for b in uid)
        print(f"Card detected, UID: {hex_uid}")

        write_payload(pn532, payload)

        print("Write complete and verified.")
        print(f"  student_id: {student_id}")
        print(f"  secret    : {secret}")
        print(f"  signature : {signature.hex()}")
        return


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Write a student credential issued on the PC onto an NTAG215 card.",
    )

    # required=True on all three: a card written with a missing field would look
    # fine here and fail much later, inside a ZK circuit, as "invalid signature".
    parser.add_argument("--student-id", required=True, help="student id as a decimal integer")
    parser.add_argument("--secret", required=True, help="card secret as a decimal integer")
    parser.add_argument(
        "--signature",
        required=True,
        help="college signature as 128 hex characters (raw r||s, 64 bytes)",
    )
    parser.add_argument("--timeout", type=float, default=30.0, help="seconds to wait for a card")

    args = parser.parse_args()

    # argparse turns --student-id into args.student_id: dashes become underscores.
    main(args.student_id, args.secret, args.signature, args.timeout)
