//! Codegen for `#[command("id", ...)]`.
//!
//! Two entry points:
//! - `expand(attr, item)` — handles a free async fn. Produces a generated
//!   struct implementing `Command`, an `<name>_command()` factory, and
//!   keeps the original fn intact so callers may still invoke it
//!   directly.
//! - `expand_method(attr, method, host)` — called by the `#[commands]`
//!   macro for each tagged method inside an `impl Host` block. Produces
//!   a generated struct holding an `Arc<Host>` whose `handle` delegates
//!   to `host.<method>(req).await`.

use proc_macro2::TokenStream;
use quote::{format_ident, quote};
use syn::{
    FnArg, GenericArgument, Ident, ImplItemFn, ItemFn, PatType, PathArguments, ReturnType,
    Signature, Type,
};

use crate::attr_args::{self, CommandAttrArgs};

/// Entry point for `#[command]` on a free async fn.
pub fn expand(attr: TokenStream, item: TokenStream) -> syn::Result<TokenStream> {
    let args = attr_args::parse(attr)?;
    let func: ItemFn = syn::parse2(item)?;

    if func.sig.asyncness.is_none() {
        return Err(syn::Error::new_spanned(
            &func.sig,
            "#[command] requires an async fn",
        ));
    }

    let request_ty = extract_request_type(&func.sig)?;
    let response_ty = extract_response_type(&func.sig)?;

    let fn_name = &func.sig.ident;
    let struct_ident = free_fn_struct_ident(fn_name);
    let factory_ident = format_ident!("{}_command", fn_name);
    let vis = &func.vis;
    let description = description_tokens(args.description.as_ref());
    let id_lit = &args.id;

    // Call shape for the generated handle: invoke the free fn by name.
    let call_expr = quote! { async move { #fn_name(request).await } };

    let command_impl = emit_command_impl(
        &struct_ident,
        id_lit,
        description,
        &request_ty,
        &response_ty,
        call_expr,
    );

    let cmd_ipc = cmd_ipc_path();
    Ok(quote! {
        #func

        #[doc(hidden)]
        #[allow(non_camel_case_types)]
        struct #struct_ident;

        #command_impl

        /// Returns a `Command` handler generated from the free fn above.
        #[allow(non_snake_case)]
        #vis fn #factory_ident () -> impl #cmd_ipc::Command { #struct_ident }
    })
}

/// Output of `expand_method`, consumed by `commands_attr`.
pub struct MethodExpansion {
    /// Token stream that defines the per-method wrapper struct + Command
    /// impl. Emitted at the module level alongside the original impl.
    pub items: TokenStream,
    /// The ident of the generated wrapper struct (e.g. `__MathServiceAdd`).
    pub struct_ident: Ident,
}

/// Entry point invoked by `#[commands]` for one tagged method.
///
/// `host_ty` is the self-type of the surrounding impl block (the token
/// stream naming the host type, including any generics in the future).
pub fn expand_method(
    args: CommandAttrArgs,
    method: &ImplItemFn,
    host_ty: &TokenStream,
    host_ident_for_naming: &Ident,
) -> syn::Result<MethodExpansion> {
    if method.sig.asyncness.is_none() {
        return Err(syn::Error::new_spanned(
            &method.sig,
            "#[command] requires an async fn",
        ));
    }
    expect_method_receiver(&method.sig)?;

    let request_ty = extract_request_type(&method.sig)?;
    let response_ty = extract_response_type(&method.sig)?;

    let method_ident = &method.sig.ident;
    let struct_ident = method_struct_ident(host_ident_for_naming, method_ident);
    let description = description_tokens(args.description.as_ref());
    let id_lit = &args.id;

    // For methods: struct holds Arc<Host>, handle clones it and delegates.
    let call_expr = quote! {
        {
            let host = ::std::sync::Arc::clone(&self.host);
            async move { host.#method_ident(request).await }
        }
    };
    let command_impl = emit_command_impl_owned(
        &struct_ident,
        host_ty,
        id_lit,
        description,
        &request_ty,
        &response_ty,
        call_expr,
    );

    let items = quote! {
        #[doc(hidden)]
        #[allow(non_camel_case_types)]
        struct #struct_ident {
            host: ::std::sync::Arc<#host_ty>,
        }

        #command_impl
    };

    Ok(MethodExpansion {
        items,
        struct_ident,
    })
}

// ---------- helpers ----------

fn emit_command_impl(
    struct_ident: &Ident,
    id_lit: &syn::LitStr,
    description: TokenStream,
    request_ty: &Type,
    response_ty: &Type,
    call_expr: TokenStream,
) -> TokenStream {
    let cmd_ipc = cmd_ipc_path();
    quote! {
        impl #cmd_ipc::Command for #struct_ident {
            const ID: &'static str = #id_lit;
            const DESCRIPTION: ::core::option::Option<&'static str> = #description;
            type Request = #request_ty;
            type Response = #response_ty;

            fn handle(
                &self,
                request: Self::Request,
            ) -> impl ::core::future::Future<
                Output = ::core::result::Result<Self::Response, #cmd_ipc::CommandError>
            > + ::core::marker::Send {
                #call_expr
            }

            fn schema() -> ::core::option::Option<#cmd_ipc::CommandSchema> {
                ::core::option::Option::Some(#cmd_ipc::CommandSchema {
                    request: ::core::option::Option::Some(
                        #cmd_ipc::normalize_schema(
                            #cmd_ipc::serde_json::to_value(
                                #cmd_ipc::schemars::schema_for!(#request_ty)
                            ).expect("request schema should serialize"),
                        ),
                    ),
                    response: ::core::option::Option::Some(
                        #cmd_ipc::normalize_schema(
                            #cmd_ipc::serde_json::to_value(
                                #cmd_ipc::schemars::schema_for!(#response_ty)
                            ).expect("response schema should serialize"),
                        ),
                    ),
                })
            }
        }
    }
}

