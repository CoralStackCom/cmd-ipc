//! Codegen for `#[event("id")] struct Payload`.
//!
//! Auto-derives `Serialize`, `Deserialize`, and `JsonSchema` against the
//! `serde` / `schemars` re-exports from `coralstack-cmd-ipc`, then emits
//! an `impl Event for Payload` with the id and schema.
//!
//! Unit structs (`struct WorkerTick;`) are valid and produce a void
//! event — no payload on the wire, the `schema()` method returns
//! `None`. This mirrors TypeScript's `v.void()`.

use proc_macro2::{Span, TokenStream};
use quote::quote;
use syn::parse::{Parse, ParseStream};
use syn::{Fields, ItemStruct, LitStr};

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

    // Unit / empty structs are void events — no payload, no schema.
    let is_void = matches!(item_struct.fields, Fields::Unit);
    let schema_expr = if is_void {
        quote! { ::core::option::Option::None }
    } else {
        quote! {
            ::core::option::Option::Some(
                #cmd_ipc::normalize_schema(
                    #cmd_ipc::serde_json::to_value(
                        #cmd_ipc::schemars::schema_for!(#struct_ident)
                    ).expect("event schema should serialize"),
                ),
            )
        }
    };

    Ok(quote! {
        #[derive(
            #cmd_ipc::serde::Serialize,
            #cmd_ipc::serde::Deserialize,
            #cmd_ipc::schemars::JsonSchema,
        )]
        #[serde(crate = "::coralstack_cmd_ipc::serde")]
        #[schemars(crate = "::coralstack_cmd_ipc::schemars")]
        #item_struct

        impl #cmd_ipc::Event for #struct_ident {
            const ID: &'static str = #id_lit;

            fn schema(&self) -> ::core::option::Option<#cmd_ipc::serde_json::Value> {
                #schema_expr
            }
        }
    })
}

fn cmd_ipc_path() -> TokenStream {
    quote! { ::coralstack_cmd_ipc }
}
