import { writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import { generateStateKeys, signData } from './crypto/ecdsa.js';
import { bufferToNoirArray } from './utils/formats.js';

async function issueID() {
    // define mock user data
    // security warning, only used for debugging purposes
    const mockSSN = "999-88-7777";
    
    // generate state keys (extracting the returned object)
    const { publicKey, privateKey } = generateStateKeys(); 
    
    // hashing ssn using sha-256 to create a unique hash of the user's data
    const hashedSsn = createHash('sha256').update(mockSSN).digest();
    
    // passing the private key and the original ssn string to our custom function
    const signature = signData(privateKey, mockSSN);

    // pack the data 
    const passportData = {
        // jwk public keys are in base64url format, so we convert them to buffers first
        pub_key_x: bufferToNoirArray(Buffer.from(publicKey.x, 'base64url')),
        pub_key_y: bufferToNoirArray(Buffer.from(publicKey.y, 'base64url')),
        signature: bufferToNoirArray(signature),
        hashed_ssn: bufferToNoirArray(hashedSsn)
    };

    // save the chip to our local file directory AFTER data is packed
    // We use '../nfc_passport.json' to save it in the main backend folder
    await writeFile('../nfc_passport.json', JSON.stringify(passportData, null, 2));
    
    console.log("ID successfully saved to nfc_passport.json!");
}

issueID();