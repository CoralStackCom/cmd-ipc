//! Codegen for `#[payload]` — attach to a plain data struct to auto-derive
//! `Serialize`, `Deserialize`, and `JsonSchema` against the `serde` /
//! `schemars` re-exports from `coralstack-cmd-ipc`.
//!
//! `#[payload]` is the canonical way to declare a request / response type
//! for `#[command]`, so user crates can depend on `coralstack-cmd-ipc`
//! alone without pulling `serde` and `schemars` into their own
//! `Cargo.toml`. It also works for any other shared data shape the user
//! wants `Serialize` / `Deserialize` / `JsonSchema` on — there is nothing
//! command-specific about the macro.
//!
//! ```ignore
//! use coralstack_cmd_ipc::prelude::*;
//!
//! #[payload]
//! struct AddReq { a: i64, b: i64 }
//! ```

use proc_macro2::{Span, TokenStream};
use quote::quote;
use syn::ItemStruct;

pub fn expand(attr: TokenStream, item: TokenStream) -> syn::Result<TokenStream> {
    if !attr.is_empty() {
        return Err(syn::Error::new(
            Span::call_site(),
            "#[payload] takes no arguments",
        ));
    }
    let item_struct: ItemStruct = syn::parse2(item)?;

    Ok(quote! {
        #[derive(
            ::coralstack_cmd_ipc::serde::Serialize,
            ::coralstack_cmd_ipc::serde::Deserialize,
            ::coralstack_cmd_ipc::schemars::JsonSchema,
        )]
        #[serde(crate = "::coralstack_cmd_ipc::serde")]
        #[schemars(crate = "::coralstack_cmd_ipc::schemars")]
        #item_struct
    })
}
