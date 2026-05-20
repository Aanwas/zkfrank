import { Barretenberg, UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import { readFile } from 'fs/promises';
import sqlite3 from "sqlite3";

import { generateStateKeys, signData } from './keys.js';

function bufferToNoirArray(buffer) {
    return Array.from(buffer);
}

async function main(){  
    try {
        // reading zkfrank.json 
        const circuitData = JSON.parse(
            await readFile('../circuits/target/zkfrank.json', 'utf8')
        ); 

        console.log("Activating Barretenberg API...");
        const BarretenbergAPI = await Barretenberg.new();

        // getting bytecode from zkfrank.json
        const backend = new UltraHonkBackend(circuitData.bytecode, BarretenbergAPI);
        // creating noir
        const noir = new Noir(circuitData); 

        // showing small slice of the bytecode
        console.log("The circuit successfully loaded into Node.js!");
        console.log("Bytecode:", circuitData.bytecode.slice(0, 50 ) + "..."); 
        
        // generate keys and mock data
        const keys = generateStateKeys();

        // TODO: [TEMPORARY SOLUTION]
        // Hardcoded mock SSN is used here for initial circuit testing.
        // Eventually, this will be replaced by dynamic data dynamically read 
        // from a physical NFC chip using the Raspberry Pi Waveshare HAT.
        const mockSSN = "999-88-7777";
        const dataBuffer = Buffer.from(mockSSN, 'utf-8');

        // sign the data
        const privateKeyJwk = {
            kty: 'EC',
            crv: 'P-256',
            d: keys.privateKey.d,
            x: keys.publicKey.x,
            y: keys.publicKey.y
        };
        const signature = signData(privateKeyJwk, dataBuffer);

        // hash ssn for noir
        const { createHash } = await import('crypto');
        const hashed_ssn_buffer = createHash('sha256').update(dataBuffer).digest();

        const user_input_data = {
            pub_key_x: bufferToNoirArray(Buffer.from(keys.publicKey.x, 'base64url')),
            pub_key_y: bufferToNoirArray(Buffer.from(keys.publicKey.y, 'base64url')),
            signature: bufferToNoirArray(signature),
            hashed_ssn: bufferToNoirArray(hashed_ssn_buffer)
        }

        
        // generating a nullifier
        const { witness, returnValue } = await noir.execute(user_input_data);
        const nullifier = returnValue.toString();
        console.log("Our unique nullifier is: ", nullifier);

        // asking a backend to generate a proof from our witness
        const proof = await backend.generateProof(witness); 
        console.log("ZK Proof:", Buffer.from(proof.proof).toString('hex'));
        

        // verifying our proof
        const isValid = await backend.verifyProof(proof); 
        
        if (isValid == true) {
            console.log("The verification is true!");
            
            // connect the database only if a proof is valid
            const db = new sqlite3.Database('../database/proofs.db');
            
            db.serialize(() => {
                // creating a table
                db.run(
                    `CREATE TABLE IF NOT EXISTS validations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        proof_hash TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    )`
                );
                
                // finding if there are duplicates in the database
                db.get("SELECT id FROM validations WHERE proof_hash = ?", [nullifier], (err, row) => {
                    if (err) {
                        console.error("Error while checking for duplicates:", err.message);
                        return;
                    }
                    
                    if (row) {
                        console.log(`Warning! This proof already exists (ID: ${row.id})`);
                    } else {
                        console.log("New unique proof! Saving to database...");
                        db.run(
                            "INSERT INTO validations (proof_hash) VALUES (?)",
                            [nullifier],
                            (insertErr) => {
                                if (insertErr) {
                                    console.error("Error during saving:", insertErr.message);
                                } else {
                                    console.log("Saved successfully!");
                                }
                            }
                        );
                    }
                });
            });
        } else {
            console.log("Verification is false.");
        }

        await BarretenbergAPI.destroy();

    } catch (error) {
        console.error("Oh no, something broke :(", error);
    }
}

main();