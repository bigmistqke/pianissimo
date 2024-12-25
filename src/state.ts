import { batch, createSelector, createSignal } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import Instruments from 'webaudio-instruments'
import zeptoid from 'zeptoid'
import { Loop, Mode, NoteData, SelectionArea, Vector } from './types'
import { pointerHelper } from './utils/pointer-helper'

export const KEY_COLORS = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1].reverse()
export const HEIGHT = 20
export const WIDTH = 60
export const MARGIN = 2
export const VELOCITY = 4

export let audioContext: AudioContext | undefined
export let player: Instruments | undefined
export let playedNotes = new Set<NoteData>()

export const [mode, setMode] = createSignal<Mode>('note')
export const [timeOffset, setTimeOffset] = createSignal(0)
export const [dimensions, setDimensions] = createSignal<DOMRect>()
export const [origin, setOrigin] = createSignal<Vector>({ x: WIDTH, y: 6 * HEIGHT * 12 })
export const [timeScale, setTimeScale] = createSignal(1)
// Select-related state
export const [selectedNotes, setSelectedNotes] = createSignal<Array<NoteData>>([])
export const [selectionArea, setSelectionArea] = createSignal<SelectionArea>()
export const [selectionPresence, setSelectionPresence] = createSignal<Vector>()
export const [clipboard, setClipboard] = createSignal<Array<NoteData>>()
// Playing related state
export const [notes, setNotes] = createStore<Array<NoteData>>([])
export const [playing, setPlaying] = createSignal(false)
export const [playingNotes, setPlayingNotes] = createSignal<Array<NoteData>>([])
export const [now, setNow] = createSignal(0)
export const [instrument, setInstrument] = createSignal(24)
export const [loop, setLoop] = createStore<Loop>({
  time: 0,
  duration: 4
})

function normalize(value: Vector) {
  return {
    x: Math.floor(value.x / WIDTH),
    y: Math.floor(value.y / HEIGHT)
  }
}

export function selectNotesFromSelectionArea(area: SelectionArea) {
  setSelectedNotes(
    notes.filter(note => {
      const noteStartTime = note.time
      const noteEndTime = note.time + note.duration
      const isWithinXBounds = noteStartTime <= area.end.x && noteEndTime > area.start.x
      const isWithinYBounds = -note.pitch >= area.start.y && -note.pitch <= area.end.y
      return isWithinXBounds && isWithinYBounds
    })
  )
}

export const isNoteSelected = createSelector(
  selectedNotes,
  (note: NoteData, selectedNotes) => !!selectedNotes.find(_note => _note.id === note.id)
)

export const isPitchPlaying = createSelector(
  playingNotes,
  (pitch: number, playingNotes) => !!playingNotes.find(_note => _note.pitch === pitch)
)

export function play() {
  if (!audioContext) {
    audioContext = new AudioContext()
  } else setTimeOffset(audioContext.currentTime * VELOCITY - now())
  setPlaying(true)
}

export function togglePlaying() {
  if (!playing()) {
    play()
  } else {
    setPlaying(false)
  }
}

export async function handleCreateNote(event: PointerEvent) {
  const absolutePosition = {
    x: event.layerX - origin().x,
    y: event.layerY - origin().y
  }

  const note = {
    id: zeptoid(),
    active: true,
    duration: timeScale(),
    pitch: Math.floor(-absolutePosition.y / HEIGHT) + 1,
    time: Math.floor(absolutePosition.x / WIDTH / timeScale()) * timeScale()
  }

  setNotes(
    produce(notes => {
      notes.push(note)
      notes.sort((a, b) => (a.time < b.time ? -1 : 1))
    })
  )

  const index = notes.findIndex(_note => note.id === _note.id)

  const initialTime = note.time
  const initialDuration = note.duration
  const offset = absolutePosition.x - initialTime * WIDTH

  setSelectedNotes([note])

  await pointerHelper(event, ({ delta }) => {
    const deltaX = Math.floor((offset + delta.x) / WIDTH / timeScale()) * timeScale()
    if (deltaX < 0) {
      setNotes(index, {
        time: initialTime + deltaX,
        duration: 1 - deltaX
      })
    } else if (deltaX > 0) {
      setNotes(index, 'duration', initialDuration + deltaX)
    } else {
      setNotes(index, {
        time: initialTime,
        duration: timeScale()
      })
    }
  })

  setSelectedNotes([])
  clipOverlappingNotes(note)
}

export async function handleSelectionBox(event: PointerEvent) {
  const position = {
    x: event.clientX - origin().x,
    y: event.clientY - origin().y
  }
  const normalizedPosition = normalize(position)
  setSelectionArea({
    start: normalizedPosition,
    end: normalizedPosition
  })
  setSelectionPresence(normalizedPosition)
  await pointerHelper(event, ({ delta }) => {
    const newPosition = normalize({
      x: position.x + delta.x,
      y: position.y + delta.y
    })
    const area = {
      start: {
        x: delta.x < 0 ? newPosition.x : normalizedPosition.x,
        y: delta.y < 0 ? newPosition.y : normalizedPosition.y
      },
      end: {
        x: delta.x > 0 ? newPosition.x : normalizedPosition.x,
        y: delta.y > 0 ? newPosition.y : normalizedPosition.y
      }
    }
    selectNotesFromSelectionArea(area)
    setSelectionArea(area)
    setSelectionPresence(newPosition)
  })
  setSelectionArea()
}

