use std::env;
use std::path::PathBuf;

fn main() {
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR not set by cargo"));
    println!("cargo:rerun-if-changed=abi/vault.json");
    substreams_ethereum::Abigen::new("Vault", "abi/vault.json")
        .expect("failed to load abi/vault.json")
        .generate()
        .expect("failed to generate vault bindings")
        .write_to_file(out_dir.join("vault_abi.rs"))
        .expect("failed to write vault bindings");
}
