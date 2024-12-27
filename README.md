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
    - [x] make loop from selection
- [x] change scale of time-grid
- [x] stretch notes
  - [x] multi-note stretch
  - [x] handle overlapping notes
- [x] velocity mode
- [x] collaborative feature: add automerge/chee's lib
  - [ ] history: ctrl+z/ctrl+y
    - how to implement undo/redo with automerge?
    - research: https://www.youtube.com/watch?v=uP7AKExkMGU
    - tried https://github.com/onsetsoftware/automerge-repo-undo-redo but created `conflict` patches
- [ ] change tempo/bpm
- [ ] change measure
- [ ] change volume
- [ ] theming
  - [x] dark mode
  - [ ] light mode
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
