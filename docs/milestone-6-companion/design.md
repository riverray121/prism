# Companion — Design

## Summary

Prism can connect to one companion server: a service on the network that keeps a queue of songs to analyze and a store of published shows. Connected, Prism lists the queue, imports requested songs, publishes analyzed and mapped songs as show bundles, and pulls published shows back for editing. Disconnected, nothing in the app changes. Prism owns the contract ([`../companion-api.md`](../companion-api.md)); the server is a separate project. This milestone also changes what Prism does to a hub when playback stops: it restores the hub's prior state instead of turning it off.

## How it works

Connection: settings hold one companion URL and token. Prism is connected when the last `/v1/info` call succeeded; it retries every 60 s while a companion is configured. The library panel shows the connection state.

Requests: a Requested section in the library panel lists the companion's open requests (title, artist). Import runs the existing YouTube import with the artist and title as the search query, marks the request `analyzing`, and records the request id and external ids on the song. Reject marks the request `rejected`. Requests already `analyzing`, `published`, or `rejected` are hidden.

Publish: a song with a mapping doc and at least one patched light has a Publish action. Prism renders every patched light at its own pixel count over the whole song at the bundle frame rate, packs the bundle, and uploads it under the song id. Publishing again replaces the show. A song linked to a request marks the request `published`.

Pull: a Shows section lists published shows that are not in the library, or whose companion copy is newer than the local publish. Pull downloads the bundle and restores the project into the library under the same song id, replacing the local profile and mapping after a confirmation.

Restore on stop: before the first frame of a play run Prism reads each target hub's power state. On stop it stops sending. A hub that was on returns to its own look once its realtime timeout expires; a hub that was off gets a blackout frame and is powered off. Nothing else about streaming changes.

## Usage

- Settings, Companion section: URL, token, Connect. A connected companion shows its name and version.
- Library panel: Requested (import, reject) and Shows (pull) sections, present only while connected.
- Song: Publish in the song's actions. Enabled when the song has a patch. Publishing shows progress and the result.

## Scope

- In: one companion; connection settings; Requested and Shows sections; import from a request; publish; pull; request status updates; restore-on-stop.
- Out: playing shows (the companion's job); more than one companion; creating requests from Prism; merging a pulled project with local edits (pull overwrites after confirmation); any companion-specific UI.

## Open questions

None.
