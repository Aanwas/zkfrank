# ZK-Frank: Zero-Lnowledge Age Verefication

A simple yet powerful Zero-Knowledge Proof (ZKP) application designed to prove age eligibility without revealing the actual age. This project is specifically optimized to run on resource-constrained devices like the **Raspberry Pi**.

This circuit ensures that:
'assert(age > 18);'

The user provide their age as a **private input**. The system then generates a cryptographic proof that the condition is met, while the actual age never leaves the user's environment.

## 🛠 Tech Stack
- **Language**: [Noir](https://noir-lang.org/) (v1.0.0-beta.21)
- **Backend**: [Aztec Barretenberg](https://github.com/AztecProtocol/barretenberg) (UltraHonk)
- **Runtime**: Node.js (v20+)
- **Hardware**: Raspberry Pi 4B (Tested on Raspbian)

## 🚀 Getting Started

### Prerequisites
1. Install **Nargo** (Noir's package manager).
2. Install **Node.js** and **npm**.

### Installation
1. Clone the repository:
   ```bash
   git clone [https://github.com/forstorrelses/zkfrank.git](https://github.com/forstorrelses/zkfrank.git)
   cd zkfrank

Install Dependencies: npm install

Compile the Noir circuit: nargo: compile

Execution: node index.js

If you want a different age you can change it here 
```JavaScript
const input_age = { age: 20 }; // initializing our age
```

⚙️ Raspberry Pi Optimizations
Since ZK proof generation is computationally expensive, this project includes specific tweaks for ARM-based devices:

Manual API Initialization: Explicitly booting the Barretenberg WASM engine.

Dependency Alignment: Strict versioning to match the nargo compiler (v1.0.0-beta.21).

Graceful Shutdown: Ensuring worker threads are destroyed after execution to free up memory.
