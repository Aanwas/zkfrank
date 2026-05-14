import { Barretenberg, UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import { readFile } from 'fs/promises';

async function main(){  
    try{ 
        const circuitData = JSON.parse(
        await readFile('./target/zkfrank.json', 'utf8')
    ); // reading zkfrank.json

    console.log("Activating Barretenberg API...")
    const BarretenbergAPI = await Barretenberg.new()

    const backend = new UltraHonkBackend(circuitData.bytecode, BarretenbergAPI); // getting bytecode from zkfrank.json
    const noir = new Noir(circuitData);  // creating noir

    console.log("The circuit successfully loaded into Node.js!")
    console.log("Bytecode:", circuitData.bytecode.slice(0, 50 ) + "...") // showing small slice of the bytecode
    
    const input_age = { age: 20 }; // initializing our age

    const { witness } = await noir.execute(input_age);  // creating a witness
    console.log("Witness generated successfully")

    const proof = await backend.generateProof(witness); // asking a backend to generate a proof from our witness
    console.log("ZK Proof:", Buffer.from(proof.proof).toString('hex'))


}
    catch (error) {
        console.error("Oh no, something broke :(", error);
    }
}

main()