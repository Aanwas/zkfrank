import { Barretenberg, UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';

// we need to go up three levels (../../..) to reach the circuits folder
import circuit from '../../../circuits/target/zkfrank.json' with { type: "json" };

// function to generate the zero-knowledge proof
export async function generateZkProof(passportData) {
    console.log("Activating Barretenberg API...");

    // start the Barretenberg engine
    const api = await Barretenberg.new();

    // initialize the backend with the engine attached
    const backend = new UltraHonkBackend(circuit.bytecode, api);

    // creating noir instance with our circuit
    const noir = new Noir(circuit);

    console.log("The circuit successfully loaded into Node.js!");

    console.log("Executing circuit to generate witness...");
    // noir calculates the mathematical trace (witness)
    const { witness } = await noir.execute(passportData);

    console.log("Generating Zero-Knowledge Proof... (this might take a few seconds)");
    // barretenberg uses the trace to create the actual ZK Proof
    const proofData = await backend.generateProof(witness);

    console.log("Proof generated successfully!");

    // return the generated proof so the Verifier can use it
    return proofData;
}