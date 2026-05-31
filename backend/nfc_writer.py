# nfc_writer.py
import sys
import time
import board
import busio
from adafruit_pn532.i2c import PN532_I2C

def main():
    if len(sys.argv) < 2:
        print("Error: No payload provided to the hardware worker.")
        sys.exit(1)

    hex_payload = sys.argv[1]
    
    try:
        payload_bytes = bytes.fromhex(hex_payload)
    except ValueError:
        print("Error: Invalid HEX payload format.")
        sys.exit(1)

    if len(payload_bytes) != 160:
        print(f"Error: Expected exactly 160 bytes. Got {len(payload_bytes)}.")
        sys.exit(1)

    print(f"Hardware Worker Active. Payload received (160 bytes).")

    i2c_bus = busio.I2C(board.SCL, board.SDA)
    pn532 = PN532_I2C(i2c_bus, debug=False)
    
    print("\nPlease tap the NTAG215 card to the reader to write the ZK-Passport...")
    
    while True:
        uid = pn532.read_passive_target(timeout=0.5)
        if uid is not None:
            hex_uid = "".join([f"{b:02X}" for b in uid])
            print(f"Card detected! UID: {hex_uid}")
            
            try:
                print("Burning cryptographic payload into physical memory...")
                for i in range(0, len(payload_bytes), 4):
                    page_number = 4 + (i // 4)
                    chunk = payload_bytes[i:i+4]
                    
                    pn532.ntag2xx_write_block(page_number, chunk)
                    
                    # giving time to ntag215 to write the information 
                    time.sleep(0.015) 
                    
                    if page_number % 10 == 0:
                        print(f"   ... reached page {page_number}/43")
                
                print("\nWRITE COMPLETE! The 160-byte ZK-Passport is securely locked in the chip.")
                break
            except Exception as e:
                print(f"Physical write error on card: {e}")
                break
                
        time.sleep(0.2)

if __name__ == "__main__":
    main()