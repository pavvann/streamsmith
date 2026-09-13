fn main() {
    // Proto bindings live in src/pb and are produced by `substreams protogen` (checked in), not here.
    substreams_ethereum::Abigen::new("erc4626", "abi/erc4626.json")
        .expect("failed to load abi/erc4626.json")
        .generate()
        .expect("failed to generate bindings")
        .write_to_file("src/abi/erc4626.rs")
        .expect("failed to write src/abi/erc4626.rs");
}
