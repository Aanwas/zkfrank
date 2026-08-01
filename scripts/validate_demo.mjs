// End-to-end demo against a local network: read a card issued by
// scripts/issue_card.mjs, privately validate it, and prove the nullifier makes
// it single-use for the day.
//
// The contract is NOT deployed here. issue_card.mjs deploys it, pins the college
// public key into it, and leaves the address behind - validating against a
// freshly deployed contract would be meaningless, since it would know neither
// this card's commitment nor the key that signed it.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { getInitialTestAccountsData } from '@aztec/accounts/testing';
import { Contract } from '@aztec/aztec.js/contracts';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { loadContractArtifact } from '@aztec/aztec.js/abi';

const NODE_URL = 'http://localhost:8080';
const ARTIFACT = '../circuits/target/zkfrank_contract-StudentId.json';
const STATE_FILE = new URL('../.zkfrank-state.json', import.meta.url);

const PI_HOST = requireEnv('ZKFRANK_PI_HOST');
const PI_PORT = requireEnv('ZKFRANK_PI_PORT');
const PI_SCRIPT = requireEnv('ZKFRANK_PI_SCRIPT');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Pull the credential off an NFC card. The Pi is the only machine wired to the
// reader, so the reader runs there over SSH and we parse what it prints.
function readCard() {
  const stdout = execFileSync('ssh', ['-p', PI_PORT, PI_HOST, `python3 ${PI_SCRIPT} --once`], {
    encoding: 'utf8',
    // stdin unused, stdout captured for the JSON, stderr inherited so the
    // reader's "Tap a card..." prompt still reaches the human running this.
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  const { student_id, secret, signature } = JSON.parse(stdout);
  if (student_id === undefined || secret === undefined || signature === undefined) {
    throw new Error(`Card payload is missing student_id, secret or signature: ${stdout}`);
  }

  // BigInt, not Number: a Field element runs up to 254 bits and float64 would
  // silently round it. aztec.js takes bigint directly as a FieldLike argument.
  //
  // The signature travels as hex and the contract wants [u8; 64], so it is
  // spread into a plain array of byte values - aztec.js does not take a Buffer.
  const signatureBytes = [...Buffer.from(signature, 'hex')];
  if (signatureBytes.length !== 64) {
    throw new Error(`Card signature must be 64 bytes, got ${signatureBytes.length}`);
  }

  return {
    studentId: BigInt(student_id),
    secret: BigInt(secret),
    signature: signatureBytes,
  };
}

// 1. Find the contract issue_card.mjs deployed.
if (!existsSync(STATE_FILE)) {
  throw new Error('No .zkfrank-state.json - run scripts/issue_card.mjs first to issue a card');
}
const { contractAddress } = JSON.parse(readFileSync(STATE_FILE, 'utf8'));

// 2. Read the card first: a missing or blank card should fail here, before we
// spend time connecting to anything.
const { studentId, secret, signature } = readCard();
console.log('card   :', studentId.toString());

// 3. Wallet with an in-process PXE. Ephemeral state, proving disabled for speed.
const wallet = await EmbeddedWallet.create(NODE_URL, {
  ephemeral: true,
  pxe: { proverEnabled: false },
});

// 4. Register the pre-deployed, pre-funded local network test accounts.
const accountsData = await getInitialTestAccountsData();
const [, student] = await Promise.all(
  accountsData.map(async (a) =>
    (await wallet.createSchnorrAccount(a.secret, a.salt, a.signingKey)).address
  ),
);
console.log('student:', student.toString());

// 5. Attach to the already deployed contract. at() is synchronous despite what
// its docstring claims; the signature in contract/contract.d.ts:21 is
// authoritative.
const artifact = loadContractArtifact(
  JSON.parse(readFileSync(new URL(ARTIFACT, import.meta.url), 'utf8')),
);
const contract = Contract.at(AztecAddress.fromString(contractAddress), artifact, wallet);
console.log('contract:', contract.address.toString());

// 6. Ask the chain what day it is. The local network warps its clock forward, so
// the day derived from this machine's clock would drift out of agreement with
// the contract and validate() would revert with "Wrong day".
// simulate() resolves to { result, offchainEffects, offchainMessages }.
const { result: day } = await contract.methods.current_day().simulate({ from: student });
console.log('day    :', day);

// 7. The student claims the discount. The proof attests to three things at once:
// they know the secret behind a registered commitment, the college signed that
// commitment, and this is the first claim today - all without revealing the id.
await contract.methods.validate(studentId, secret, signature, day).send({ from: student });
console.log('validate #1: OK');

// 8. The same card, the same day, a second time.
try {
  await contract.methods.validate(studentId, secret, signature, day).send({ from: student });
  console.log('validate #2: OK - this is bad, the nullifier did not work');
} catch (e) {
  console.log('validate #2 rejected as expected:', e.message);
}
