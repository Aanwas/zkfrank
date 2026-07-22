use aztec::macros::aztec;

#[aztec]
pub contract HelloWorld {
    use aztec::macros::functions::{external, initializer};

    #[initializer]
    #[external("private")]
    fn constructor() {}

    #[external("utility")]
    unconstrained fn get_greeting() -> Field {
        42
    }

}