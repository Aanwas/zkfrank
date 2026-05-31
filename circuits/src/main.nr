// main.nr
use std;

/**
 * @notice zkFrank Core Circuit
 * @dev Verifies that a user possesses a valid ECDSA signature over their identifier
 * without revealing the identifier or the signature on-chain.
 * @param pub_key_x Public key X-coordinate (Uncompressed secp256r1) - Public Input
 * @param pub_key_y Public key Y-coordinate (Uncompressed secp256r1) - Public Input
 * @param signature The 64-byte ECDSA signature over the hashed data - Private Input
 * @param hashed_student_id Hash of the identity token (e.g., NFC UID) - Private Input
 * @return Field A unique nullifier to prevent double-spending / identity reuse attacks
 */
fn main(
    pub_key_x: pub [u8; 32], 
    pub_key_y: pub [u8; 32], 
    signature: [u8; 64], 
    hashed_student_id: [u8; 32]
) -> pub Field {
    
    // Verify the ECDSA signature over the secp256r1 curve
    let is_valid = std::ecdsa_secp256r1::verify_signature(
        pub_key_x, 
        pub_key_y, 
        signature, 
        hashed_student_id
    );

    // Enforce constraint: Circuit execution fails if the signature is invalid
    assert(is_valid == true);

    // Generate a true cryptographic Nullifier
    // Safely convert each 8-bit byte into a ZK Field to avoid 254-bit overflow
    let mut student_id_fields: [Field; 32] = [0; 32];
    for i in 0..32 {
        student_id_fields[i] = hashed_student_id[i] as Field;
    }

    // Apply standard Pedersen hash (built into vanilla Noir) to create the nullifier
    let nullifier = std::hash::pedersen_hash(student_id_fields);

    nullifier
}