export async function handlePan(event: PointerEvent) {
  const initialOrigin = { ...origin() }
  await pointerHelper(event, ({ delta }) => {
    setOrigin({
      x: initialOrigin.x + delta.x,
      y: initialOrigin.y + delta.y
    })
  })
}

export function sortNotes() {
  setNotes(produce(notes => notes.sort((a, b) => (a.time < b.time ? -1 : 1))))
}

export function copyNotes() {
  let offset = Infinity
  selectedNotes().forEach(note => {
    if (note.time < offset) {
      offset = note.time
    }
  })
  setClipboard(
    selectedNotes().map(note => ({
      ...note,
      id: zeptoid(),
      time: note.time - offset
    }))
  )
}

export function pasteNotes(clipboard: Array<NoteData>, position: Vector) {
  const newNotes = clipboard
    .map(note => ({
      ...note,
      time: note.time + position.x,
      id: zeptoid()
    }))
    // Remove all the notes that start on the same pitch/time then an existing note
    .filter(note => !notes.find(({ pitch, time }) => note.pitch === pitch && note.time === time))
  setNotes(
    produce(notes => {
      notes.push(...newNotes)
    })
  )
  clipOverlappingNotes(...newNotes)
}

// Utility for clipOverlappingNotes and markOverlappingNotes
function findSourceIntersectingAndBeforeNote(
  sources: Array<NoteData>,
  { id, time, pitch }: NoteData
) {
  if (sources.find(source => source.id === id)) {
    return
  }
  return sources.find(
    source =>
      source.pitch === pitch &&
      id !== source.id &&
      source.time < time &&
      source.time + source.duration > time
  )
}

// Utility for clipOverlappingNotes and markOverlappingNotes
function findSourceIntersectingAndAfterNote(
  sources: Array<NoteData>,
  { id, time, duration, pitch }: NoteData
) {
  if (sources.find(source => source.id === id)) {
    return
  }
  return sources.find(
    source =>
      source.pitch === pitch &&
      id !== source.id &&
      source.time >= time &&
      source.time <= time + duration
  )
}

export function clipOverlappingNotes(...sources: Array<NoteData>) {
  // Sort sources
  sources.sort((a, b) => (a.time < b.time ? -1 : 1))

  batch(() => {
    // Remove all notes that are
    // - intersecting with source and
    // - come after source
    setNotes(notes => notes.filter(note => !findSourceIntersectingAndBeforeNote(sources, note)))

    // Clip all notes that are
    // - intersecting with source and
    // - come before source
    setNotes(
      produce(notes =>
        notes.forEach((note, index) => {
          const source = findSourceIntersectingAndAfterNote(sources, note)
          if (source) {
            notes[index].duration = source.time - note.time
          }
        })
      )
    )

    // Self intersecting sources
    sources.forEach((note, index) => {
      // Loop starting from note after this note
      while (index + 1 < sources.length) {
        const source = sources[index + 1]
        // Ignore sources that aren't same pitch
        if (source.pitch !== note.pitch) {
          index++
          continue
        }
        if (source.time < note.time + note.duration) {
          setNotes(({ id }) => id === note.id, 'duration', source.time - note.time)
        }
        break
      }
    })

    setNotes(
      produce(notes => {
        notes.forEach(note => {
          // Remove temporary values
          delete note._duration
          delete note._remove
        })
      })
    )
  })
}

export function markOverlappingNotes(...sources: Array<NoteData>) {
  // Sort sources
  sources.sort((a, b) => (a.time < b.time ? -1 : 1))

  batch(() => {
    // Remove all notes that are
    // - intersecting with source and
    // - come after source
    setNotes(
      produce(notes =>
        notes.forEach(note => {
          if (findSourceIntersectingAndBeforeNote(sources, note)) {
            note._remove = true
          } else {
            delete note._remove
          }
        })
      )
    )
    // Clip all notes that are
    // - intersecting with source and
    // - come before source
    setNotes(
      produce(notes =>
        notes.forEach((note, index) => {
          const source = findSourceIntersectingAndAfterNote(sources, note)
          if (source) {
            notes[index]._duration = source.time - note.time
          } else {
            delete notes[index]._duration
          }
        })
      )
    )

    sources.forEach((source, index) => {
      const end = source.time + source.duration
      while (index + 1 < sources.length) {
        if (sources[index + 1].pitch !== source.pitch) {
          index++
          continue
        }
        if (sources[index + 1].time <= end) {
          setNotes(({ id }) => id === source.id, '_duration', sources[index + 1].time - source.time)
          break
        }
        setNotes(({ id }) => id === source.id, '_duration', undefined)
        break
      }
    })
  })
}

export function playNote(note: NoteData, delay = 0) {
  if (!player) {
    player = new Instruments()
  }
  player.play(
    instrument(), // instrument: 24 is "Acoustic Guitar (nylon)"
    note.pitch, // note: midi number or frequency in Hz (if > 127)
    1, // velocity
    delay, // delay
    note.duration / VELOCITY, // duration
    0, // (optional - specify channel for tinysynth to use)
    0.05 // (optional - override envelope "attack" parameter)
  )
  setPlayingNotes(pitches => [...pitches, note])
  setTimeout(() => {
    setPlayingNotes(pitches => pitches.filter(({ id }) => id !== note.id))
  }, (note.duration / VELOCITY) * 1000)
}
