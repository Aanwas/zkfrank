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
    use aztec::protocol::{address::AztecAddress, hash::poseidon2_hash, traits::Packable};
    use aztec::state_vars::{Map, PublicImmutable, PublicMutable};

    // A "day" is the unix timestamp divided by this, so it is just a day number
    // counted from 1970. Days are UTC, which is fine for a discount window.
    global SECONDS_PER_DAY: u64 = 86400;

    // The college's secp256r1 public key, against which every card signature is
    // checked. It lives in the contract rather than on the card on purpose: a
    // card carrying its own key could be handed a forged signature together with
    // the matching key and would verify happily.
    //
    // x and y are kept together in one struct because reading a PublicImmutable
    // privately costs a historical storage read regardless of the value's size -
    // two separate fields would mean paying that twice.
    #[derive(Eq)]
    pub struct CollegePublicKey {
        pub x: [u8; 32],
        pub y: [u8; 32],
    }

    // A 32-byte coordinate does not fit in one Field: BN254 is ~254 bits wide and
    // 32 bytes is 256. Each coordinate is therefore split into its first 31 bytes
    // and its last byte, giving four Fields in total. Same approach as
    // EcdsaPublicKeyNote in aztec-packages.
    impl Packable for CollegePublicKey {
        let N: u32 = 4;

        fn pack(self) -> [Field; Self::N] {
            let mut x: Field = 0;
            let mut y: Field = 0;
            let mut mul: Field = 1;

            for i in 1..32 {
                x = x + ((self.x[31 - i] as Field) * mul);
                y = y + ((self.y[31 - i] as Field) * mul);
                mul *= 256;
            }

            [x, self.x[31] as Field, y, self.y[31] as Field]
        }

        fn unpack(packed: [Field; Self::N]) -> Self {
            let mut x: [u8; 32] = [0; 32];
            let mut y: [u8; 32] = [0; 32];

            let part_x: [u8; 32] = packed[0].to_be_bytes();
            let part_y: [u8; 32] = packed[2].to_be_bytes();
            for i in 0..31 {
                x[i] = part_x[i + 1];
                y[i] = part_y[i + 1];
            }
            x[31] = packed[1].to_be_bytes::<32>()[31];
            y[31] = packed[3].to_be_bytes::<32>()[31];

            Self { x, y }
        }
    }

    #[storage]
    struct Storage<Context> {
        // The university/issuer allowed to register and revoke credentials.
        admin: PublicMutable<AztecAddress, Context>,
        // commitment = poseidon2([student_id, secret]) => is it a valid credential?
        valid_credentials: Map<Field, PublicMutable<bool, Context>, Context>,
        // PublicImmutable rather than PublicMutable: it is the only public state
        // variable a private function may read, and validate() has to check the
        // signature privately. Verifying it publicly would put the signature on
        // chain, which would let anyone replay a card they once observed.
        college_public_key: PublicImmutable<CollegePublicKey, Context>,
    }

    // The university deploys the contract, becomes the admin, and pins the public
    // key its issuing machine will sign cards with.
    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress, college_public_key_x: [u8; 32], college_public_key_y: [u8; 32]) {
        self.storage.admin.write(admin);
        self.storage.college_public_key.initialize(CollegePublicKey {
            x: college_public_key_x,
            y: college_public_key_y,
        });
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
    fn validate(student_id: Field, secret: Field, signature: [u8; 64], day: u64) {
        // Recompute the commitment privately from the secret inputs.
        let commitment = poseidon2_hash([student_id, secret]);

        // The card carries a college signature over this commitment. Checking it
        // here is what lets a third party - a library, say - trust the card
        // without holding the college's registry: the proof itself attests that
        // the college signed. Everything below stays inside the private circuit,
        // so neither the signature nor the commitment ever becomes public.
        let college_public_key = self.storage.college_public_key.read();

        // The annotation on the left is what fixes the width at 32 bytes.
        let commitment_bytes: [u8; 32] = commitment.to_be_bytes();

        // The issuer signed with createSign('SHA256'), which hashes the message
        // itself; verify_signature hashes nothing and wants the digest ready.
        let message_hash: [u8; 32] = sha256::digest(commitment_bytes);

        assert(
            std::ecdsa_secp256r1::verify_signature(
                college_public_key.x,
                college_public_key.y,
                signature,
                message_hash,
            ),
            "Invalid college signature",
        );

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
