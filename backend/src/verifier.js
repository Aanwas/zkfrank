import { readFile } from 'fs/promises';
import { generateZkProof, verifyZkProof } from './zkp/prover.js';
import { initDatabase, saveProofToDatabase } from './database/db.js';

async function verifyIdentity() {
    console.log("Starting Verification Terminal...");

    // initialize the database
    await initDatabase();

    // read the passport file (NFC chip tap)
    console.log("Reading NFC Passport...");
    const passportRaw = await readFile('../nfc_passport.json', 'utf-8');
    
    // convert the raw text string back into a JavaScript object
    const passportData = JSON.parse(passportRaw);
    
    // generate Zero-Knowledge Proof (calls the code from prover.js)
    const proofData = await generateZkProof(passportData);

    // security check if the proof is fake
    console.log("Checking if the proof is fake...");
    const isValidProof = await verifyZkProof(proofData);
    
    if (!isValidProof) {
        console.log("ALARM: Fake proof detected. Arresting user.");
        return; // stop the script entirely before touching the database!
    }
    console.log("Proof is valid!");

    // extract the public input (Nullifier) from the proof
    const nullifier = proofData.publicInputs[0].toString();
    console.log(`Public Nullifier extracted: ${nullifier}`);

    // save to database and check for duplicates ONLY if the proof was valid
    const isSaved = await saveProofToDatabase(nullifier);

    if (isSaved) {
        console.log("Verification Complete! Welcome.");
    } else {
        console.log("ACCESS DENIED: This user already exists.");
    }
}

verifyIdentity();