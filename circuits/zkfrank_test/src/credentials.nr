// Tests for the credential lifecycle: issuing, revoking, and who is allowed
// to do either. Every test runs against a fresh contract deployed by
// utils::setup(), so they cannot influence each other.
//
// Reminder on the three call styles used below:
//   env.view_public(call)        - read-only, returns a value, no transaction
//   env.call_public(from, call)  - real public transaction sent by `from`
//   env.call_private(from, call) - private execution + any enqueued public calls
// The target address is not passed to these methods; it lives inside the call
// itself, built with StudentId::at(contract_address).
use crate::fixture::{IMPOSTOR_SIGNATURE, VALID_SIGNATURE, WRONG_SECRET_SIGNATURE};
use crate::utils;
use zkfrank_contract::StudentId;

// The happy path: a credential the admin has issued reads back as valid.
#[test]
unconstrained fn issued_credential_is_valid() {
    let (env, contract_address, admin) = utils::setup();

    // Ask the contract to hash (student_id=1001, secret=42) for us, so the test
    // uses exactly the same commitment the contract would compute internally.
    // This is a #[view] function, so it costs nothing and changes no state.
    let commitment =
        env.view_public(StudentId::at(contract_address).compute_commitment(1001, 42));

    // The university issues it. Sent by `admin`, so the admin check passes.
    env.call_public(admin, StudentId::at(contract_address).issue_credential(commitment));

    // Read it back: the commitment must now be marked valid in public storage.
    let valid = env.view_public(StudentId::at(contract_address).is_valid(commitment));
    assert(valid);
}

// Only the university may issue credentials. If anyone could call
// issue_credential, they would mint themselves a valid student id - so this
// test guards the single most important access rule in the contract.
//
// The expected string must be a substring of the assert message in main.nr.
// The test PASSES only if the call fails with it; if the call were to succeed,
// the test fails.
#[test(should_fail_with = "Only admin can issue")]
unconstrained fn non_admin_cannot_issue() {
    // `mut` is required because create_light_account() mutates the environment.
    // The admin is discarded with `_` - this test deliberately never uses it.
    let (mut env, contract_address, _) = utils::setup();

    // Alice is an ordinary user, not the university.
    let alice = env.create_light_account();

    let commitment =
        env.view_public(StudentId::at(contract_address).compute_commitment(1001, 42));

    // The first argument of call_public is the sender. Passing `alice` here is
    // the whole point of the test: the admin check inside issue_credential
    // compares self.msg_sender() against the stored admin, so this must revert.
    env.call_public(alice, StudentId::at(contract_address).issue_credential(commitment));

    // No assert below - the revert IS the assertion.
}

// Revocation actually takes effect: once the university revokes a credential,
// it must stop reading as valid. This is how a student who graduated or lost
// their card gets cut off.
//
// Note the order of steps: we must issue FIRST, otherwise the final assert
// would pass trivially - an unknown commitment is false anyway, and the test
// would prove nothing about revoke_credential.
#[test]
unconstrained fn revoked_credential_is_not_valid() {
    let (env, contract_address, admin) = utils::setup();

    let commitment =
        env.view_public(StudentId::at(contract_address).compute_commitment(1001, 42));

    // Issue, so there is something real to revoke.
    env.call_public(admin, StudentId::at(contract_address).issue_credential(commitment));

    // Now take it back.
    env.call_public(admin, StudentId::at(contract_address).revoke_credential(commitment));

    // `!` is logical NOT: we expect the credential to be invalid now.
    let valid = env.view_public(StudentId::at(contract_address).is_valid(commitment));
    assert(!valid);
}

// The mirror image of non_admin_cannot_issue: a stranger must not be able to
// revoke someone else's credential. Without this rule anyone could disable
// any student at will.
#[test(should_fail_with = "Only admin can revoke")]
unconstrained fn non_admin_cannot_revoke() {
    let (mut env, contract_address, admin) = utils::setup();

    let alice = env.create_light_account();

    let commitment =
        env.view_public(StudentId::at(contract_address).compute_commitment(1001, 42));

    // A genuine credential, issued properly by the university.
    env.call_public(admin, StudentId::at(contract_address).issue_credential(commitment));

    // Alice tries to revoke it. She is not the admin, so this must revert
    // and the test passes because of that revert.
    env.call_public(alice, StudentId::at(contract_address).revoke_credential(commitment));
}

