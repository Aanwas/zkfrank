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
use crate::test::utils;
use crate::StudentId;

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

    // The student submits the RAW id and secret in private execution. They never
    // reach public state - the contract only recomputes the hash from them.
    // call_private also runs the public call that validate() enqueues
    // (assert_valid), so this single line exercises the full chain.
    env.call_private(student, StudentId::at(contract_address).validate(1001, 42));

    // No assert: if the proof or the public check had failed, this would revert.
}

// The single most important test in the file: the commitment must actually bind
// the secret. Only the secret differs from the issued credential (42 -> 99), so
// the contract computes poseidon2([1001, 99]), a completely different value that
// was never registered - and assert_valid rejects it.
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
    env.call_private(student, StudentId::at(contract_address).validate(1001, 99));
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

    // Correct id and secret, but the credential is no longer registered.
    env.call_private(student, StudentId::at(contract_address).validate(1001, 42));
}

// One credential, one use. validate() pushes a nullifier derived from the
// commitment and the secret; the network refuses a nullifier it has already
// seen, so the second attempt must revert.
//
// The full message ends with the nullifier value itself; we match only the
// stable prefix, since that hash changes with the id and secret used here.
#[test(should_fail_with = "Attempted to emit duplicate siloed nullifier")]
unconstrained fn credential_cannot_be_used_twice() {
    let (mut env, contract_address, admin) = utils::setup();

    let student = env.create_light_account();

    let commitment =
        env.view_public(StudentId::at(contract_address).compute_commitment(1001, 42));
    env.call_public(admin, StudentId::at(contract_address).issue_credential(commitment));

    // First use: legitimate, must succeed.
    env.call_private(student, StudentId::at(contract_address).validate(1001, 42));

    // Second use of the same credential: the nullifier is already spent.
    env.call_private(student, StudentId::at(contract_address).validate(1001, 42));
}