import { createHash } from 'crypto';
import * as readline from 'readline';
import { spawn } from 'child_process';
import { generateSchoolKeys, signStudentData } from './crypto/ecdsa.js';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function issueStudentID() {
    console.log("\n=== ZK-Frank: School ID Issuance Terminal ===");

    rl.question('Enter student ID (e.g., SCH-0941-STU-77402): ', (studentID) => {
        if (!studentID.trim()) {
            console.log("Error: ID cannot be empty.");
            rl.close();
            return;
        }

        const { publicKey, privateKey } = generateSchoolKeys(); 
        const hashedStudentId = createHash('sha256').update(studentID).digest();
        const signature = signStudentData(privateKey, studentID);

        const pubXBuffer = Buffer.from(publicKey.x, 'base64url');
        const pubYBuffer = Buffer.from(publicKey.y, 'base64url');
        
        // Assemble 160 bytes
        const fullPayload = Buffer.concat([pubXBuffer, pubYBuffer, signature, hashedStudentId]);
        const hexPayload = fullPayload.toString('hex');

        console.log(`\nCryptographic payload generated.`);
        console.log(`Connecting to Hardware Layer...`);
        
        // Spawn the Python worker and pass the hex string as an argument
        const nfcWriter = spawn('python3', ['-u', 'nfc_writer.py', hexPayload]);

        nfcWriter.stdout.on('data', (data) => {
            process.stdout.write(data.toString());
        });

        nfcWriter.stderr.on('data', (data) => {
            console.error(`Hardware Warning: ${data.toString()}`);
        });

        nfcWriter.on('close', (code) => {
            console.log(`\nIssuance Session Closed.`);
            rl.close();
        });
    });
}

issueStudentID();