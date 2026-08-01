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
// Usage:
//   node --env-file=.env scripts/issue_card.mjs <student_id> [--redeploy] [--no-write]
//
//   --redeploy   start a fresh contract, invalidating every card issued so far
//   --no-write   print the credential instead of writing it to a card
//
// By default the contract from the last run is reused, so several students can
// hold valid cards at the same time.

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { getInitialTestAccountsData } from '@aztec/accounts/testing';
import { Contract } from '@aztec/aztec.js/contracts';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { loadContractArtifact } from '@aztec/aztec.js/abi';
import { poseidon2Hash } from '@aztec/foundation/crypto/poseidon';

import { generateSchoolKeys, signStudentData } from '../backend/src/crypto/ecdsa.js';
import { askPi } from './lib/claim.mjs';

const NODE_URL = 'http://localhost:8080';
const ARTIFACT = '../circuits/target/zkfrank_contract-StudentId.json';

// The college keypair. Persisted so that every card issued on this machine is
// signed by the same key the deployed contract trusts.
const KEY_FILE = new URL('../college-key.json', import.meta.url);
// Where the deployed address is left for validate_demo.mjs to pick up.
const STATE_FILE = new URL('../.zkfrank-state.json', import.meta.url);

// BN254 scalar field modulus - a Field element must stay below it.
const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const args = process.argv.slice(2);
const redeploy = args.includes('--redeploy');
const writeCard = !args.includes('--no-write');

const positional = args.find((a) => !a.startsWith('--'));
if (positional === undefined) {
    throw new Error('Usage: node scripts/issue_card.mjs <student_id> [--redeploy] [--no-write]');
}
const studentId = BigInt(positional);

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

// A uniformly random Field element.
//
// Rejection sampling, not `randomBytes(32) % FIELD_MODULUS`: 2^256 is not a
// multiple of the modulus, so the remainder favours the bottom 29% of the range
// by 20%. That matters because this secret is the only thing standing between a
// published commitment and a brute-force search for the student id behind it.
// Each draw succeeds with probability ~0.189, so the loop is short but not
// guaranteed to be - which is exactly why it is a loop.
function randomField() {
    while (true) {
        const candidate = BigInt('0x' + randomBytes(32).toString('hex'));
        if (candidate < FIELD_MODULUS) {
            return candidate;
        }
    }
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

// 3. Attach to the contract already in use, or deploy a fresh one.
//
// Reusing it is the default because issuing a second card should not invalidate
// the first. A new deployment starts an empty registry, so every card issued
// against the previous one stops validating - which is exactly what happened
// before this branch existed.
const artifact = loadContractArtifact(
    JSON.parse(readFileSync(new URL(ARTIFACT, import.meta.url), 'utf8')),
);

let contract = null;
if (!redeploy && existsSync(STATE_FILE)) {
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    const node = createAztecNodeClient(NODE_URL);
    const instance = await node.getContract(AztecAddress.fromString(state.contractAddress));

    if (instance) {
        // The contract only accepts signatures from the key it was deployed
        // with. Attaching with a different one would produce cards that fail
        // deep inside the circuit as "Invalid college signature", with nothing
        // pointing at the real cause - so refuse early and say why.
        if (state.collegePublicKeyX !== publicKeyX.toString('hex')) {
            throw new Error(
                'college-key.json does not match the key this contract was deployed with. ' +
                    'Cards signed now would never verify. Pass --redeploy to start a new contract.',
            );
        }
        await wallet.registerContract(instance, artifact);
        contract = Contract.at(instance.address, artifact, wallet);
        console.error('contract: reusing', contract.address.toString());
    } else {
        console.error('contract: the node no longer knows the stored address, deploying a new one');
    }
}

if (!contract) {
    // Deploy, pinning the college public key into the contract. Every signature
    // the contract will ever accept has to come from the matching private key.
    // send() resolves to { contract, receipt }, not the contract itself.
    ({ contract } = await Contract.deploy(wallet, artifact, [
        admin,
        [...publicKeyX],
        [...publicKeyY],
    ]).send({ from: admin }));
    console.error('contract: deployed', contract.address.toString());
}

// 4. The card secret, drawn from the OS cryptographic source. This is what stops
// an attacker from recovering the student id from the commitment, which is
// published in the clear as an argument to issue_credential. A hand-picked
// secret would fall to a search of a few thousand hashes.
const secret = randomField();

// 5. commitment = poseidon2([student_id, secret]), computed locally.
//
// Deliberately not asked of the contract: passing the raw id and secret as
// arguments to a contract function is the one thing this whole scheme exists to
// avoid, even in a view. The same poseidon2 the circuit uses is available here,
// so validate() will recompute this value bit for bit.
const commitment = (await poseidon2Hash([studentId, secret])).toBigInt();

// 6. Sign the commitment with the college key. The raw 32 bytes are what gets
// signed, never a string of them: signStudentData hashes whatever it is given
// and the circuit hashes these bytes, so anything else makes the digests differ.
const commitmentBytes = fieldBytes(commitment);
const signature = signStudentData(college.privateKey, commitmentBytes);

if (signature.length !== 64) {
    throw new Error(`Expected a 64-byte r||s signature, got ${signature.length}`);
}

// 7. Register the credential, so the registry and the signature agree.
await contract.methods.issue_credential(commitment).send({ from: admin });

// 8. Leave the address and the key it was deployed with, so the next issuance
// can reuse this contract and refuse to sign with a mismatched key.
writeFileSync(STATE_FILE, JSON.stringify({
    contractAddress: contract.address.toString(),
    collegePublicKeyX: publicKeyX.toString('hex'),
}, null, 2));

// 9. Hand the finished credential to the card writer.
const credential = JSON.stringify({
    student_id: studentId.toString(),
    secret: secret.toString(),
    signature: signature.toString('hex'),
});

if (writeCard) {
    console.error('card    : tap a blank card on the reader...');
    process.stderr.write(askPi('write', credential));
    console.error(`card    : student ${studentId} written`);
} else {
    // stdout carries the credential and nothing else, so it can be piped.
    console.log(credential);
    console.error('card    : not written (--no-write). Pipe the line above into');
    console.error('          python3 backend/nfc_writer.py --stdin on the Pi.');
}
