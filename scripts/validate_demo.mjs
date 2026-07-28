// End-to-end demo against a local network: deploy StudentId, issue a credential,
// then privately validate it and prove the nullifier makes it single-use.
import { readFileSync } from 'node:fs';
import { EmbeddedWallet } from '@aztec/wallets/embedded';
import { getInitialTestAccountsData } from '@aztec/accounts/testing';
import { Contract } from '@aztec/aztec.js/contracts';
import { loadContractArtifact } from '@aztec/aztec.js/abi';

const NODE_URL = 'http://localhost:8080';
const ARTIFACT = '../circuits/target/zkfrank_contract-StudentId.json';

const STUDENT_ID = 1001;
const SECRET = 42;

// 1. Wallet with an in-process PXE. Ephemeral state, proving disabled for speed.
const wallet = await EmbeddedWallet.create(NODE_URL, {
  ephemeral: true,
  pxe: { proverEnabled: false },
});

// 2. Register the pre-deployed, pre-funded local network test accounts.
const accountsData = await getInitialTestAccountsData();
const [admin, student] = await Promise.all(
  accountsData.map(async (a) =>
    (await wallet.createSchnorrAccount(a.secret, a.salt, a.signingKey)).address
  ),
);
console.log('admin  :', admin.toString());
console.log('student:', student.toString());

// 3. Deploy the contract; the first account becomes the university (admin).
const artifact = loadContractArtifact(
  JSON.parse(readFileSync(new URL(ARTIFACT, import.meta.url), 'utf8')),
);
const contract = await Contract.deploy(wallet, artifact, [admin]).send({ from: admin });
console.log('contract:', contract.address.toString());

// 4. Compute commitment = poseidon2([student_id, secret]).
const commitment = await contract.methods.compute_commitment(STUDENT_ID, SECRET).simulate({ from: admin });
console.log('commitment:', commitment);

// 5. The university issues the credential.
await contract.methods.issue_credential(commitment).send({ from: admin });
console.log('issued, is_valid =', await contract.methods.is_valid(commitment).simulate({ from: admin }));

// 6. The student proves ownership privately, then tries to reuse the credential.
await contract.methods.validate(STUDENT_ID, SECRET).send({ from: student });
console.log('validate #1: OK');

try {
  await contract.methods.validate(STUDENT_ID, SECRET).send({ from: student });
  console.log('validate #2: OK - this is bad, the nullifier did not work');
} catch (e) {
  console.log('validate #2 rejected as expected:', e.message);
}
