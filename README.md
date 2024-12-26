# 🎹 Pianissimo

A pianoroll web app build with `solid-js`.

# 📝 TODO

- [x] selection
  - [x] select-mode
  - [x] select notes with selectionbox
  - [x] drag
  - [x] select-pane (only appears once there are selected notes)
    - [x] duplicate
    - [x] delete
    - [x] enable/disable notes
    - [ ] make loop from selection
- [x] change scale of time-grid
- [x] stretch notes
  - [x] multi-note stretch
  - [x] handle overlapping notes
- [ ] change measure
- [ ] change tempo/bpm
- [ ] velocity mode
- [ ] change volume
- [ ] history: ctrl+z/ctrl+y
- [ ] collaborative feature: add automerge/chee's lib
  - [ ] how to implement undo/redo w automerge?
- [ ] theming: dark mode/light mode
- [ ] save/load locally (localStorage and tauri/fs)
- [ ] desktop mode/mobile mode
  - we develop mobile-first since it's trickier to pull of right

# 💡 Feature Ideas

- [ ] layers: stack music instruments
- [ ] loop multiple different sections at the same time
- [ ] load from midi
- [ ] `WebMidi`
- [ ] different color schemes
- [ ] record jam to a new sequence
  - it's fun to let a loop play and play around with it (mute parts, extend notes, ...)
  - it would be cool to be able to record all these jams into a new sequence
