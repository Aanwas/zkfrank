use aztec::macros::aztec;

// Private student ID (Phase 1: commitment model).
//
// The university (admin) registers each valid student credential as a
// commitment = poseidon2([student_id, secret]). Only this hash ever touches the
// chain; the raw student id stays off-chain. A student can then privately prove
// they know the (student_id, secret) behind a registered commitment WITHOUT
// revealing the id, and a nullifier makes each credential usable only once.
#[aztec]
pub contract StudentId {
    use aztec::macros::{
        functions::{external, initializer, only_self, view},
        storage::storage,
    };
    use aztec::protocol::{address::AztecAddress, hash::poseidon2_hash};
    use aztec::state_vars::{Map, PublicMutable};

    #[storage]
    struct Storage<Context> {
        // The university/issuer allowed to register and revoke credentials.
        admin: PublicMutable<AztecAddress, Context>,
        // commitment = poseidon2([student_id, secret]) => is it a valid credential?
        valid_credentials: Map<Field, PublicMutable<bool, Context>, Context>,
    }

    // The university deploys the contract and becomes the admin.
    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.write(admin);
    }

    // Admin-only: register a student credential by its commitment.
    // The university computes commitment = poseidon2([student_id, secret])
    // off-chain and publishes only this hash.
    #[external("public")]
    fn issue_credential(commitment: Field) {
        assert(self.storage.admin.read().eq(self.msg_sender()), "Only admin can issue");
        self.storage.valid_credentials.at(commitment).write(true);
    }

    // Admin-only: revoke a previously issued credential.
    #[external("public")]
    fn revoke_credential(commitment: Field) {
        assert(self.storage.admin.read().eq(self.msg_sender()), "Only admin can revoke");
        self.storage.valid_credentials.at(commitment).write(false);
    }

    // Private: a student proves they know (student_id, secret) for a registered
    // credential, without revealing the student id. A nullifier makes each
    // credential usable only once (e.g. one discount per student).
    #[external("private")]
    fn validate(student_id: Field, secret: Field) {
        // Recompute the commitment privately from the secret inputs.
        let commitment = poseidon2_hash([student_id, secret]);

        // One-time use: the network rejects a duplicate nullifier.
        let nullifier = poseidon2_hash([commitment, secret]);
        self.context.push_nullifier(nullifier);

        // Publicly assert the commitment is a valid, non-revoked credential.
        self.enqueue_self.assert_valid(commitment);
    }

    // Public, contract-internal: asserts the commitment is currently valid.
    #[external("public")]
    #[only_self]
    fn assert_valid(commitment: Field) {
        assert(
            self.storage.valid_credentials.at(commitment).read(),
            "Invalid or revoked credential",
        );
    }

    // Public view: check whether a commitment is currently valid.
    #[external("public")]
    #[view]
    fn is_valid(commitment: Field) -> bool {
        self.storage.valid_credentials.at(commitment).read()
    }

    // Local testing helper: compute the commitment the same way the contract does.
    // Meant to be run via `simulate` (never on-chain) — in production the university
    // computes the commitment off-chain, so the raw id/secret never go public.
    #[external("public")]
    #[view]
    fn compute_commitment(student_id: Field, secret: Field) -> Field {
        poseidon2_hash([student_id, secret])
    }
}
