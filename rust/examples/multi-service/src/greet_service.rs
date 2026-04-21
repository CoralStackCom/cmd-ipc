//! `GreetService` — string-in / string-out command service.
//! Registered on the root registry and called directly from the REPL.

use coralstack_cmd_ipc::prelude::*;

pub struct GreetService;

#[command_service]
impl GreetService {
    #[command("greet.hello", description = "Greet someone by name")]
    async fn hello(&self, name: String) -> Result<String, CommandError> {
        Ok(format!("hello, {name}"))
    }

    #[command("greet.farewell", description = "Say goodbye")]
    async fn farewell(&self, name: String) -> Result<String, CommandError> {
        Ok(format!("goodbye, {name}"))
    }
}
