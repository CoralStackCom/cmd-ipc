//! `MathService` — a command service wired up with the `#[command_service]`
//! macro. Registered on the worker registry; reached from the root
//! registry over the in-memory channel.

use coralstack_cmd_ipc::prelude::*;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, JsonSchema)]
pub struct BinaryOpReq {
    pub a: i64,
    pub b: i64,
}

pub struct MathService;

#[command_service]
impl MathService {
    #[command("math.add", description = "Add two integers")]
    async fn add(&self, req: BinaryOpReq) -> Result<i64, CommandError> {
        Ok(req.a + req.b)
    }

    #[command("math.sub", description = "Subtract b from a")]
    async fn sub(&self, req: BinaryOpReq) -> Result<i64, CommandError> {
        Ok(req.a - req.b)
    }

    #[command("math.mul", description = "Multiply two integers")]
    async fn mul(&self, req: BinaryOpReq) -> Result<i64, CommandError> {
        Ok(req.a * req.b)
    }
}
