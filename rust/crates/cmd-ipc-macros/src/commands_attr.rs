//! Codegen for `#[command_service] impl Host { ... }`.
//!
//! For every `#[command("id", ...)]`-tagged method inside the impl
//! block, we emit:
//!   1. A sibling wrapper struct implementing `Command`.
//!   2. An entry in the host type's generated `register` helper.
//!
//! The original impl block is preserved (stripped of `#[command]`
//! attributes) so users can still call the methods directly.

use proc_macro2::{Span, TokenStream};
use quote::{format_ident, quote, ToTokens};
use syn::{Attribute, ImplItem, ItemImpl, LitStr};

use crate::attr_args::CommandAttrArgs;
use crate::command_attr::{expand_method, MethodExpansion};

pub fn expand(attr: TokenStream, item: TokenStream) -> syn::Result<TokenStream> {
    if !attr.is_empty() {
        return Err(syn::Error::new(
            Span::call_site(),
            "#[command_service] takes no arguments",
        ));
    }

    let mut item_impl: ItemImpl = syn::parse2(item)?;

    // Host type must be a bare path (no trait impl, no generics for now).
    if item_impl.trait_.is_some() {
        return Err(syn::Error::new_spanned(
            &item_impl,
            "#[command_service] cannot be applied to a trait impl block",
        ));
    }
    if !item_impl.generics.params.is_empty() {
        return Err(syn::Error::new_spanned(
            &item_impl.generics,
            "#[command_service] does not yet support generic host types",
        ));
    }

    let host_ty_tokens = item_impl.self_ty.to_token_stream();
    let host_ident = host_ident_from_self_ty(&item_impl.self_ty)?;

    let mut extra_items = TokenStream::new();
    // (id_string, struct_ident) pairs for building `register`.
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
                    "duplicate command id `{}` in this #[command_service] block",
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
            "#[command_service] impl block contains no #[command(\"...\")] methods",
        ));
    }

    // Module name derived from the host: `MathService` → `math_service`.
    // The generated Command structs live inside this module so users can
    // reach them for strict-mode `execute::<math_service::Add>(..)`.
    let mod_ident = format_ident!("{}", pascal_to_snake(&host_ident.to_string()));

    // Build the inherent `register` method. Each generated wrapper struct
    // lives at `self::mod_ident::Name`; we pass an instance (with a
    // cloned `Arc<Host>`) to the typed `register_command`.
    let register_calls = registrations.iter().map(|(_, ident)| {
        quote! {
            registry
                .register_command(
                    self::#mod_ident::#ident { host: ::std::sync::Arc::clone(&host) }
                )
                .await?;
        }
    });

    let register_impl = quote! {
        impl #host_ty_tokens {
            /// Registers every `#[command]`-tagged method on `self` with
            /// the given registry. Consumes `self` by arc-wrapping it so
            /// each generated handler holds a shared reference to the
            /// host.
            #[allow(clippy::needless_pass_by_value)]
            pub async fn register(
                self,
                registry: &::coralstack_cmd_ipc::CommandRegistry,
            ) -> ::core::result::Result<(), ::coralstack_cmd_ipc::CommandError> {
                let host = ::std::sync::Arc::new(self);
                #( #register_calls )*
                ::core::result::Result::Ok(())
            }
        }
    };

    // Wrap the per-method Command structs in a module named after the
    // host. `use super::*` pulls the host type and any user imports into
    // the nested scope so `Arc<HostType>` resolves. `#[allow(...)]` is
    // needed because snake_case module names triggers lints when the
    // host already has a snake_case name.
    let extra_items_mod = quote! {
        #[doc(hidden)]
        #[allow(non_snake_case, clippy::module_name_repetitions)]
        pub mod #mod_ident {
            use super::*;
            #extra_items
        }
    };

    Ok(quote! {
        #item_impl
        #extra_items_mod
        #register_impl
    })
}

/// Converts a PascalCase identifier to snake_case.
///
/// `MathService` → `math_service`. `HTTPServer` → `h_t_t_p_server`
/// (acceptable for typical Pascal-case service names; no smart
/// acronym handling).
fn pascal_to_snake(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    for (i, ch) in s.chars().enumerate() {
        if ch.is_uppercase() {
            if i > 0 {
                out.push('_');
            }
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
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
            "#[command_service] host type must be a simple named type",
        ));
    };
    tp.path
        .segments
        .last()
        .map(|s| s.ident.clone())
        .ok_or_else(|| syn::Error::new_spanned(ty, "empty path for #[command_service] host type"))
}
