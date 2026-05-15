import { Barretenberg, UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import { readFile } from 'fs/promises';
import sqlite3 from "sqlite3";
import crypto, { createHash } from 'crypto';

async function main(){  
    try{
        // reading zkfrank.json 
        const circuitData = JSON.parse(
        await readFile('../circuits/target/zkfrank.json', 'utf8')
    ); 

    console.log("Activating Barretenberg API...")
    const BarretenbergAPI = await Barretenberg.new()

    // getting bytecode from zkfrank.json
    const backend = new UltraHonkBackend(circuitData.bytecode, BarretenbergAPI);
    // creating noir
    const noir = new Noir(circuitData); 

    // showing small slice of the bytecode
    console.log("The circuit successfully loaded into Node.js!")
    console.log("Bytecode:", circuitData.bytecode.slice(0, 50 ) + "...") 
    
    // initializing our age
    const user_input_data = JSON.parse(
        await readFile('../user_data.json', 'utf-8')
    );

    // creating a witness
    const { witness } = await noir.execute(user_input_data);
    console.log("Witness generated successfully")

    // asking a backend to generate a proof from our witness
    const proof = await backend.generateProof(witness); 
    console.log("ZK Proof:", Buffer.from(proof.proof).toString('hex'))

    // creating hash of our age
    const proof_hash = createHash('sha256')
    .update(Buffer.from(proof.proof))
    .digest('hex')

    console.log("Hash of the proof:", proof_hash)

    // adding hash of the proof to a database
    const db = new sqlite3.Database('../database/proofs.db')
    db.run(
        `CREATE TABLE IF NOT EXISTS validations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            proof_hash TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
    )

    // verifying our proof
    const isValid = await backend.verifyProof(proof); 
    if (isValid == true){
        console.log("The verification is true!");
        db.run("INSERT INTO validations (proof_hash) VALUES (?)", [proof_hash])
    }
    else{
        console.log("Verefication is false.");
    }

    await BarretenbergAPI.destroy()

}

    catch (error) {
        console.error("Oh no, something broke :(", error);
    }
}

main()