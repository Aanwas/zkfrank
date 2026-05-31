import { spawn } from 'child_process';
import { generateZkProof, verifyZkProof } from './zkp/prover.js';
import { initDatabase, saveProofToDatabase } from './database/db.js';
import { bufferToNoirArray } from './utils/formats.js';

async function startVerificationTerminal() {
    console.log("\n=== ZK-Frank: School Turnstile Terminal ===");
    
    // Initialize SQLite Database
    await initDatabase();

    // Start the Python Hardware Bridge
    const pythonReader = spawn('python3', ['-u', 'nfc_reader.py']);

    pythonReader.stdout.on('data', async (data) => {
        const output = data.toString().trim();
        
        // Listen specifically for the PAYLOAD string
        if (output.includes('PAYLOAD:')) {
            const parts = output.split(',');
            const uidStr = parts[0].split(':')[1];
            const payloadHex = parts[1].split(':')[1];

            console.log(`\n[CARD SCANNED] Physical UID: ${uidStr}`);
            console.log(`Payload extracted: ${payloadHex.length / 2} bytes`);

            // Slice the 160 bytes back into cryptographic components
            const payloadBuffer = Buffer.from(payloadHex, 'hex');
            
            const pub_key_x = payloadBuffer.subarray(0, 32);
            const pub_key_y = payloadBuffer.subarray(32, 64);
            const signature = payloadBuffer.subarray(64, 128);
            const hashed_student_id = payloadBuffer.subarray(128, 160);

            // Format the buffers into simple arrays for Noir
            const passportData = {
                pub_key_x: bufferToNoirArray(pub_key_x),
                pub_key_y: bufferToNoirArray(pub_key_y),
                signature: bufferToNoirArray(signature),
                hashed_student_id: bufferToNoirArray(hashed_student_id) // MUST match main.nr!
            };

            try {
                // ZK Proof Generation & Verification
                console.log("Generating Zero-Knowledge Proof... (Please wait)");
                const proofData = await generateZkProof(passportData);

                console.log("Verifying mathematical proof...");
                const isValid = await verifyZkProof(proofData);

                if (!isValid) {
                    console.log("ALARM: Invalid cryptographical signature! Fake card detected.");
                    return;
                }

                // Extract the Public Input (Nullifier)
                const nullifier = proofData.publicInputs[proofData.publicInputs.length - 1].toString();
                console.log(`Anonymous Nullifier Generated: ${nullifier}`);

                // Prevent Sybil Attacks (Double-spending the ID)
                const isSaved = await saveProofToDatabase(nullifier);

                if (isSaved) {
                    console.log("ACCESS GRANTED. Welcome to school!");
                } else {
                    console.log("ACCESS DENIED: This student has already entered the building.");
                }

                console.log("\nShutting down terminal...");
                pythonReader.kill(); // Killing the background NFC reading process
                process.exit(0);

            } catch (err) {
                console.error(`Verification circuit failed: ${err.message}`);
            }
        } 
        else if (output.includes('ERROR:')) {
            console.log(`Card read error. Please hold the card steady on the reader.`);
        } 
        else {
            console.log(output); // Print general python logs
        }
    });

    pythonReader.stderr.on('data', (data) => {
        console.error(`Hardware Error: ${data}`);
    });
}

startVerificationTerminal();