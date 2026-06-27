# Music Lyrics HUD

An Expo + React Native app that shows synchronized lyrics for the song currently playing on the device, in a large mirrored HUD-style view.

## What the app does

1. Reads current media metadata and playback state from Android media sessions.
2. Builds a lyrics query from track title + artist.
3. Fetches synchronized lyrics from LRCLIB.
4. Parses timestamped lyric lines and keeps the active line centered while playback advances.

## How it works (stable architecture)

This project is intentionally documented by **contracts and data flow**, not line-by-line implementation details, so this README stays valid as code evolves.

### 1. Native media state source (Android)

- A custom native Android bridge emits media updates to JS (`OnMediaStateChanged`).
- On app resume, native emits `OnAppResume`, and JS triggers a native media refresh so currently-playing state is re-synced.
- Notification listener permission is required for media-session access.

### 2. JS state and lyrics pipeline

- JS receives native media events and stores:
  - track title
  - artist
  - playback position
  - playing/paused flag
- The app requests lyrics from LRCLIB using the current track/artist.
- Timestamped lyrics are parsed into `{ timeInMs, text }[]`.
- Active line index is derived from playback position and used for:
  - highlighting active/inactive lines
  - auto-centering the active row in the list

### 3. Playback position behavior

- Native sends periodic position snapshots.
- JS interpolates position while playback is active for smoother lyric progression.
- On resume or session changes, position/state are re-synchronized from native.

## Development

```bash
npm install
npm run android
```

Other scripts:

- `npm run start` - start Expo dev server
- `npm run ios` - run iOS build (macOS required)
- `npm run web` - run web target
- `npm run lint` - run Expo lint

## Platform notes

- Primary target is Android because media-session listener behavior is implemented natively there.
- Native Android wiring is generated via Expo prebuild/plugin flow, so `expo prebuild --clean` can recreate required native files.
- Required user permission: notification listener access for the app.

## Credits and open-source acknowledgements

- **LRCLIB** - lyrics API provider: <https://lrclib.net>
- **Expo** - app framework, prebuild/config plugin system: <https://expo.dev>
- **React Native** - mobile runtime and bridge APIs: <https://reactnative.dev>
- **Expo Router** - app entry/routing foundation: <https://docs.expo.dev/router/introduction/>
- **Android MediaSession + NotificationListenerService** - media metadata/playback integration from Android platform APIs

## Project intent

This repository focuses on a reliable, real-time lyrics HUD experience:

- resilient to app resume/background transitions
- tolerant of async fetch/abort timing
- stable visual centering for varying lyric line styles/sizes
