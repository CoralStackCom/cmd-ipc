//! Transport abstraction for the command registry.
//!
//! A [`CommandChannel`] is any bidirectional carrier of [`Message`]s: an
//! in-process MPSC pair, an HTTP client/server, an MCP session, etc. This
//! module defines the trait and ships a single in-memory implementation
//! used by the registry's integration tests and by multi-task
//! applications running inside a single process.
//!
//! The trait uses native `async fn`, so it works with any executor the
//! user brings (tokio, smol, `futures::executor::block_on`, …). The crate
//! itself spawns nothing.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use futures::channel::mpsc::{unbounded, UnboundedReceiver, UnboundedSender};
use futures::channel::oneshot;
use futures::future::{BoxFuture, Shared};
use futures::lock::Mutex as AsyncMutex;
use futures::{FutureExt, StreamExt};
use parking_lot::Mutex;

use crate::error::ChannelError;
use crate::message::Message;

/// Transport carrying [`Message`]s between two command registries.
///
/// Every method takes `&self` so the channel can be shared across tasks
/// as an `Arc<dyn CommandChannel>`. Implementations provide their own
/// interior synchronization. The registry drives recv from a single
/// task, so implementations may assume a single concurrent `recv`
/// caller.
///
/// The async methods return [`BoxFuture`] rather than `impl Future` so
/// `dyn CommandChannel` is object-safe. This is the same shape
/// `#[async_trait]` produces internally, written out by hand to avoid
/// the dependency.
pub trait CommandChannel: Send + Sync {
    /// Stable identifier used by the registry to key routing tables.
    fn id(&self) -> &str;

    /// Performs any connection/handshake setup. Called once by the
    /// registry before the first recv.
    fn start(&self) -> BoxFuture<'_, Result<(), ChannelError>>;

    /// Releases any resources and signals the peer that the channel is
    /// going away. After `close`, `send` must return `Err(Closed)` and
    /// `recv` must return `None`.
    fn close(&self) -> BoxFuture<'_, ()>;

    /// Fire-and-forget send. Returns immediately without waiting for
    /// the peer to receive the message.
    fn send(&self, msg: Message) -> Result<(), ChannelError>;

    /// Awaits the next incoming message. Returns `None` when the
    /// channel has been closed by either side.
    fn recv(&self) -> BoxFuture<'_, Option<Message>>;
}

/// In-process [`CommandChannel`] backed by unbounded futures MPSC
/// queues. Useful for tests and for wiring multiple registries running
/// inside a single process (e.g. across async tasks or worker threads).
pub struct InMemoryChannel {
    id: String,
    outbound: UnboundedSender<Message>,
    inbound: AsyncMutex<Option<UnboundedReceiver<Message>>>,
    // Close signal wiring. `close_tx` is fired by our own `close()`,
    // resolving `close_rx` so an in-flight `recv` can bail out even
    // when the peer's sender is still alive. The receiver is `Shared`
    // so it can be cloned per recv call.
    close_tx: Mutex<Option<oneshot::Sender<()>>>,
    close_rx: Shared<oneshot::Receiver<()>>,
    closed: AtomicBool,
}

impl InMemoryChannel {
    /// Returns two channels wired to each other. A message sent on one
    /// arrives on the other's `recv`.
    ///
    /// Each half carries a label, since the registry uses it as the
    /// routing key. The two halves typically use each other's labels:
    /// the parent calls the child channel `"child"` and vice versa.
    pub fn pair(id_a: impl Into<String>, id_b: impl Into<String>) -> (Arc<Self>, Arc<Self>) {
        let (tx_a_to_b, rx_b) = unbounded();
        let (tx_b_to_a, rx_a) = unbounded();
        let (close_a_tx, close_a_rx) = oneshot::channel::<()>();
        let (close_b_tx, close_b_rx) = oneshot::channel::<()>();
        let a = Arc::new(Self {
            id: id_a.into(),
            outbound: tx_a_to_b,
            inbound: AsyncMutex::new(Some(rx_a)),
            close_tx: Mutex::new(Some(close_a_tx)),
            close_rx: close_a_rx.shared(),
            closed: AtomicBool::new(false),
        });
        let b = Arc::new(Self {
            id: id_b.into(),
            outbound: tx_b_to_a,
            inbound: AsyncMutex::new(Some(rx_b)),
            close_tx: Mutex::new(Some(close_b_tx)),
            close_rx: close_b_rx.shared(),
            closed: AtomicBool::new(false),
        });
        (a, b)
    }
}

