use aztec::macros::aztec;

// Private student ID (Phase 1: commitment model).
//
// The university (admin) registers each valid student credential as a
// commitment = poseidon2([student_id, secret]). Only this hash ever touches the
// chain; the raw student id stays off-chain. A student can then privately prove
// they know the (student_id, secret) behind a registered commitment WITHOUT
// revealing the id.
//
// Target use case: a student claims a discount at a library terminal without
// showing who they are. The nullifier therefore covers one day, so the discount
// can be claimed once per day rather than once ever.
#[aztec]
pub contract StudentId {
    use aztec::macros::{
        functions::{external, initializer, only_self, view},
        storage::storage,
    };
    use aztec::protocol::{address::AztecAddress, hash::poseidon2_hash};
    use aztec::state_vars::{Map, PublicMutable};

    // A "day" is the unix timestamp divided by this, so it is just a day number
    // counted from 1970. Days are UTC, which is fine for a discount window.
    global SECONDS_PER_DAY: u64 = 86400;

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
    // credential, without revealing the student id. `day` scopes the nullifier,
    // so the credential is spendable once per day.
    #[external("private")]
    fn validate(student_id: Field, secret: Field, day: u64) {
        // Recompute the commitment privately from the secret inputs.
        let commitment = poseidon2_hash([student_id, secret]);

        // One use per day: the network rejects a duplicate nullifier. `day` is
        // part of the hash, so tomorrow yields a different nullifier and the
        // student can claim again. assert_valid_today below pins `day` to the
        // real block time - otherwise a student could mint unlimited uses just
        // by passing a different number here.
        let nullifier = poseidon2_hash([commitment, secret, day as Field]);
        self.context.push_nullifier(nullifier);

        // Publicly assert the commitment is valid and that `day` is really today.
        self.enqueue_self.assert_valid_today(commitment, day);
    }

    // Public, contract-internal: asserts the commitment is currently valid and
    // that the claimed day matches the block timestamp.
    #[external("public")]
    #[only_self]
    fn assert_valid_today(commitment: Field, day: u64) {
        assert(
            self.storage.valid_credentials.at(commitment).read(),
            "Invalid or revoked credential",
        );
        // Only the public side can see the clock, which is why the day is
        // checked here rather than inside the private function.
        assert(day == self.context.timestamp() / SECONDS_PER_DAY, "Wrong day");
    }

    // Public view: the day number the contract is currently on. A terminal calls
    // this before building a proof, so it passes the day the chain agrees with
    // rather than the day its own clock believes in.
    #[external("public")]
    #[view]
    fn current_day() -> u64 {
        self.context.timestamp() / SECONDS_PER_DAY
    }

    // Public view: check whether a commitment is currently valid.
    #[external("public")]
    #[view]
    fn is_valid(commitment: Field) -> bool {
        self.storage.valid_credentials.at(commitment).read()
    }

    // Local testing helper: compute the commitment the same way the contract does.
    // Meant to be run via `simulate` (never on-chain) - in production the university
    // computes the commitment off-chain, so the raw id/secret never go public.
    #[external("public")]
    #[view]
    fn compute_commitment(student_id: Field, secret: Field) -> Field {
        poseidon2_hash([student_id, secret])
    }
}
