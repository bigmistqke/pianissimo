# 🎹 Pianissimo

A collaborative pianoroll ⚡ by [solid-js](https://github.com/solidjs/solid) and [automerge](https://github.com/automerge/automerge).

# Modes

> 🎹 _What happens when you touch the pianoroll's background_<br>
> 🎵 _What happens when you touch a single note_

- `Note`
  - 🎹 _Draw a note at and extend it when moving the pointer_
  - 🎵 _Drag a single note_
- `Duration`
  - 🎹 _Draw selection-area and select notes_
  - 🎵
    - If note was selected: _update duration of all selected notes_
    - If note wasn't selected: _select note and update its duration_
  - Sub Menu:
    - 🔒 Locks the current selection
      - _When touching the pianoroll it updates the selected notes' duration instead of drawing a selection-area_
- `Velocity`
  - 🎹 _Draw selection-area and select notes_
  - 🎵
    - If note was selected: _update velocity of all selected notes_
    - If note wasn't selected: _select note and update its velocity_
  - Sub Menu:
    - 🔒 Locks the current selection
      - _When touching the pianoroll it updates the selected notes' velocity instead of drawing a selection-area_
- `Erase`
  - 🎹 _Draw selection-area and erase all selected notes_
  - 🎵 _Erase a single note_
- `Snip`
  - 🎹 _Draw selection-area and snip the notes that are intersecting with the front of the selection-area in two_
  - 🎵 _(Same as above)_
- `Select`
  - 🎹 _Draw selection-area, move the virtual cursor and select notes_
  - 🎵
    - If note was selected: _drag all selected notes in time/pitch_
    - If note wasn't selected: _select note_
  - Sub Menu:
    - 🔒 Locks the current selection
      - _When touching the pianoroll it updates the selected notes' position instead of drawing a selection-area_
    - 📋 Copy
      - _Add all the selected notes to the clipboard_
    - 📄 Paste
      - _Paste the notes in the clipboard at the cursor's current position_
- `Loop`
  - 🎹 _Draw selection-area, after releasing create a loop from selection-area's start- and end-time_
  - 🎵 _(Same as above)_
- `Pan`
  - 🎹 _Pan the pianoroll_
  - 🎵 _(Same as above)_

## 📝 TODO

- [ ] change measure
- [x] collaborative feature: add automerge/chee's lib
  - [ ] history: ctrl+z/ctrl+y
    - how to implement undo/redo with automerge?
    - research: https://www.youtube.com/watch?v=uP7AKExkMGU
    - tried https://github.com/onsetsoftware/automerge-repo-undo-redo but created `conflict` patches
- [x] change tempo/bpm
  - [ ] needs fix: bpm is not correct and creates glitches when changing tempo
- [ ] change volume
  - [ ] ui implemented, but needs more work: should connect the instrument to a `GainNode` and control this.
- [ ] zoom
  - [x] controls for desktop
  - [ ] pinch on mobile?
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
