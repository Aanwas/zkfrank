import { generateKeyPairSync, createSign, createPrivateKey } from 'crypto';

function generateStateKeys() {
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
        namedCurve: 'prime256v1', // the secp256r1 curve supported by Noir
        // use JWK format to easily extract X and Y coordinates
        publicKeyEncoding: { type: 'spki', format: 'jwk' },
        privateKeyEncoding: { type: 'pkcs8', format: 'jwk' }
    });

    console.log("=== STATE KEYS GENERATED ===");
    console.log("Pub X:", publicKey.x);
    console.log("Pub Y:", publicKey.y);

    // SECURITY WARNING: [TEMPORARY SOLUTION]
    // Logging the private key to the console is strictly for developmental 
    // debugging and prototype verification. In a production environment, 
    // the Issuer's private key must be generated and stored securely (e.g., in an HSM) 
    // and never exposed to standard output.
    console.log("Priv D:", privateKey.d);

    return { publicKey, privateKey };
}

// half order of secp256r1 curve
const SECP256R1_HALF_ORDER = 57896044605178124381348723474703786764998477612067880171211129530534256022184n;
// create a raw ECDSA signature from the State (issuer)
function signData(privateKeyJwk, dataString) {
    // reconstruct the private key object for the crypto module
    const pKey = createPrivateKey({
        key: privateKeyJwk,
        format: 'jwk',
        type: 'pkcs8',
        namedCurve: 'prime256v1'
    });

    while (true){
        // hash the data using SHA-256 and sign it
        const sign = createSign('SHA256');
        sign.update(dataString);
        sign.end();

        const signature = sign.sign({
            key: pKey,
            dsaEncoding: 'ieee-p1363'
        });
        // cutting off 32 bytes (S)
        const sBuffer = signature.subarray(32, 64);
        // converting bytes into a big integer
        const sBigInt = BigInt('0x' + sBuffer.toString('hex'));

        // if S is small we are returning signature
        if(sBigInt <= SECP256R1_HALF_ORDER){
            return signature;
        }
    }
}

// export functions using modern ES syntax
export {
    generateStateKeys,
    signData
};

