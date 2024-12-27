# 🎹 Pianissimo

A collaborative piano roll, powered by [solid-js](https://github.com/solidjs/solid) and [automerge](https://github.com/automerge/automerge).

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
  - [ ] needs fix: when reducing a note it reduces 1 timescale too early
- [x] velocity mode
- [x] collaborative feature: add automerge/chee's lib
  - [ ] history: ctrl+z/ctrl+y
    - how to implement undo/redo with automerge?
    - research: https://www.youtube.com/watch?v=uP7AKExkMGU
    - tried https://github.com/onsetsoftware/automerge-repo-undo-redo but created `conflict` patches
- [x] change tempo/bpm
  - [ ] needs fix: bpm is not correct and creates glitches when changing tempo
- [x] change volume
- [ ] change measure
- [ ] zoom (pinch on mobile?)
- [ ] theming
  - [x] dark mode
  - [ ] light mode

# 💡 Feature Ideas

- [ ] layers: stack music instruments
- [ ] loop multiple different sections at the same time
- [ ] load from midi
- [ ] `WebMidi`
- [ ] different color schemes
- [ ] desktop mode/mobile mode
  - we develop mobile-first since it's trickier to pull of right
- [ ] arpeggiator / arpeggio-pattern designer
  - select area/notes
  - select pattern
  - arpeggio made within selection-area using the selected notes and according to current grid-size
- [ ] record jam to a new sequence
  - it's fun to let a loop play and play around with it (mute parts, extend notes, ...)
  - it would be cool to be able to record all these jams into a new sequence
