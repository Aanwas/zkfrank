// End-to-end demo against a local network: deploy StudentId, issue a credential,
// then privately validate it and prove the nullifier makes it single-use.
import { readFileSync } from 'node:fs';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { getInitialTestAccountsData } from '@aztec/accounts/testing';
import { Contract } from '@aztec/aztec.js/contracts';
import { loadContractArtifact } from '@aztec/aztec.js/abi';
import { execFileSync } from 'node:child_process';

const NODE_URL = 'http://localhost:8080';
const ARTIFACT = '../circuits/target/zkfrank_contract-StudentId.json';

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

  const { student_id, secret } = JSON.parse(stdout);
  if (student_id === undefined || secret === undefined) {
    throw new Error(`Card payload is missing student_id or secret: ${stdout}`);
  }

  // BigInt, not Number: a Field element runs up to 254 bits and float64 would
  // silently round it. aztec.js takes bigint directly as a FieldLike argument.
  return { studentId: BigInt(student_id), secret: BigInt(secret) };
}

// 1. Read the card first: a missing or blank card should fail here, before we
// spend time deploying a contract.
const { studentId, secret } = readCard();
console.log('card   :', studentId.toString());

// 2. Wallet with an in-process PXE. Ephemeral state, proving disabled for speed.
const wallet = await EmbeddedWallet.create(NODE_URL, {
  ephemeral: true,
  pxe: { proverEnabled: false },
});

// 3. Register the pre-deployed, pre-funded local network test accounts.
const accountsData = await getInitialTestAccountsData();
const [admin, student] = await Promise.all(
  accountsData.map(async (a) =>
    (await wallet.createSchnorrAccount(a.secret, a.salt, a.signingKey)).address
  ),
);
console.log('admin  :', admin.toString());
console.log('student:', student.toString());

// 4. Deploy the contract; the first account becomes the university (admin).
const artifact = loadContractArtifact(
  JSON.parse(readFileSync(new URL(ARTIFACT, import.meta.url), 'utf8')),
);
// send() resolves to { contract, receipt } - the docstring claiming it returns the
// contract directly is wrong, the signature in deploy_method.d.ts is authoritative.
const { contract } = await Contract.deploy(wallet, artifact, [admin]).send({ from: admin });
console.log('contract:', contract.address.toString());

// 5. Compute commitment = poseidon2([student_id, secret]).
// simulate() resolves to { result, offchainEffects, offchainMessages }, so unwrap result.
const { result: commitment } = await contract.methods.compute_commitment(studentId, secret).simulate({ from: admin });
console.log('commitment:', commitment);

// 6. The university issues the credential.
await contract.methods.issue_credential(commitment).send({ from: admin });
const { result: isValid } = await contract.methods.is_valid(commitment).simulate({ from: admin });
console.log('issued, is_valid =', isValid);

// 7. Ask the chain what day it is. The local network warps its clock forward, so
// the day derived from this machine's clock would drift out of agreement with
// the contract and validate() would revert with "Wrong day".
const { result: day } = await contract.methods.current_day().simulate({ from: student });
console.log('day    :', day);

// 8. The student claims the discount, then tries to claim it twice in one day.
await contract.methods.validate(studentId, secret, day).send({ from: student });
console.log('validate #1: OK');

try {
  await contract.methods.validate(studentId, secret, day).send({ from: student });
  console.log('validate #2: OK - this is bad, the nullifier did not work');
} catch (e) {
  console.log('validate #2 rejected as expected:', e.message);
}
