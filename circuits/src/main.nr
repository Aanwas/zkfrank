fn main(age: u32, secret: Field) -> pub Field {
    assert(age > 18);
    let secret_hash = std::hash::pedersen_hash([secret]);
    secret_hash
}