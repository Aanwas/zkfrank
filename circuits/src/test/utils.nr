use aztec::{protocol::address::AztecAddress, test::helpers::test_environment::TestEnvironment};

use crate::StudentId;

// Shared setup for every test: boot the fake network, create the university
// account, and deploy StudentId with that account as admin.
//
// Returns (env, contract_address, admin) so each test can keep driving the
// same deployed contract.
pub unconstrained fn setup() -> (TestEnvironment, AztecAddress, AztecAddress) {
    // The fake local Aztec network. `mut` because deploying mutates its
    // internal salt/secret counters.
    let mut env = TestEnvironment::new();

    // An address that can send transactions. "Light" = no account contract,
    // which is all we need since we never use authwits.
    let admin = env.create_light_account();

    // Describes the call WITHOUT executing it: which function, which args.
    // `interface()` is generated for us by the #[aztec] macro.
    let initializer_call = StudentId::interface().constructor(admin);

    // Deploys the compiled contract and runs the constructor as `admin`,
    // so admin ends up stored as the admin in public storage.
    let contract_address =
        env.deploy("StudentId").with_public_initializer(admin, initializer_call);

    (env, contract_address, admin)
}