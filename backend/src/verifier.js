import { readFile } from 'fs/promises';
import { generateZkProof } from './zkp/prover.js';
import { initDatabase, saveProofToDatabase } from './database/db.js';

async function verifyIdentity() {
    console.log("Starting Bank Verification Terminal...");

    // initialize the database
    await initDatabase();

    // read the passport file (NFC chip tap)
    console.log("Reading NFC Passport...");
    const passportRaw = await readFile('../nfc_passport.json', 'utf-8');
    
    // convert the raw text string back into a JavaScript object
    const passportData = JSON.parse(passportRaw);
    
    // generate Zero-Knowledge Proof (calls the code from prover.js)
    const proofData = await generateZkProof(passportData);

    // extract the public input (Nullifier) from the proof
    const nullifier = proofData.publicInputs[0].toString();
    console.log(`Public Nullifier extracted: ${nullifier}`);

    // save to database and check for duplicates
    const isSaved = await saveProofToDatabase(nullifier);

    if (isSaved) {
        console.log(" Verification Complete! Welcome.");
    } else {
        console.log("This user already exists");
    }
}

// Execute the terminal
verifyIdentity();