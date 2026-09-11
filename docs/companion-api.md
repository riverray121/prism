# Companion API

The contract between Prism and a companion server: a service on the network that keeps a queue of songs to analyze and a store of published shows. Prism is the client. Any server that implements this document works; the reference implementation is [prism-player](https://github.com/riverray121/prism-player). Prism never depends on what a companion does with a show.

## Transport

- HTTP/1.1 with JSON bodies. One base URL configured in Prism settings, for example `http://192.168.8.2:8760`.
- Every request carries `Authorization: Bearer <token>`. A bad token answers 401.
- Errors answer a 4xx or 5xx status with `{"error": "<message>"}`.
- Timestamps are RFC 3339 in UTC. Ids are opaque strings chosen by whoever creates the object; Prism uses its song id as the show id.

## Objects

```
Request     {id, title, artist, external: {spotify_uri?}, requested_at,
             status: "open" | "analyzing" | "published" | "rejected", show_id?}
ShowSummary {id, title, artist, duration_s, frame_rate_hz, light_count,
             updated_at, request_id?}
```

`external` carries ids from the system that produced the request. Prism stores them with the song and writes them back into the manifest so the companion can match a show to its source.

## Endpoints

| Method | Path                    | Body                                         | Answer                    | Purpose                                                                                        |
| ------ | ----------------------- | -------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------- |
| GET    | `/v1/info`              |                                              | `{name, version, api: 1}` | Connection check. `api` is this document's version.                                            |
| GET    | `/v1/requests`          |                                              | `{requests: [Request]}`   | All requests, newest first, every status.                                                      |
| POST   | `/v1/requests`          | `{title, artist, external?}`                 | Request                   | Create a request. Companions create requests from their own sources; Prism does not call this. |
| PATCH  | `/v1/requests/{id}`     | `{status, show_id?}`                         | Request                   | Prism sets `analyzing` on import, `published` with `show_id` on publish, `rejected` on reject. |
| GET    | `/v1/shows`             |                                              | `{shows: [ShowSummary]}`  | Published shows.                                                                               |
| PUT    | `/v1/shows/{id}`        | show bundle, `Content-Type: application/zip` | ShowSummary               | Create or replace. Replacing keeps the id, so a republish overwrites in place.                 |
| GET    | `/v1/shows/{id}/bundle` |                                              | the zip                   | Download for editing in Prism.                                                                 |
| DELETE | `/v1/shows/{id}`        |                                              | 204                       | Remove a show.                                                                                 |

A companion may add endpoints of its own (playback, status). Prism ignores anything not listed here.

## Show bundle

A zip file with this layout:

```
manifest.json
audio.<ext>                    the analyzed audio, as imported (flac, wav, mp3, m4a)
frames/<light key>.bin         one file per patched light
project/profile.json           Prism's analysis profile
project/<sidecar>.npy          every sidecar profile.json names, at the same relative path
project/mapping/mapping.json   Prism's mapping doc for the song
```

`manifest.json`:

```json
{
  "schema": "prism-show/1",
  "title": "Dior",
  "artist": "Joji",
  "duration_s": 213.4,
  "audio": "audio.flac",
  "frame_rate_hz": 40,
  "frame_count": 8536,
  "latency_ms": 90,
  "lights": [
    {
      "key": "1cc3abbbc85c-0",
      "hub_mac": "1cc3abbbc85c",
      "output": 0,
      "name": "Output 1",
      "pixel_count": 300,
      "frames": "frames/1cc3abbbc85c-0.bin"
    }
  ],
  "external": { "spotify_uri": "spotify:track:..." },
  "prism_version": "0.1.0"
}
```

Frames:

- A frame file is frame-major RGB with 3 bytes per pixel and no header: `frame_count * pixel_count * 3` bytes. Byte offset of pixel `p` in frame `i` is `(i * pixel_count + p) * 3`.
- Frame `i` covers audio time `[i / frame_rate_hz, (i + 1) / frame_rate_hz)` measured from the start of the audio file.
- Pixel order is the light's physical order from its first pixel. Colour order is RGB; the hub applies its own colour order.
- `frame_rate_hz` is 40. WLED over WiFi holds 40 frames per second on a 300-pixel bus; Prism's analysis runs at 100 Hz and is sampled to the nearest frame, the same as its live streamer.
- Files are deflated inside the zip. Frame data compresses well.

Lights:

- A light key is `<hub_mac>-<output>`: the hub's MAC address without separators as WLED reports it in `/json/info`, then the bus index in the hub's LED config. The key identifies a physical output regardless of the hub's IP address.
- A player resolves the hub MAC to an address itself (mDNS or its own config) and reads the output's start pixel from the hub's `/json/cfg`, the same way Prism's rig does. The bundle carries no addresses.
- Only lights patched in the song appear. A player treats a light whose hub it cannot find as absent and plays the rest.
- `latency_ms` is the light delay Prism was calibrated with on the machine that made the bundle. A player has its own calibration and may ignore it.

`project/` is what Prism needs to reopen the song for editing. It mirrors the song folder in Prism's library without the audio. A player treats it as opaque.

Size for the five-output bench rig, 1444 pixels, a 240 s song:

|                            | Size        |
| -------------------------- | ----------- |
| Frames, raw                | 41.6 MB     |
| Frames, deflated (typical) | under 10 MB |
| Audio (flac)               | 20 to 40 MB |
