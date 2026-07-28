# nfc_reader.py
#
# Reads a (student_id, secret) pair written by nfc_writer.py and prints it.
#
# Usage: python3 nfc_reader.py
import time
import board
import busio
from adafruit_pn532.i2c import PN532_I2C

from nfc_layout import FIRST_PAGE, LAST_PAGE, PAGE_SIZE, decode_payload


def read_payload(pn532):
    """Read the payload pages off the card."""
    payload = bytearray()
    for page in range(FIRST_PAGE, LAST_PAGE + 1):
        page_data = pn532.ntag2xx_read_block(page)
        if page_data is None:
            raise RuntimeError(f"Read error at page {page}")
        # The driver may return a 16-byte window; only the first 4 bytes are this page.
        payload.extend(page_data[0:PAGE_SIZE])
        # Micro-pause to avoid locking up the I2C bus during aggressive reads.
        time.sleep(0.005)
    return bytes(payload)


def main():
    i2c_bus = busio.I2C(board.SCL, board.SDA)
    pn532 = PN532_I2C(i2c_bus, debug=False)

    print("Reader active. Tap a card...")

    while True:
        uid = pn532.read_passive_target(timeout=0.5)
        if uid is None:
            time.sleep(0.2)
            continue

        hex_uid = "".join(f"{b:02X}" for b in uid)
        print(f"Card detected, UID: {hex_uid}")

        student_id, secret = decode_payload(read_payload(pn532))
        print(f"  student_id: {student_id}")
        print(f"  secret    : {secret}")
        return


if __name__ == "__main__":
    main()
