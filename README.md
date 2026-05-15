# ZK-Frank: Zero-Knowledge Age Verification with DB Logging

A powerful Zero-Knowledge Proof (ZKP) application designed to prove age eligibility without revealing the actual age. This project is optimized to run on resource-constrained devices like the Raspberry Pi and features a secure backend pipeline for proof verification and cryptographic logging.

The core Noir circuit ensures the condition: 
`assert(age > 18);`

The system processes the user's age as a private input, generates a cryptographic proof, verifies it, and securely logs the unique proof hash into a local database. The actual age never leaves the user's local environment.

---

## 🔄 How It Works (The Pipeline)

1. **Data Input:** The application reads private user data from a local `user_data.json` file.
2. **Witness Generation:** The Noir standard library compiles the input into a ZK witness.
3. **Proof Generation:** The Aztec Barretenberg (UltraHonk) backend generates a cryptographic proof based on the witness and the circuit bytecode.
4. **Verification:** The system automatically verifies the proof.
5. **Data Hashing:** If (and only if) the proof is valid, the system creates a deterministic **SHA-256 hash** of the full proof buffer.
6. **Database Logging:** The unique proof hash and a UTC timestamp are securely written to an **SQLite** database.

---

## 🛠 Tech Stack

* **Language:** Noir (v1.0.0-beta.21)
* **ZK Backend:** Aztec Barretenberg (UltraHonk)
* **Runtime:** Node.js (v20+)
* **Database:** SQLite3
* **Hardware:** Raspberry Pi 4B (Tested on Raspbian OS)

---

## 📦 Database Structure

The project automatically initializes and manages a local SQLite database (`proofs.db`). It contains a `validations` table with the following schema:

| Column Name  | Data Type | Description                                      |
| :---         | :---      | :---                                             |
| `id`         | INTEGER   | Primary key with AUTOINCREMENT                   |
| `proof_hash` | TEXT      | The unique SHA-256 hash of the verified ZK proof |
| `created_at` | DATETIME  | Verification timestamp stored in **UTC standard**|

---

## 🚀 Getting Started

### Prerequisites

1. Install [Nargo](https://noir-lang.org/docs/getting_started/installation/) (Noir's package manager).
2. Install Node.js (v20 or higher) and npm.

### Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/forstorrelses/zkfrank.git](https://github.com/forstorrelses/zkfrank.git)
   cd zkfrank

2. **Install Node.js dependencies:**
   ```npm install

3. **Compile the Noir circuit:**

4. **Configure User Data:**
   Create a user_data.json file in the root directory and specift the age:
   ```json
   {
      "age": enter_any_age
   }```

5. **Execution**
   ```node index.js

## ⚙️ Raspberry Pi & Backend Optimizations
Since ZK proof generation is computationally expensive, this project includes specific architectural tweaks for ARM-based and resource-constrained devices:

Asynchronous File I/O: Reading circuit bytecode and user inputs via fs/promises to prevent blocking the main thread.

Manual WASM Initialization: Explicitly booting the Barretenberg WASM engine (Barretenberg.new()) to optimize memory allocation on low-RAM hardware.

Graceful Resource Teardown: Ensuring worker threads and WASM instances are destroyed (BarretenbergAPI.destroy()) immediately after verification to prevent memory leaks.

Cryptographic Data Hashing: Compressing massive ZK proof buffers into lightweight 64-character SHA-256 strings before database insertion to preserve storage space on MicroSD cards.

Industry Standard Timekeeping: Logging dates using the UTC timezone to ensure globally synchronized and tamper-proof verification history.