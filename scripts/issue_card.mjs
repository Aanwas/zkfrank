// issue_card.mjs
//
// The college side of issuance. Deploys StudentId pinned to the college public
// key, mints one credential, signs it, and prints the command that writes the
// card on the Pi.
//
// This runs on the PC and not on the Pi for two reasons. The commitment is a
// poseidon2 hash, which only the Aztec stack can compute, and the college
// private key has no business living on a card-writing terminal. The Pi is
// handed three finished values and writes them; it learns nothing it could
// forge a card with.
//
// Usage: node --env-file=.env scripts/issue_card.mjs <student_id>

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { getInitialTestAccountsData } from '@aztec/accounts/testing';
import { Contract } from '@aztec/aztec.js/contracts';
import { loadContractArtifact } from '@aztec/aztec.js/abi';

import { generateSchoolKeys, signStudentData } from '../backend/src/crypto/ecdsa.js';

const NODE_URL = 'http://localhost:8080';
const ARTIFACT = '../circuits/target/zkfrank_contract-StudentId.json';

// The college keypair. Persisted so that every card issued on this machine is
// signed by the same key the deployed contract trusts.
const KEY_FILE = new URL('../college-key.json', import.meta.url);
// Where the deployed address is left for validate_demo.mjs to pick up.
const STATE_FILE = new URL('../.zkfrank-state.json', import.meta.url);

// BN254 scalar field modulus - a Field element must stay below it.
const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const studentId = BigInt(process.argv[2] ?? die('Usage: node scripts/issue_card.mjs <student_id>'));

function die(message) {
    throw new Error(message);
}

// Load the college keypair, creating it on first run. Both halves are JWKs, so
// they serialize to JSON as they are.
function loadOrCreateCollegeKeys() {
    if (existsSync(KEY_FILE)) {
        return JSON.parse(readFileSync(KEY_FILE, 'utf8'));
    }

    const keys = generateSchoolKeys();
    // The private key is written to disk, so keep it out of git. college-key.json
    // is listed in .gitignore; this check is here because a leaked issuing key
    // means anyone can mint student credentials.
    writeFileSync(KEY_FILE, JSON.stringify(keys, null, 2));
    console.error('Generated a new college keypair at college-key.json');
    return keys;
}

// A Field as the 32 big-endian bytes the circuit sees, given the value as a
// bigint. This is the shape Field::to_be_bytes() produces in Noir.
function fieldBytes(value) {
    return Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
}

const college = loadOrCreateCollegeKeys();
const publicKeyX = Buffer.from(college.publicKey.x, 'base64url');
const publicKeyY = Buffer.from(college.publicKey.y, 'base64url');

// 1. Wallet with an in-process PXE. Ephemeral state, proving disabled for speed.
const wallet = await EmbeddedWallet.create(NODE_URL, {
    ephemeral: true,
    pxe: { proverEnabled: false },
});

// 2. Register the pre-deployed, pre-funded local network test accounts.
const accountsData = await getInitialTestAccountsData();
const [admin] = await Promise.all(
    accountsData.map(async (a) =>
        (await wallet.createSchnorrAccount(a.secret, a.salt, a.signingKey)).address
    ),
);

// 3. Deploy, pinning the college public key into the contract. Every signature
// the contract will ever accept has to come from the matching private key.
const artifact = loadContractArtifact(
    JSON.parse(readFileSync(new URL(ARTIFACT, import.meta.url), 'utf8')),
);
// send() resolves to { contract, receipt }, not the contract itself.
const { contract } = await Contract.deploy(wallet, artifact, [
    admin,
    [...publicKeyX],
    [...publicKeyY],
]).send({ from: admin });
console.error('contract:', contract.address.toString());

// 4. The card secret. randomBytes draws from the OS cryptographic source: this
// is what stops an attacker from recovering the student id from the commitment,
// which is published in the clear as an argument to issue_credential. A
// hand-picked secret would fall to a search of a few thousand hashes.
const secret = BigInt('0x' + randomBytes(32).toString('hex')) % FIELD_MODULUS;

// 5. Ask the contract for commitment = poseidon2([student_id, secret]), so the
// value signed is bit-for-bit the one validate() will recompute.
// simulate() resolves to { result, offchainEffects, offchainMessages }.
const { result: commitment } = await contract.methods
    .compute_commitment(studentId, secret)
    .simulate({ from: admin });

// 6. Sign the commitment with the college key. The raw 32 bytes are what gets
// signed, never a string of them: signStudentData hashes whatever it is given
// and the circuit hashes these bytes, so anything else makes the digests differ.
const commitmentBytes = fieldBytes(BigInt(commitment));
const signature = signStudentData(college.privateKey, commitmentBytes);

if (signature.length !== 64) {
    throw new Error(`Expected a 64-byte r||s signature, got ${signature.length}`);
}

// 7. Register the credential, so the registry and the signature agree.
await contract.methods.issue_credential(commitment).send({ from: admin });

// 8. Leave the address for validate_demo.mjs. The local network keeps the
// contract alive between script runs, so the demo can validate this very card.
writeFileSync(STATE_FILE, JSON.stringify({ contractAddress: contract.address.toString() }, null, 2));

// Progress went to stderr; stdout carries the one line that matters.
console.log(
    `python3 nfc_writer.py --student-id ${studentId} --secret ${secret} --signature ${signature.toString('hex')}`,
);