// The core happy path of the whole contract: a student proves knowledge of the
// (student_id, secret) behind a registered commitment, without revealing them.
#[test]
unconstrained fn student_can_validate_issued_credential() {
    let (mut env, contract_address, admin) = utils::setup();

    // A separate account: the proof is produced by the student, not the admin.
    let student = env.create_light_account();

    let commitment =
        env.view_public(StudentId::at(contract_address).compute_commitment(1001, 42));
    env.call_public(admin, StudentId::at(contract_address).issue_credential(commitment));

    // Pin the chain to a known day, since the contract now checks that the day
    // passed in really is today.
    let day = utils::advance_to_next_day(env);

    // The student submits the RAW id and secret in private execution, together
    // with the college signature read off their card. None of it reaches public
    // state - the contract recomputes the hash and checks the signature inside
    // the circuit. call_private also runs the public call that validate()
    // enqueues (assert_valid_today), so this single line exercises the full chain.
    env.call_private(
        student,
        StudentId::at(contract_address).validate(1001, 42, VALID_SIGNATURE, day),
    );

    // No assert: if the proof or the public check had failed, this would revert.
}

// The discount is claimable again tomorrow. This is the test that pins down the
// use case: the nullifier covers a day, not the whole life of the card, so a
// student can come back to the library the next day.
#[test]
unconstrained fn credential_can_be_used_again_next_day() {
    let (mut env, contract_address, admin) = utils::setup();

    let student = env.create_light_account();

    let commitment =
        env.view_public(StudentId::at(contract_address).compute_commitment(1001, 42));
    env.call_public(admin, StudentId::at(contract_address).issue_credential(commitment));

    let today = utils::advance_to_next_day(env);
    env.call_private(
        student,
        StudentId::at(contract_address).validate(1001, 42, VALID_SIGNATURE, today),
    );

    // Same card, same secret, same signature, next day: the day is part of the
    // nullifier, so this is a different nullifier and the network accepts it.
    let tomorrow = utils::advance_to_next_day(env);
    env.call_private(
        student,
        StudentId::at(contract_address).validate(1001, 42, VALID_SIGNATURE, tomorrow),
    );
}

// A student must not be able to mint extra uses by simply claiming a different
// day. Without the timestamp check in assert_valid_today, passing tomorrow's
// number would produce a fresh nullifier and the daily limit would be worthless.
#[test(should_fail_with = "Wrong day")]
unconstrained fn validate_fails_with_wrong_day() {
    let (mut env, contract_address, admin) = utils::setup();

    let student = env.create_light_account();

    let commitment =
        env.view_public(StudentId::at(contract_address).compute_commitment(1001, 42));
    env.call_public(admin, StudentId::at(contract_address).issue_credential(commitment));

    let today = utils::advance_to_next_day(env);

    // The chain is on `today`, but the student claims it is already tomorrow.
    // The signature is genuine, so the private half passes and the revert comes
    // from the public day check.
    env.call_private(
        student,
        StudentId::at(contract_address).validate(1001, 42, VALID_SIGNATURE, today + 1),
    );
}

// The commitment must actually bind the secret. Only the secret differs from the
// issued credential (42 -> 99), so the contract computes poseidon2([1001, 99]), a
// completely different value that was never registered - and assert_valid rejects
// it.
//
// The signature here is the college's over poseidon2([1001, 99]): a commitment it
// would happily sign but never issued. That is deliberate - it lets the call get
// past the signature check so this test still exercises the registry, which is
// what it was written for. The realistic attack, where the student presents the
// signature from their own card, is covered by
// validate_fails_with_signature_over_another_commitment below.
//
// If this test ever passes without reverting, the scheme is broken: anyone
// knowing just a student id could impersonate that student.
#[test(should_fail_with = "Invalid or revoked credential")]
unconstrained fn validate_fails_with_wrong_secret() {
    let (mut env, contract_address, admin) = utils::setup();

    let student = env.create_light_account();

    // The credential the university actually issued.
    let commitment =
        env.view_public(StudentId::at(contract_address).compute_commitment(1001, 42));
    env.call_public(admin, StudentId::at(contract_address).issue_credential(commitment));

    // Right id, wrong secret.
    let day = utils::advance_to_next_day(env);
    env.call_private(
        student,
        StudentId::at(contract_address).validate(1001, 99, WRONG_SECRET_SIGNATURE, day),
    );
}

