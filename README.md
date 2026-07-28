# ZK-Frank: private student ID on Aztec

Prove you are a valid student without revealing who you are.

A university issues credentials on the [Aztec Network](https://aztec.network). Only a
commitment ever touches the chain — the student id itself never leaves the card.
A student then privately proves knowledge of the values behind a registered
commitment, and a nullifier makes each credential usable exactly once (one discount
per student, one entry per pass).

The credential lives on a physical NFC card, read by a Raspberry Pi.

---

## How it works

The contract stores `commitment = poseidon2([student_id, secret])` and nothing else:

1. **Issue** — the university computes the commitment off-chain and calls
   `issue_credential(commitment)`. The chain sees a hash, not an identity.
2. **Validate** — the student calls the private function `validate(student_id, secret)`.
   It recomputes the commitment inside the circuit, pushes
   `nullifier = poseidon2([commitment, secret])`, and asks the public side to assert
   the credential is still valid. The inputs never appear in the transaction.
3. **Reuse is rejected** — a second `validate` with the same credential emits the same
   nullifier, and the network refuses it: `Attempted to emit duplicate siloed nullifier`.
4. **Revoke** — the university can call `revoke_credential(commitment)` at any time.

Privacy comes from the commitment (the id is never published) and single-use comes from
the nullifier (which is public, but reveals nothing about the id).

---

## Architecture

```
[NTAG215 card] --tap--> [Raspberry Pi + PN532]     card reader only, no Aztec
                              |
                              | SSH
                              v
                        [PC / WSL2]                 PXE builds the proof
                              |
                              v
                     [Aztec local network]          contract lives here
```

Proof generation is heavy, so it runs on x86 rather than on the Pi. The Pi does one
job: read the card and hand over the numbers.

---

## Repository layout

```
circuits/
  zkfrank_contract/    the StudentId contract (Noir / Aztec.nr)
  zkfrank_test/        TXE tests, a separate crate so test edits do not
                       invalidate the contract artifact
scripts/
  validate_demo.mjs    end-to-end demo against a local network
backend/
  nfc_layout.py        single source of truth for the on-card format
  nfc_writer.py        write (student_id, secret) to a card
  nfc_reader.py        read it back
```

---

## Tech stack

* **Contract:** Noir / Aztec.nr, Aztec **4.3.0** (pinned — Aztec breaks APIs between majors)
* **Client:** `@aztec/aztec.js` + `@aztec/wallets` 4.3.0, Node.js 20.10+
* **Hardware:** Raspberry Pi + Waveshare PN532 NFC HAT (I2C), NTAG215 cards
* **Card side:** Python 3 with `adafruit-circuitpython-pn532`

---

## Getting started

### Prerequisites

Install the Aztec toolchain (this also provides `aztec-nargo`; use `aztec` rather than a
standalone `nargo`, since a bare `nargo compile` produces incomplete artifacts):

```bash
bash -i <(curl -s https://install.aztec.network)
aztec-up install 4.3.0
```

Then install the JS dependencies:

```bash
git clone https://github.com/Aanwas/zkfrank.git
cd zkfrank
npm install
```

### Compile and test the contract

```bash
cd circuits
aztec compile          # produces target/zkfrank_contract-StudentId.json
aztec test             # 8 TXE tests: access control, revocation, private validate, reuse
```

### Run the end-to-end demo

Start a local network in one terminal:

```bash
aztec start --local-network
```

And run the demo in another:

```bash
node scripts/validate_demo.mjs
```

It deploys the contract, issues a credential, validates it privately, then tries to
reuse it and shows the network rejecting the duplicate nullifier.

---

## NFC card

### Wiring

Connect the PN532 module over I2C: `VCC -> 3.3V/5V`, `GND -> GND`, `SDA -> pin 3`,
`SCL -> pin 5`. Enable I2C via `raspi-config`, then check the module answers:

```bash
i2cdetect -y 1         # the PN532 shows up at address 0x24
```

### Drivers

```bash
sudo apt update && sudo apt install python3-pip -y
pip3 install adafruit-blinka adafruit-circuitpython-pn532 --break-system-packages
```

### Write and read a card

Both values are Aztec `Field` elements, stored big-endian as 32 bytes each in pages
4..19. The writer verifies the card by reading it back, and a blank card is rejected
because `0xFF...` is not a valid field element.

```bash
python3 backend/nfc_writer.py 1001 42
python3 backend/nfc_reader.py
```

These run on the Pi only — there is no I2C bus on a PC.

---

## Status

Working: the contract with its TXE tests, the end-to-end demo against a local network,
and the NFC write/read cycle.

In progress: wiring the card to the network, so that tapping a card triggers a real
`validate` transaction.

The project deliberately targets a local network rather than testnet — the contract,
PXE, private execution and nullifiers behave identically, and testnet would only add
block waits and faucet steps.

`backend/src/` still holds an earlier ECDSA-based iteration of this project
(`issuer.js`, `verifier.js`, `prover.js`, SQLite logging). It is not part of the current
flow and is kept only for reference.
