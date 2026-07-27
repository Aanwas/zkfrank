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