/// Same as `emit_command_impl` but for structs that hold an `Arc<Host>`
/// — the `handle` fn moves a clone of `self.host` into its async block,
/// so the returned future is `'static + Send` without borrowing `self`.
fn emit_command_impl_owned(
    struct_ident: &Ident,
    _host_ty: &TokenStream,
    id_lit: &syn::LitStr,
    description: TokenStream,
    request_ty: &Type,
    response_ty: &Type,
    call_expr: TokenStream,
) -> TokenStream {
    emit_command_impl(
        struct_ident,
        id_lit,
        description,
        request_ty,
        response_ty,
        call_expr,
    )
}

fn description_tokens(d: Option<&syn::LitStr>) -> TokenStream {
    match d {
        Some(lit) => quote! { ::core::option::Option::Some(#lit) },
        None => quote! { ::core::option::Option::None },
    }
}

/// Absolute path to the runtime crate. Users must depend on
/// `coralstack-cmd-ipc` under that exact name (the macros re-export
/// nothing and do not support renaming the dependency).
fn cmd_ipc_path() -> TokenStream {
    quote! { ::coralstack_cmd_ipc }
}

fn free_fn_struct_ident(fn_name: &Ident) -> Ident {
    // e.g. `greet` → `GreetCommand`. Capitalize first letter.
    let s = fn_name.to_string();
    let mut c = s.chars();
    let capitalized = match c.next() {
        Some(first) => first.to_uppercase().chain(c).collect::<String>(),
        None => s,
    };
    Ident::new(&format!("{capitalized}Command"), fn_name.span())
}

fn method_struct_ident(host: &Ident, method: &Ident) -> Ident {
    let s = method.to_string();
    let mut c = s.chars();
    let capitalized = match c.next() {
        Some(first) => first.to_uppercase().chain(c).collect::<String>(),
        None => s,
    };
    Ident::new(&format!("__{}{}Command", host, capitalized), method.span())
}

/// Extracts the request type from a signature.
///
/// Rules:
/// - For a free fn: the single argument's type. If zero args → `()`.
/// - For a method: the single argument after `&self`. If only `&self` → `()`.
/// - Argument pattern may be `_: T` or `req: T`; only `T` is extracted.
/// - If the fn has multiple non-receiver args, that's a compile error.
fn extract_request_type(sig: &Signature) -> syn::Result<Type> {
    // Skip the receiver if present.
    let non_recv: Vec<&FnArg> = sig
        .inputs
        .iter()
        .filter(|a| !matches!(a, FnArg::Receiver(_)))
        .collect();
    match non_recv.as_slice() {
        [] => Ok(unit_type()),
        [one] => {
            let FnArg::Typed(PatType { ty, pat, .. }) = one else {
                return Err(syn::Error::new_spanned(one, "unexpected receiver here"));
            };
            // Sanity: accept any pat (ident, wildcard, etc.) — we only care about the type.
            let _ = pat;
            Ok((**ty).clone())
        }
        _ => Err(syn::Error::new_spanned(
            &sig.inputs,
            "#[command] handlers must take at most one argument (the typed request)",
        )),
    }
}

/// Extracts `R` from a return type of `Result<R, _>`.
fn extract_response_type(sig: &Signature) -> syn::Result<Type> {
    let ReturnType::Type(_, ty) = &sig.output else {
        return Err(syn::Error::new_spanned(
            &sig.output,
            "#[command] handlers must return `Result<R, CommandError>`",
        ));
    };
    let Type::Path(tp) = &**ty else {
        return Err(syn::Error::new_spanned(
            ty,
            "#[command] handlers must return `Result<R, CommandError>`",
        ));
    };
    let last = tp
        .path
        .segments
        .last()
        .ok_or_else(|| syn::Error::new_spanned(ty, "empty return type path"))?;
    if last.ident != "Result" {
        return Err(syn::Error::new_spanned(
            &last.ident,
            "#[command] handlers must return `Result<R, CommandError>`",
        ));
    }
    let PathArguments::AngleBracketed(args) = &last.arguments else {
        return Err(syn::Error::new_spanned(
            &last.arguments,
            "expected `Result<R, CommandError>` with explicit generics",
        ));
    };
    let first = args.args.iter().find_map(|a| match a {
        GenericArgument::Type(t) => Some(t.clone()),
        _ => None,
    });
    first.ok_or_else(|| syn::Error::new_spanned(args, "missing response type in Result<_, _>"))
}

fn expect_method_receiver(sig: &Signature) -> syn::Result<()> {
    match sig.inputs.first() {
        Some(FnArg::Receiver(_)) => Ok(()),
        _ => Err(syn::Error::new_spanned(
            sig,
            "#[command] inside an #[commands] impl must be a method (first arg `&self`)",
        )),
    }
}

fn unit_type() -> Type {
    syn::parse_quote! { () }
}