impl CommandChannel for InMemoryChannel {
    fn id(&self) -> &str {
        &self.id
    }

    fn start(&self) -> BoxFuture<'_, Result<(), ChannelError>> {
        Box::pin(async { Ok(()) })
    }

    fn close(&self) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            self.closed.store(true, Ordering::SeqCst);
            self.outbound.close_channel();
            // Fire the close signal so an in-flight recv exits.
            if let Some(tx) = self.close_tx.lock().take() {
                let _ = tx.send(());
            }
        })
    }

    fn send(&self, msg: Message) -> Result<(), ChannelError> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(ChannelError::Closed);
        }
        self.outbound
            .unbounded_send(msg)
            .map_err(|e| ChannelError::Send(e.to_string()))
    }

    fn recv(&self) -> BoxFuture<'_, Option<Message>> {
        Box::pin(async move {
            if self.closed.load(Ordering::SeqCst) {
                return None;
            }
            let mut guard = self.inbound.lock().await;
            let rx = guard.as_mut()?;
            let close_fut = self.close_rx.clone();
            futures::select_biased! {
                msg = rx.next().fuse() => msg,
                _ = close_fut.fuse() => None,
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::message::MessageId;
    use futures::executor::block_on;
    use futures::future::join;

    fn ping(id: MessageId) -> Message {
        Message::ListCommandsRequest { id }
    }

    #[test]
    fn pair_sends_in_both_directions() {
        let (a, b) = InMemoryChannel::pair("alice", "bob");
        block_on(async {
            assert_eq!(a.id(), "alice");
            assert_eq!(b.id(), "bob");

            let m1 = ping(MessageId::new_v4());
            let m2 = ping(MessageId::new_v4());

            a.send(m1.clone()).unwrap();
            b.send(m2.clone()).unwrap();

            assert_eq!(b.recv().await, Some(m1));
            assert_eq!(a.recv().await, Some(m2));
        });
    }

    #[test]
    fn recv_awaits_future_send() {
        let (a, b) = InMemoryChannel::pair("alice", "bob");
        block_on(async {
            let msg = ping(MessageId::new_v4());
            let expected = msg.clone();

            // Spawn the send and recv concurrently; recv must complete
            // even though the send is scheduled afterwards in the same
            // task group.
            let (_, recvd) = join(
                async {
                    a.send(msg).unwrap();
                },
                b.recv(),
            )
            .await;
            assert_eq!(recvd, Some(expected));
        });
    }

    #[test]
    fn close_stops_recv_on_both_sides() {
        let (a, b) = InMemoryChannel::pair("alice", "bob");
        block_on(async {
            a.close().await;
            // A's own recv returns None immediately.
            assert!(a.recv().await.is_none());
            // B's recv drains any queued messages then sees None.
            assert!(b.recv().await.is_none());
        });
    }

    #[test]
    fn send_after_close_is_error() {
        let (a, _b) = InMemoryChannel::pair("alice", "bob");
        block_on(async {
            a.close().await;
        });
        let err = a.send(ping(MessageId::new_v4())).unwrap_err();
        assert!(matches!(err, ChannelError::Closed));
    }

    #[test]
    fn queued_messages_drain_after_peer_close() {
        let (a, b) = InMemoryChannel::pair("alice", "bob");
        block_on(async {
            let m = ping(MessageId::new_v4());
            let expected = m.clone();
            a.send(m).unwrap();
            a.close().await;
            // Queued message is still deliverable, then None.
            assert_eq!(b.recv().await, Some(expected));
            assert!(b.recv().await.is_none());
        });
    }
}
