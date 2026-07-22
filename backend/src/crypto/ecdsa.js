import { generateKeyPairSync, createSign, createPrivateKey } from 'crypto';

// half order of secp256r1 curve
const SECP256R1_HALF_ORDER = 57896044605178124381348723474703786764998477612067880171211129530534256022184n;

// generating cryptographic keys from school administration
export function generateSchoolKeys(){
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
        publicKeyEncoding: { type: 'spki', format: 'jwk' },
        privateKeyEncoding: { type: 'pkcs8', format: 'jwk' }
    });

    console.log("=== SCHOOL ADMINISTRATION KEYS GENERATED ===")
    console.log("School Pub X Ready");
    console.log("School Pub Y Ready");

    return { publicKey, privateKey };
}


// creating signature for student ID
export function signStudentData(privateKeyJwk, dataString) {
    const pKey = createPrivateKey({
        key: privateKeyJwk,
        format: 'jwk',
        type: 'pkcs8',
        namedCurve: 'prime256v1'
    });

    // Low-S attack protection
    while (true) {
        const sign = createSign('SHA256');
        sign.update(dataString);
        sign.end();

        const signature = sign.sign({
            key: pKey,
            dsaEncoding: 'ieee-p1363'
        });
        
        const sBuffer = signature.subarray(32, 64);
        const sBigInt = BigInt('0x' + sBuffer.toString('hex'));

        if(sBigInt <= SECP256R1_HALF_ORDER){
            return signature;
        }
    }
}