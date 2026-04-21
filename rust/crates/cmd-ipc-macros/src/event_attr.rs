//! Codegen for `#[event("id")] struct Payload`.
//!
//! Attached to a payload struct (which must also derive `Serialize`,
//! `Deserialize`, and `JsonSchema`). Emits an `impl Event for Payload`
//! with the id and a `schema()` override that returns the
//! schemars-derived schema.

use proc_macro2::{Span, TokenStream};
use quote::quote;
use syn::parse::{Parse, ParseStream};
use syn::{ItemStruct, LitStr};

/// `#[event("id")]` — takes exactly one string literal, no other
/// arguments. Events live or die by the payload struct itself, so
/// descriptions / other metadata belong on the struct's rustdoc, not
/// on the attribute.
struct EventAttrArgs {
    id: LitStr,
}

impl Parse for EventAttrArgs {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let id: LitStr = input.parse().map_err(|_| {
            syn::Error::new(
                input.span(),
                "expected event id as string literal, e.g. `#[event(\"worker.ready\")]`",
            )
        })?;
        if !input.is_empty() {
            return Err(syn::Error::new(
                input.span(),
                "#[event] takes a single string literal id and nothing else",
            ));
        }
        Ok(Self { id })
    }
}

pub fn expand(attr: TokenStream, item: TokenStream) -> syn::Result<TokenStream> {
    let args: EventAttrArgs = if attr.is_empty() {
        return Err(syn::Error::new(
            Span::call_site(),
            "#[event] requires an id, e.g. `#[event(\"worker.ready\")]`",
        ));
    } else {
        syn::parse2(attr)?
    };
    let item_struct: ItemStruct = syn::parse2(item)?;

    let struct_ident = &item_struct.ident;
    let id_lit = &args.id;
    let cmd_ipc = cmd_ipc_path();

    Ok(quote! {
        #item_struct

        impl #cmd_ipc::Event for #struct_ident {
            const ID: &'static str = #id_lit;

            fn schema(&self) -> ::core::option::Option<#cmd_ipc::serde_json::Value> {
                ::core::option::Option::Some(
                    #cmd_ipc::normalize_schema(
                        #cmd_ipc::serde_json::to_value(
                            #cmd_ipc::schemars::schema_for!(#struct_ident)
                        ).expect("event schema should serialize"),
                    ),
                )
            }
        }
    })
}

fn cmd_ipc_path() -> TokenStream {
    quote! { ::coralstack_cmd_ipc }
}
