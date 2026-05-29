# ZK-Frank: Zero-Knowledge NFC Passport Authentication

A Zero-Knowledge Proof (ZKP) application designed to cryptographically prove the possession of a valid State-issued signature over sensitive data (e.g., a Social Security Number) without revealing the underlying data to the verifier. 

This project is optimized to run on resource-constrained devices like the Raspberry Pi and features a secure modular backend pipeline for issuance, proof verification, and cryptographic logging.

The core Noir circuit utilizes elliptic curve cryptography (secp256r1) to ensure the condition: 
`assert(is_valid == true);`

The system processes the user's encrypted data as private inputs, generates a cryptographic proof, verifies it mathematically, and securely logs a unique footprint into a local database to prevent Sybil attacks (double-spending of an identity).

---

## Backend Architecture

The backend is completely modularized and split into three logical entities to simulate a real-world Web3 architecture:

### 1. Issuer
* **`src/issuer.js`**: The main entry point for the State. Generates ECDSA keys, hashes user data (SSN), signs it, and formats the arrays for Noir. Outputs the simulated "chip" data to `nfc_passport.json`.
* **`src/crypto/ecdsa.js`**: Handles elliptic curve cryptography (secp256r1) and ensures strict Low-S signature malleability protection.
* **`src/utils/formats.js`**: Utility functions to convert buffers into Noir-compatible arrays.

### 2. ZK Prover 
* **`src/zkp/prover.js`**: Interfaces with the Barretenberg backend. Takes the passport data, executes the Noir circuit to generate a mathematical witness, computes the heavy Zero-Knowledge proof, and contains the logic for cryptographic proof verification.

### 3. Verifier
* **`src/verifier.js`**: The main entry point for the verifier. Simulates reading the NFC chip data, requests a ZK proof, cryptographically verifies the proof to prevent spoofing, extracts the public Nullifier, and interacts with the database.
* **`src/database/db.js`**: An asynchronous SQLite wrapper that ensures Sybil-resistance by checking for duplicate Nullifiers.

---

## Current Development Status: The Prototype

At this stage, the core cryptographic engine and modular architecture are successfully operational. Please note the following temporary developmental implementations:

* **Mock Data Inputs:** User data (e.g., SSN) is currently hardcoded for circuit testing and saved to a local `nfc_passport.json` file. Future iterations will dynamically read/write encrypted data from a physical NFC chip using a Raspberry Pi hardware module (`nfc-pcsc`).
* **Static Nullifier:** The Noir circuit currently extracts the first byte of the public key as a nullifier. True Sybil-resistance will be implemented later via Poseidon/Pedersen hashing inside the `.nr` contract.

---

## Tech Stack

* **Language:** Noir (v1.0.0-beta.21)
* **ZK Backend:** Aztec Barretenberg (UltraHonk)
* **Runtime:** Node.js (v20+) with native `crypto` API
* **Database:** SQLite3
* **Hardware:** Raspberry Pi 4B/5 (Tested on Debian/Raspbian OS)

---

## Database Structure

The project automatically initializes and manages a local SQLite database (`proofs.db`). It contains a `validations` table with the following schema:

| Column Name  | Data Type | Description                                              |
| :---         | :---      | :---                                                     |
| `id`         | INTEGER   | Primary key with AUTOINCREMENT                           |
| `proof_hash` | TEXT      | The unique nullifier emitted by the Noir circuit         |
| `created_at` | DATETIME  | Verification timestamp stored in **UTC standard** |

---

## Getting Started

### Prerequisites

1. Install [Nargo](https://noir-lang.org/docs/getting_started/installation/) (Noir's package manager).
2. Install Node.js (v20 or higher) and npm.
3. **Install System Dependencies (SQLite3):**
   On Debian/Ubuntu/Raspbian (Raspberry Pi), run the following command to ensure SQLite3 and build tools are built into your system:
   ```bash
   sudo apt update
   sudo apt install sqlite3 build-essential -y

## Installation $ Setup
1. Clone the repository:
```bash
git clone [https://github.com/forstorrelses/zkfrank.git](https://github.com/forstorrelses/zkfrank.git)
cd zkfrank
```

2. Install Node.js dependencies:
```bash
cd backend
npm install
```

3. Compile the Noir circuit:
```bash
cd ../circuits
nargo compile
```

## Execution
The execution is split into two distinct steps to simulate the real-world flow. Navigate to the backend directory:
```bash
cd backend
```

### Step 1: Issue a new ID
This will generate keys, sign the mock data, and write it to nfc_passport.json (acting as our simulated NFC chip).
```bash
node src/issuer.js
```

### Step 2: Verify the ID
This will read the simulated chip, generate the ZKP, mathematically verify it, and save the nullifier to the SQLite database. Running this twice will trigger the Sybil-resistance protection.
```bash
node src/verifier.js
```

## Raspberry PI & Backend Optimizations
Since ZK proof generation is computationally expensive, this project includes specific architectural tweaks for ARM-based and resource-constrained devices:
* Asynchronous File I/O: Reading circuit bytecode and inputs via fs/promises to prevent blocking the main thread.
* Modern Aztec APIs: Utilizing UltraHonkBackend and separating the Noir execution phase (witness generation) from the heavy Barretenberg proof generation to optimize memory allocation.
* Strict Security Flow: Enforcing cryptographic proof verification before any database interaction to prevent malicious database bloat.
* Industry Standard Timekeeping: Logging dates using the UTC timezone to ensure globally synchronized and tamper-proof verification history.

## Hardware Integration (Physical NFC)

Step 1: Wire the NFC Module
Connect your PN532 NFC module to the Raspberry Pi using the I2C interface. Ensure the pins are securely connected:

VCC -> 3.3V or 5V

GND -> Ground

SDA -> SDA (Pin 3)

SCL -> SCL (Pin 5)

Step 2: Install Python Package Manager
Ensure your Raspberry Pi has pip3 installed to manage Python dependencies:
```bash
sudo apt update
sudo apt install python3-pip -y
```

Step 3: Install Adafruit Drivers
Install the official Adafruit hardware libraries required for the I2C bridge. (Note: The --break-system-packages flag is necessary on newer Raspberry Pi OS versions to install libraries globally).

```bash
pip3 install adafruit-blinka adafruit-circuitpython-pn532 --break-system-packages
```

Step 4: Run the System
You do not need to execute the Python script manually. Once the wiring and drivers are set up, simply start the Node.js backend as usual:
```bash
node nfc_test.js
```
Make sure to run it in the backend directory.

The Node.js process will automatically spin up the Python hardware bridge in the background and wait for physical NFC card taps.

The hardware for it is Waveshare PN532 NFC HAT and NTAG215. 