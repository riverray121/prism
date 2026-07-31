use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

// WLED advertises itself under this mDNS service type.
const WLED_SERVICE: &str = "_wled._tcp.local.";

// One unbound UDP socket for every DDP send; binding per packet at 60 Hz
// would churn file descriptors for nothing.
fn socket() -> Result<&'static UdpSocket, String> {
    static SOCKET: OnceLock<Option<UdpSocket>> = OnceLock::new();
    SOCKET
        .get_or_init(|| UdpSocket::bind("0.0.0.0:0").ok())
        .as_ref()
        .ok_or_else(|| "failed to bind UDP socket".to_string())
}

// Send one prebuilt DDP packet (header + payload, assembled frontend-side)
// to a hub. Fire-and-forget UDP: a lost packet is one skipped frame.
#[tauri::command]
pub fn ddp_send(address: String, port: u16, data: Vec<u8>) -> Result<(), String> {
    socket()?
        .send_to(&data, (address.as_str(), port))
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Discovery event payload for the frontend: a hub appeared or dropped off.
// `name` is the mDNS instance name (stable per device); `ip` is present on
// "found" so the frontend can query the hub's JSON API without resolving.
#[derive(Clone, Serialize)]
pub struct DiscoveryEvent {
    kind: &'static str,
    name: String,
    ip: Option<String>,
}

// Hubs currently visible on the network (mDNS name → address). Kept because
// resolves usually land within the first second of startup, before the
// webview has attached its event listener — without a pullable snapshot
// those hubs stay invisible until the next re-announcement (mDNS TTLs are
// hours).
#[derive(Default)]
pub struct DiscoveryState {
    found: Mutex<HashMap<String, Option<String>>>,
}

// The currently-visible hubs, as "found" events. The frontend calls this
// right after attaching its `hardware-discovery` listener; everything later
// arrives as events.
#[tauri::command]
pub fn discovery_snapshot(state: State<DiscoveryState>) -> Vec<DiscoveryEvent> {
    let found = state.found.lock().expect("discovery map poisoned");
    found
        .iter()
        .map(|(name, ip)| DiscoveryEvent {
            kind: "found",
            name: name.clone(),
            ip: ip.clone(),
        })
        .collect()
}

// Browse the LAN for WLED hubs for the app's lifetime, emitting
// `hardware-discovery` events (same pattern as `sidecar-message`). mDNS churn
// (rebroadcasts, cache expiry) is passed through; the frontend merges by MAC.
pub fn spawn_discovery(app: &AppHandle) {
    app.manage(DiscoveryState::default());
    let app = app.clone();
    std::thread::spawn(move || {
        let daemon = match mdns_sd::ServiceDaemon::new() {
            Ok(d) => d,
            Err(e) => {
                crate::applog::log(&format!("mdns daemon failed: {e}"));
                return;
            }
        };
        let receiver = match daemon.browse(WLED_SERVICE) {
            Ok(r) => r,
            Err(e) => {
                crate::applog::log(&format!("mdns browse failed: {e}"));
                return;
            }
        };
        while let Ok(event) = receiver.recv() {
            match event {
                mdns_sd::ServiceEvent::ServiceResolved(info) => {
                    let name = info.get_fullname().to_string();
                    let ip = info.get_addresses().iter().next().map(|a| a.to_string());
                    crate::applog::log(&format!("mdns found {name} at {ip:?}"));
                    if let Ok(mut found) = app.state::<DiscoveryState>().found.lock() {
                        found.insert(name.clone(), ip.clone());
                    }
                    let _ = app.emit(
                        "hardware-discovery",
                        DiscoveryEvent {
                            kind: "found",
                            name,
                            ip,
                        },
                    );
                }
                mdns_sd::ServiceEvent::ServiceRemoved(_, fullname) => {
                    crate::applog::log(&format!("mdns lost {fullname}"));
                    if let Ok(mut found) = app.state::<DiscoveryState>().found.lock() {
                        found.remove(&fullname);
                    }
                    let _ = app.emit(
                        "hardware-discovery",
                        DiscoveryEvent {
                            kind: "lost",
                            name: fullname,
                            ip: None,
                        },
                    );
                }
                _ => {}
            }
        }
    });
}
