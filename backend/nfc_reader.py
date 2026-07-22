# nfc_reader.py
import time
import board
import busio
from adafruit_pn532.i2c import PN532_I2C

def main():
    i2c_bus = busio.I2C(board.SCL, board.SDA)
    pn532 = PN532_I2C(i2c_bus, debug=False)
    
    print("📡 Hardware Reader Active. Waiting for card tap...")

    while True:
        uid = pn532.read_passive_target(timeout=0.5)
        
        if uid is not None:
            hex_uid = "".join([f"{b:02X}" for b in uid])
            
            try:
                payload_bytes = bytearray()
                
                for page in range(4, 44):
                    page_data = pn532.ntag2xx_read_block(page)
                    
                    if page_data is not None:
                        # CRITICAL: Take only the first 4 bytes
                        # This guards the buffer in case the driver returns 16 bytes
                        payload_bytes.extend(page_data[0:4])
                    else:
                        raise Exception(f"Read error at page {page}")

                    # Micro-pause to avoid locking up the I2C bus during aggressive reads
                    time.sleep(0.005)
                
                hex_payload = "".join([f"{b:02X}" for b in payload_bytes])
                print(f"UID:{hex_uid},PAYLOAD:{hex_payload}")
                
                time.sleep(3.0)
                
            except Exception as e:
                print(f"UID:{hex_uid},ERROR:{e}")
                time.sleep(1.0)

if __name__ == "__main__":
    main()