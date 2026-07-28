use aztec::{protocol::address::AztecAddress, test::helpers::test_environment::TestEnvironment};

use zkfrank_contract::StudentId;

// Must match SECONDS_PER_DAY in the contract.
global SECONDS_PER_DAY: u64 = 86400;

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
    // The contract now lives in a sibling crate, so it is addressed as
    // @crate_name/ContractName rather than by bare name.
    let contract_address =
        env.deploy("@zkfrank_contract/StudentId").with_public_initializer(admin, initializer_call);

    (env, contract_address, admin)
}

// Moves the chain a full day forward and returns the day number the contract
// will compute from the new block timestamp.
//
// TXE block timestamps do not advance on their own, so a test that wants to be
// "on a given day" has to say so. Stepping relative to the last block (rather
// than jumping to a fixed date) keeps this safe: set_next_block_timestamp
// refuses to travel backwards, and calling this twice always lands on two
// genuinely different days.
pub unconstrained fn advance_to_next_day(env: TestEnvironment) -> u64 {
    let timestamp = env.last_block_timestamp() + SECONDS_PER_DAY;
    env.mine_block_at(timestamp);
    timestamp / SECONDS_PER_DAY
}