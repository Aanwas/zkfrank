# nfc_writer.py
#
# Writes a (student_id, secret) pair onto an NTAG215 card.
#
# Layout: each value is one Aztec Field serialized big-endian into 32 bytes,
# so the payload is 64 bytes living in pages 4..19 (NTAG215 user memory
# starts at page 4 and holds 504 bytes, so there is room to spare).
#
# The secret is generated here rather than supplied: it is what stops an
# attacker from recovering the student id. Commitments are published as plain
# arguments to issue_credential, so anyone can read one off the chain and try to
# guess the pair behind it. A hand-picked secret like 42 falls to a search of a
# few thousand hashes; a random 254-bit one does not.
#
# Usage: python3 nfc_writer.py <student_id>
import secrets
import sys
import time
import board
import busio
from adafruit_pn532.i2c import PN532_I2C

from nfc_layout import (
    FIELD_MODULUS,
    FIRST_PAGE,
    LAST_PAGE,
    PAGE_SIZE,
    PAYLOAD_BYTES,
    encode_payload,
    parse_field,
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


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 nfc_writer.py <student_id>")

    student_id = parse_field(sys.argv[1], "student_id")

    # secrets.randbelow draws from the OS cryptographic source, unlike random(),
    # whose output is predictable from a handful of observed values.
    secret = secrets.randbelow(FIELD_MODULUS)

    payload = encode_payload(student_id, secret)

    i2c_bus = busio.I2C(board.SCL, board.SDA)
    pn532 = PN532_I2C(i2c_bus, debug=False)

    print(f"Writing {PAYLOAD_BYTES} bytes into pages {FIRST_PAGE}..{LAST_PAGE}")
    print("Tap the NTAG215 card to the reader...")

    while True:
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
        return


if __name__ == "__main__":
    main()
