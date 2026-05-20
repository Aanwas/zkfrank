# ZK-Frank: Zero-Knowledge ECDSA Signature Verification

A Zero-Knowledge Proof (ZKP) application designed to cryptographically prove the possession of a valid State-issued signature over sensitive data (e.g., a Social Security Number) without revealing the underlying data to the verifier. This project is optimized to run on resource-constrained devices like the Raspberry Pi and features a secure backend pipeline for proof verification and cryptographic logging.

The core Noir circuit utilizes elliptic curve cryptography (secp256r1) to ensure the condition: 
`assert(is_valid == true);`

The system processes the user's encrypted data as private inputs, generates a cryptographic proof, verifies it, and securely logs a unique footprint into a local database to prevent Sybil attacks.

---

## Current Development Status: The Prototype

At this stage, the core cryptographic engine is successfully operational. The project can generate standard ECDSA (secp256r1) key pairs, sign data (simulating a State Issuer), and successfully verify that signature inside a Zero-Knowledge circuit using Noir and the Barretenberg backend. 

Please note the following temporary developmental implementations:

* **Mock Data Inputs:** User data (e.g., SSN) is currently hardcoded for circuit testing. Future iterations will dynamically read encrypted data from a physical NFC chip using a Raspberry Pi Waveshare HAT.
* **Debug Key Exposure:** The State Issuer's private keys are temporarily logged to the terminal for debugging purposes. This will be removed once the architecture is properly split into isolated `Issuer` and `Verifier` modules.
* **Static Nullifier:** The Noir circuit currently returns a hardcoded `0x01` constant instead of a true cryptographic ZK-hash. The database logic is fully functional, but true Sybil-resistance will be implemented later via Poseidon/Pedersen hashing.

---

## How It Works (The Pipeline)

1. **State Issuance (Mocked):** The system generates a cryptographic ECDSA key pair and signs a mock SSN using the Node.js native `crypto` module (ieee-p1363 standard).
2. **Data Packaging:** The raw signature, public keys (X and Y coordinates), and the hashed SSN are converted into Noir-compatible byte arrays.
3. **Witness Generation:** The Noir standard library compiles the inputs into a ZK witness.
4. **Proof Generation:** The Aztec Barretenberg (UltraHonk) backend generates a zero-knowledge proof based on the witness and the circuit bytecode.
5. **Verification:** The system automatically verifies the mathematical proof.
6. **Database Logging:** If the proof is valid, the system securely writes the emitted nullifier and a UTC timestamp into an **SQLite** database.

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

## 🚀 Getting Started

### Prerequisites

1. Install [Nargo](https://noir-lang.org/docs/getting_started/installation/) (Noir's package manager).
2. Install Node.js (v20 or higher) and npm.
3. **Install System Dependencies (SQLite3):**
   On Debian/Ubuntu/Raspbian (Raspberry Pi), run the following command to ensure SQLite3 and build tools are built into your system:
   ```bash
   sudo apt update
   sudo apt install sqlite3 build-essential -y
   ```
### Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/forstorrelses/zkfrank.git](https://github.com/forstorrelses/zkfrank.git)
   cd zkfrank
   ```

2. **Install Node.js dependencies:**
```bash
cd backend
npm install
```

3. **Compile the Noir circuit:**
```bash
cd ../circuits
nargo compile
```

4. **Execution:**
   Navigate back to the backend directory and run the monolithic execution script. No manual data configuration is required for this prototype stage:
   ```bash
   cd ../backend
   node index.js

### Raspberry PI & Backend Optimizations

Since ZK proof generation is computationally expensive, this project includes specific architectural tweaks for ARM-based and resource-constrained devices:

* Asynchronous File I/O: Reading circuit bytecode and inputs via fs/promises to prevent blocking the main thread
* Manual WASM Initialization: Explicitly booting the Barretenberg WASM engine (Barrentenberg.new()) to optimize memory allocation on low-RAM hardware.
* Graceful Resource Teardown: Ensuring worker threads and WASM instances are destroyed (BarretenbergAPI.destroy()) immediately after verification to prevent memory leaks.
* Industry Standard Timekeeping: Logging dates using the UTC timezone to ensure globally synchronized and tamper-proof verification history.
