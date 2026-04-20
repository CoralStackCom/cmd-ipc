//! Parser for `#[command("id", description = "...")]` attribute args.

use proc_macro2::TokenStream;
use syn::parse::{Parse, ParseStream};
use syn::{Expr, ExprLit, Lit, LitStr, Token};

pub struct CommandAttrArgs {
    pub id: LitStr,
    pub description: Option<LitStr>,
}

impl Parse for CommandAttrArgs {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let id: LitStr = input.parse().map_err(|_| {
            syn::Error::new(
                input.span(),
                "expected command id as string literal, e.g. `#[command(\"math.add\")]`",
            )
        })?;
        let mut description: Option<LitStr> = None;
        while !input.is_empty() {
            input.parse::<Token![,]>()?;
            if input.is_empty() {
                break;
            }
            let name: syn::Ident = input.parse()?;
            input.parse::<Token![=]>()?;
            let value: Expr = input.parse()?;
            match name.to_string().as_str() {
                "description" => {
                    description = Some(lit_str(value, "description")?);
                }
                other => {
                    return Err(syn::Error::new(
                        name.span(),
                        format!("unknown #[command] argument `{other}`; expected `description`"),
                    ));
                }
            }
        }
        Ok(Self { id, description })
    }
}

fn lit_str(expr: Expr, arg: &str) -> syn::Result<LitStr> {
    match expr {
        Expr::Lit(ExprLit {
            lit: Lit::Str(s), ..
        }) => Ok(s),
        e => Err(syn::Error::new_spanned(
            e,
            format!("expected string literal for `{arg}`"),
        )),
    }
}

/// Parse the attribute token stream produced by an attribute macro.
pub fn parse(attr: TokenStream) -> syn::Result<CommandAttrArgs> {
    syn::parse2(attr)
}
