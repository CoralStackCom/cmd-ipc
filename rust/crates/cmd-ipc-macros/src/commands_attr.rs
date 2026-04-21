//! Codegen for `#[commands] impl Host { ... }`.
//!
//! For every `#[command("id", ...)]`-tagged method inside the impl
//! block, we emit:
//!   1. A sibling wrapper struct implementing `Command`.
//!   2. An entry in the host type's generated `register_all` helper.
//!
//! The original impl block is preserved (stripped of `#[command]`
//! attributes) so users can still call the methods directly.

use proc_macro2::{Span, TokenStream};
use quote::{quote, ToTokens};
use syn::{Attribute, ImplItem, ItemImpl, LitStr};

use crate::attr_args::CommandAttrArgs;
use crate::command_attr::{expand_method, MethodExpansion};

pub fn expand(attr: TokenStream, item: TokenStream) -> syn::Result<TokenStream> {
    if !attr.is_empty() {
        return Err(syn::Error::new(
            Span::call_site(),
            "#[commands] takes no arguments",
        ));
    }

    let mut item_impl: ItemImpl = syn::parse2(item)?;

    // Host type must be a bare path (no trait impl, no generics for now).
    if item_impl.trait_.is_some() {
        return Err(syn::Error::new_spanned(
            &item_impl,
            "#[commands] cannot be applied to a trait impl block",
        ));
    }
    if !item_impl.generics.params.is_empty() {
        return Err(syn::Error::new_spanned(
            &item_impl.generics,
            "#[commands] does not yet support generic host types",
        ));
    }

    let host_ty_tokens = item_impl.self_ty.to_token_stream();
    let host_ident = host_ident_from_self_ty(&item_impl.self_ty)?;

    let mut extra_items = TokenStream::new();
    // (id_string, struct_ident) pairs for building `register_all`.
    let mut registrations: Vec<(LitStr, syn::Ident)> = Vec::new();
    // Collision check: fail if two methods share the same id.
    let mut seen_ids: Vec<LitStr> = Vec::new();

    // Walk methods, extract+strip #[command] attributes, build wrappers.
    for item in item_impl.items.iter_mut() {
        let ImplItem::Fn(method) = item else { continue };

        let (cmd_attr_idx, cmd_attr) = match find_command_attr(&method.attrs) {
            Some(pair) => pair,
            None => continue,
        };

        let args: CommandAttrArgs = cmd_attr.parse_args().map_err(|mut e| {
            e.combine(syn::Error::new_spanned(cmd_attr, "in this #[command]"));
            e
        })?;

        // Check for duplicates within this impl block.
        if let Some(prev) = seen_ids.iter().find(|p| p.value() == args.id.value()) {
            let mut err = syn::Error::new_spanned(
                &args.id,
                format!(
                    "duplicate command id `{}` in this #[commands] block",
                    args.id.value()
                ),
            );
            err.combine(syn::Error::new_spanned(prev, "previously defined here"));
            return Err(err);
        }
        seen_ids.push(args.id.clone());

        let id_lit = args.id.clone();

        let MethodExpansion {
            items: gen_items,
            struct_ident,
        } = expand_method(args, method, &host_ty_tokens, &host_ident)?;

        extra_items.extend(gen_items);
        registrations.push((id_lit, struct_ident));

        // Strip the #[command] attribute from the method so the original
        // impl block is left as ordinary Rust.
        method.attrs.remove(cmd_attr_idx);
    }

    if registrations.is_empty() {
        return Err(syn::Error::new_spanned(
            &item_impl,
            "#[commands] impl block contains no #[command(\"...\")] methods",
        ));
    }

    // Build the inherent `register_all` method as its own impl block to
    // avoid threading user methods. Each generated wrapper struct
    // implements `Command` — we build its CommandDef inline and use the
    // crate-private `__handler_for_command` helper to produce the
    // handler closure, matching what users would write by hand.
    let register_calls = registrations.iter().map(|(_, ident)| {
        quote! {
            {
                let cmd = #ident { host: ::std::sync::Arc::clone(&host) };
                let def = ::coralstack_cmd_ipc::CommandDef {
                    id: <#ident as ::coralstack_cmd_ipc::Command>::ID.to_string(),
                    description: <#ident as ::coralstack_cmd_ipc::Command>::DESCRIPTION
                        .map(::std::string::ToString::to_string),
                    schema: <#ident as ::coralstack_cmd_ipc::Command>::schema(),
                };
                registry
                    .register_command(def, ::coralstack_cmd_ipc::__handler_for_command(cmd))
                    .await?;
            }
        }
    });

    let register_all_impl = quote! {
        impl #host_ty_tokens {
            /// Registers every `#[command]`-tagged method on `self` with
            /// the given registry. Consumes `self` by arc-wrapping it so
            /// each generated handler holds a shared reference to the
            /// host.
            #[allow(clippy::needless_pass_by_value)]
            pub async fn register_all(
                self,
                registry: &::coralstack_cmd_ipc::CommandRegistry,
            ) -> ::core::result::Result<(), ::coralstack_cmd_ipc::CommandError> {
                let host = ::std::sync::Arc::new(self);
                #( #register_calls )*
                ::core::result::Result::Ok(())
            }
        }
    };

    Ok(quote! {
        #item_impl
        #extra_items
        #register_all_impl
    })
}

fn find_command_attr(attrs: &[Attribute]) -> Option<(usize, &Attribute)> {
    attrs.iter().enumerate().find(|(_, a)| is_command_attr(a))
}

fn is_command_attr(attr: &Attribute) -> bool {
    attr.path().is_ident("command")
}

fn host_ident_from_self_ty(ty: &syn::Type) -> syn::Result<syn::Ident> {
    let syn::Type::Path(tp) = ty else {
        return Err(syn::Error::new_spanned(
            ty,
            "#[commands] host type must be a simple named type",
        ));
    };
    tp.path
        .segments
        .last()
        .map(|s| s.ident.clone())
        .ok_or_else(|| syn::Error::new_spanned(ty, "empty path for #[commands] host type"))
}
