// index.js
import { spawn } from 'child_process';

console.log('=== [zkFrank] NFC Bridge Service Initialized ===');
console.log('Monitoring hardware layer via unbuffered Python stream...');

// Start the Python hardware bridge with the unbuffered flag (-u)
const nfcBridgeProcess = spawn('python3', ['-u', 'nfc_reader.py']);

nfcBridgeProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    
    for (let line of lines) {
        line = line.trim();
        if (line.startsWith('UID:')) {
            const cardUid = line.split(':')[1];
            console.log(`\n💳 [NFC Event] Card Detected! UID: ${cardUid}`);
            
            // Trigger the ZK-proof generation workflow
            handleCardAuthentication(cardUid);
        }
    }
});

/**
 * Handles the business logic once a valid NFC UID is scanned.
 * @param {string} uid - The Hex-encoded unique identifier of the NFC card/tag.
 */
function handleCardAuthentication(uid) {
    console.log(`[ZK-Workflow] Initiating cryptographic proof generation for UID: ${uid}`);
    // TODO: Step 1. Fetch user credentials associated with this UID from the secure local context.
    // TODO: Step 2. Format inputs (pub_key, signature, hashed_ssn) for the Noir circuit.
    // TODO: Step 3. Execute 'nargo prove' to generate the Zero-Knowledge Proof.
}

// Handle unexpected hardware or system errors
nfcBridgeProcess.stderr.on('data', (data) => {
    console.error(`[Hardware Error] Python Bridge stderr: ${data.toString()}`);
});

nfcBridgeProcess.on('error', (err) => {
    console.error(`[Critical] Failed to spin up the Python background worker: ${err.message}`);
});