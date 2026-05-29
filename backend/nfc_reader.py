# nfc_reader.py
import time
import board
import busio
from adafruit_pn532.i2c import PN532_I2C

def main():
    # Initialize I2C bus and the physical PN532 controller
    i2c_bus = busio.I2C(board.SCL, board.SDA)
    pn532_sensor = PN532_I2C(i2c_bus, debug=False)

    # Validate firmware communication with the chip
    _, ver, rev, _ = pn532_sensor.firmware_version
    
    # Infinite polling loop for scanning NFC targets
    while True:
        # Check if an ISO14443A passive target (card/fob) is present in the RF field
        card_uid = pn532_sensor.read_passive_target(timeout=0.5)
        
        if card_uid is not None:
            # Parse byte array to a clean uppercase Hex string
            hex_uid = "".join([f"{byte:02X}" for byte in card_uid])
            print(f"UID:{hex_uid}")
            
            # Rate-limiting cooldown to prevent duplicate scanning spam
            time.sleep(1.5)

if __name__ == "__main__":
    main()