// Revocation must hold against the private path too, not just the is_valid
// view. Otherwise a graduated student could keep proving they are enrolled.
#[test(should_fail_with = "Invalid or revoked credential")]
unconstrained fn student_cannot_validate_revoked_credential() {
    let (mut env, contract_address, admin) = utils::setup();

    let student = env.create_light_account();

    let commitment =
        env.view_public(StudentId::at(contract_address).compute_commitment(1001, 42));

    // Issue, then take it back.
    env.call_public(admin, StudentId::at(contract_address).issue_credential(commitment));
    env.call_public(admin, StudentId::at(contract_address).revoke_credential(commitment));

    // Correct id, secret and signature, but the credential is no longer
    // registered. Revocation is a registry fact, so the card itself stays
    // perfectly valid-looking - the signature on it can never be taken back.
    let day = utils::advance_to_next_day(env);
    env.call_private(
        student,
        StudentId::at(contract_address).validate(1001, 42, VALID_SIGNATURE, day),
    );
}

// One credential, one use PER DAY. validate() pushes a nullifier derived from
// the commitment, the secret and the day; the network refuses a nullifier it has
// already seen, so a second attempt on the same day must revert.
//
// The full message ends with the nullifier value itself; we match only the
// stable prefix, since that hash changes with the id and secret used here.
#[test(should_fail_with = "Attempted to emit duplicate siloed nullifier")]
unconstrained fn credential_cannot_be_used_twice_in_one_day() {
    let (mut env, contract_address, admin) = utils::setup();

    let student = env.create_light_account();

    let commitment =
        env.view_public(StudentId::at(contract_address).compute_commitment(1001, 42));
    env.call_public(admin, StudentId::at(contract_address).issue_credential(commitment));

    let day = utils::advance_to_next_day(env);

    // First use: legitimate, must succeed.
    env.call_private(
        student,
        StudentId::at(contract_address).validate(1001, 42, VALID_SIGNATURE, day),
    );

    // Second use on the SAME day: the nullifier is already spent.
    env.call_private(
        student,
        StudentId::at(contract_address).validate(1001, 42, VALID_SIGNATURE, day),
    );
}

// A signature from an issuer the contract does not trust must be rejected, even
// though it is a perfectly well-formed ECDSA signature over the right commitment.
// This is what stops anyone from minting their own "college": the trust anchor is
// the key baked into the contract at deployment, not the signature's shape.
#[test(should_fail_with = "Invalid college signature")]
unconstrained fn validate_fails_with_a_foreign_issuer_signature() {
    let (mut env, contract_address, admin) = utils::setup();

    let student = env.create_light_account();

    let commitment =
        env.view_public(StudentId::at(contract_address).compute_commitment(1001, 42));
    env.call_public(admin, StudentId::at(contract_address).issue_credential(commitment));

    let day = utils::advance_to_next_day(env);

    // Everything about this call is genuine except who signed the card.
    env.call_private(
        student,
        StudentId::at(contract_address).validate(1001, 42, IMPOSTOR_SIGNATURE, day),
    );
}

// The realistic version of validate_fails_with_wrong_secret: a student presents
// the signature from their OWN card while claiming a different secret. The
// signature covers poseidon2([1001, 42]), the contract recomputes
// poseidon2([1001, 99]), and the two do not match - so this never even reaches
// the registry check.
#[test(should_fail_with = "Invalid college signature")]
unconstrained fn validate_fails_with_signature_over_another_commitment() {
    let (mut env, contract_address, admin) = utils::setup();

    let student = env.create_light_account();

    let commitment =
        env.view_public(StudentId::at(contract_address).compute_commitment(1001, 42));
    env.call_public(admin, StudentId::at(contract_address).issue_credential(commitment));

    let day = utils::advance_to_next_day(env);

    // The signature is the college's own, taken off this student's real card -
    // it just covers a different commitment than the one secret 99 produces.
    env.call_private(
        student,
        StudentId::at(contract_address).validate(1001, 99, VALID_SIGNATURE, day),
    );
}