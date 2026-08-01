# ZK-Frank: private student ID on Aztec

Prove you are a valid student without revealing who you are.

A college issues credentials on the [Aztec Network](https://aztec.network). Only a
commitment ever touches the chain — the student id itself never leaves the card. The
student then privately proves two things at once: that they know the values behind a
registered commitment, and that the college signed that commitment. A nullifier scoped
to the day makes the credential usable once per day.

The credential lives on a physical NFC card, read by a Raspberry Pi.

**Target scenario:** a student claims a discount at a library terminal. The library is a
third party — it has no access to the college's registry — which is exactly why the card
carries a signature and not just a commitment.

---

## How it works

The contract stores `commitment = poseidon2([student_id, secret])` and the college's
public key. Nothing else.

1. **Issue** — the college computes the commitment off-chain, signs it with its
   secp256r1 key, and calls `issue_credential(commitment)`. The chain sees a hash, not
   an identity. The card gets `student_id`, `secret` and the 64-byte signature.
2. **Validate** — the student calls the private function
   `validate(student_id, secret, signature, day)`. Inside the circuit it:
   - recomputes the commitment,
   - verifies the college signature over it with `ecdsa_secp256r1::verify_signature`,
   - pushes `nullifier = poseidon2([commitment, secret, day])`,
   - and asks the public side to assert the credential is valid and that `day` is really
     today.

   None of the inputs appear in the transaction.
3. **Reuse the same day is rejected** — a second `validate` emits the same nullifier and
   the network refuses it: `Attempted to emit duplicate siloed nullifier`. Tomorrow the
   day changes, the nullifier changes, and the student can claim again.
4. **Revoke** — the college can call `revoke_credential(commitment)` at any time.

Three properties, three mechanisms:

| Property | Mechanism |
|---|---|
| The id is never published | commitment — only the hash goes on chain |
| One discount per day | nullifier includes the day, checked against block time |
| A third party can trust the card without asking the college | college signature, verified inside the circuit |

### Why both a commitment and a signature

The commitment model alone works only inside the college's own ecosystem: to check a
card, a verifier has to consult the registry the college owns. A library does not have
that access.

The signature makes issuance verifiable against a public key, with no request to the
college. But a signature cannot be taken back — nothing about it changes when a student
graduates or loses their card. Revocation needs a registry.

So `validate` checks both, and it is worth being precise about what that buys:

* **The signature** proves the college issued this credential. Anyone holding the public
  key can establish that, offline.
* **The registry** proves it has not been revoked since. That check reads contract state,
  so the verifier does go to chain — it just never has to ask the college itself.

The honest one-line version: the signature removes the dependency on the *college*, not
the dependency on the *chain*.

### Why the day is checked publicly

A private circuit cannot see a clock. If `day` were taken on trust, a student could mint
unlimited discounts by passing a different number each time. So `validate` enqueues a
public call that compares `day` against the block timestamp.

### Why the public key is not on the card

A card carrying its own public key could be handed a forged signature together with the
matching key, and would verify happily. The trust anchor has to be the key pinned into
the contract at deployment.

---

## Architecture

```
[NTAG215 card] --tap--> [Raspberry Pi + PN532]     card reader only, no Aztec
                              |
                              | SSH
                              v
                        [PC / WSL2]                 PXE builds the proof
                              |                     the college signing key lives here
                              v
                     [Aztec local network]          contract lives here
```

Proof generation is heavy, so it runs on x86 rather than on the Pi. Issuance also runs on
the PC: the commitment is a poseidon2 hash that only the Aztec stack can compute, and the
signing key has no business sitting on a card-writing terminal. The Pi receives three
finished values and writes them — it learns nothing it could forge a card with.

---

## Repository layout

```
circuits/
  zkfrank_contract/    the StudentId contract (Noir / Aztec.nr)
  zkfrank_test/        TXE tests, a separate crate so test edits do not
                       invalidate the contract artifact
    fixture.nr         generated signatures - Noir can verify but not sign
scripts/
  issue_card.mjs       college side: deploy, sign, issue, print the writer command
  validate_demo.mjs    end-to-end demo: read a card, prove, claim, fail on reuse
  ecdsa_fixture.mjs    regenerates circuits/zkfrank_test/src/fixture.nr
backend/
  nfc_layout.py        single source of truth for the on-card format
  nfc_writer.py        write a credential to a card
  nfc_reader.py        read it back as JSON
  src/crypto/ecdsa.js  college keygen and low-S signing
```

---

## Tech stack

* **Contract:** Noir / Aztec.nr, Aztec **4.3.0** (pinned — Aztec breaks APIs between majors)
* **Client:** `@aztec/aztec.js` + `@aztec/wallets` 4.3.0, Node.js 20.10+
* **Signatures:** secp256r1 (P-256), raw `r||s`, low-S normalized as Noir requires
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
cp .env.example .env     # then fill in your Pi's address
```

### Compile and test the contract

`circuits/target/` is gitignored, so the artifact has to be built before anything else
can run:

```bash
cd circuits
aztec compile          # produces target/zkfrank_contract-StudentId.json
aztec test             # 15 tests: access control, revocation, private validate,
                       # daily reuse, signature forgery, and cross-language
                       # agreement on poseidon2 and ECDSA
```

### Run the end-to-end demo

Start a local network in one terminal:

```bash
aztec start --local-network
```

Issue a card. This deploys the contract pinned to the college key, mints a credential,
signs it, and writes it to a card on the Pi — tap a blank card when asked:

```bash
node --env-file=.env scripts/issue_card.mjs 1001
node --env-file=.env scripts/issue_card.mjs 2002   # a second student, same contract
```

The contract from the previous run is reused by default, so several students can hold
valid cards at once. `--redeploy` starts a fresh one, which invalidates every card issued
before it. `--no-write` prints the credential instead of writing it.

Then claim the discount:

```bash
node --env-file=.env scripts/validate_demo.mjs
```

Or watch it happen, at `http://localhost:4173`:

```bash
node --env-file=.env frontend/server.mjs
```

It reads the card over SSH, builds a proof, claims the discount, then tries again the
same day and shows the network rejecting the duplicate nullifier.

On first run `issue_card.mjs` creates `college-key.json`. **Whoever holds that file can
mint valid student credentials** — it is gitignored, keep it that way. It is also stored
unencrypted, which is fine for a local demo and would not be for anything real; a genuine
issuer would keep that key in an HSM or a KMS. The deployed address goes to
`.zkfrank-state.json`, which the demo reads.

If the local network is restarted, redeploy and reissue: the contract address changes,
and a card issued against the old one is not registered in the new registry.

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

### On-card format

128 bytes in pages 4..35, of the 504 an NTAG215 offers:

```
[ 32 bytes student_id ][ 32 bytes secret ][ 64 bytes college signature ]
```

`student_id` and `secret` are Aztec `Field` elements, big-endian. The signature is raw
`r||s` — two independent 32-byte halves, which is why it travels as hex rather than as a
decimal string: read as one integer, a leading zero byte in `r` would be lost.

The writer reads the card back to verify what it wrote. A blank card is rejected because
`0xFF...` is not a valid field element.

```bash
python3 backend/nfc_writer.py --student-id 1001 --secret <decimal> --signature <hex>
python3 backend/nfc_reader.py --once
```

These run on the Pi only — there is no I2C bus on a PC.

---

## Status

Working end-to-end: the college signs a commitment, the Pi writes the card, the terminal
reads it over SSH, PXE builds the proof, the contract verifies the signature inside the
circuit, and the daily nullifier blocks a second claim.

The project deliberately targets a local network rather than testnet — the contract, PXE,
private execution and nullifiers behave identically, and testnet would only add block
waits and faucet steps.

`backend/src/` still holds an earlier iteration of this project (`issuer.js`,
`verifier.js`, `prover.js`, SQLite logging). Only `src/crypto/ecdsa.js` is part of the
current flow; the rest is kept for reference.
