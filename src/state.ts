import { Repo } from '@automerge/automerge-repo'
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket'
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb'
import { batch, createRoot, createSelector, createSignal } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import Instruments from 'webaudio-instruments'
import zeptoid from 'zeptoid'
import { Loop, Mode, NoteData, SelectionArea, SharedState, Vector } from './types'
import { createDocumentStore } from './utils/create-document-store'
import { pointerHelper } from './utils/pointer-helper'

// Constants

export const KEY_COLORS = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1].reverse()
export const HEIGHT = 20
export const WIDTH = 60
export const MARGIN = 2
export const VELOCITY = 4

// Initialise automerge-state

export const repo = new Repo({
  network: [new BrowserWebSocketClientAdapter('wss://sync.automerge.org')],
  storage: new IndexedDBStorageAdapter()
})
const rootDocUrl = `${document.location.hash.substring(1)}`

export const [doc, setDoc, handleUrl] = createRoot(() =>
  createDocumentStore<SharedState>({
    repo,
    url: rootDocUrl,
    initialValue: {
      notes: [],
      instrument: 24
    }
  })
)

document.location.hash = handleUrl

// Initialise local state

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

// Play-related state
export const [playing, setPlaying] = createSignal(false)
export const [playingNotes, setPlayingNotes] = createStore<Array<NoteData>>([])
export const [now, setNow] = createSignal(0)
export const [loop, setLoop] = createStore<Loop>({
  time: 0,
  duration: 4
})

// Selectors

export const [isNoteSelected, isNotePlaying, isPitchPlaying] = createRoot(() => [
  createSelector(
    selectedNotes,
    (note: NoteData, selectedNotes) => !!selectedNotes.find(filterNote(note))
  ),
  createSelector(
    () => playingNotes,
    (note: NoteData, playingNotes) => !!playingNotes.find(filterNote(note))
  ),
  createSelector(
    () => playingNotes,
    (pitch: number, playingNotes) => !!playingNotes.find(note => note.pitch === pitch)
  )
])

// Actions

function normalizeVector(value: Vector) {
  return {
    x: Math.floor(value.x / WIDTH / timeScale()) * timeScale(),
    y: Math.floor(value.y / HEIGHT)
  }
}

export function filterNote(...notes: Array<NoteData>) {
  return ({ id }: NoteData) => !!notes.find(note => note.id === id)
}

export function selectNotesFromSelectionArea(area: SelectionArea) {
  setSelectedNotes(
    doc().notes.filter(note => {
      const noteStartTime = note.time
      const noteEndTime = note.time + note.duration
      const isWithinXBounds = noteStartTime < area.end.x && noteEndTime > area.start.x
      const isWithinYBounds = -note.pitch >= area.start.y && -note.pitch < area.end.y
      return isWithinXBounds && isWithinYBounds
    })
  )
}

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

export function playNote(note: NoteData, delay = 0) {
  if (!player) {
    player = new Instruments()
  }
  if (note.velocity === 0) {
    return
  }
  player.play(
    doc().instrument, // instrument: 24 is "Acoustic Guitar (nylon)"
    note.pitch, // note: midi number or frequency in Hz (if > 127)
    note.velocity, // velocity
    delay, // delay
    note.duration / VELOCITY, // duration
    0, // (optional - specify channel for tinysynth to use)
    0.05 // (optional - override envelope "attack" parameter)
  )

  setTimeout(() => {
    setPlayingNotes(produce(pitches => pitches.push({ ...note })))
    setTimeout(
      () => {
        setPlayingNotes(
          produce(pitches => {
            pitches.splice(pitches.findIndex(filterNote(note)), 1)
          })
        )
      },
      (note.duration / VELOCITY) * 1000
    )
  }, delay * 1000)
}

export async function handleCreateNote(event: PointerEvent) {
  const absolutePosition = {
    x: event.layerX - origin().x,
    y: event.layerY - origin().y
  }

  const note: NoteData = {
    id: zeptoid(),
    active: true,
    duration: timeScale(),
    pitch: Math.floor(-absolutePosition.y / HEIGHT) + 1,
    time: Math.floor(absolutePosition.x / WIDTH / timeScale()) * timeScale(),
    velocity: 1
  }

  setDoc(doc => {
    doc.notes.push(note)
    // notes.sort((a, b) => (a.time < b.time ? -1 : 1))
  })

  const initialTime = note.time
  const initialDuration = note.duration
  const offset = absolutePosition.x - initialTime * WIDTH

  setSelectedNotes([note])

  await pointerHelper(event, ({ delta }) => {
    const deltaX = Math.floor((offset + delta.x) / WIDTH / timeScale()) * timeScale()
    if (deltaX < 0) {
      setDoc(doc => {
        const _note = doc.notes.find(filterNote(note))
        if (!_note) return
        _note.time = initialTime + deltaX
        _note.duration = 1 - deltaX
      })
    } else if (deltaX > 0) {
      setDoc(doc => {
        const _note = doc.notes.find(filterNote(note))
        if (!_note) return
        _note.duration = initialDuration + deltaX
      })
    } else {
      setDoc(doc => {
        const _note = doc.notes.find(filterNote(note))
        if (!_note) return
        _note.time = initialTime
        _note.duration = timeScale()
      })
    }
    markOverlappingNotes(note)
  })

  setSelectedNotes([])
  clipOverlappingNotes(note)
}

export async function handleSelectionBox(event: PointerEvent) {
  const position = {
    x: event.clientX - origin().x,
    y: event.clientY - origin().y
  }
  const normalizedPosition = normalizeVector(position)
  setSelectionArea({
    start: normalizedPosition,
    end: {
      x: normalizedPosition.x + timeScale(),
      y: normalizedPosition.y
    }
  })
  setSelectionPresence(normalizedPosition)
  await pointerHelper(event, ({ delta }) => {
    const newPosition = normalizeVector({
      x: position.x + delta.x,
      y: position.y + delta.y + 1
    })
    const area = {
      start: {
        x: delta.x < 0 ? newPosition.x : normalizedPosition.x,
        y: delta.y < 0 ? newPosition.y : normalizedPosition.y
      },
      end: {
        x: (delta.x > 0 ? newPosition.x : normalizedPosition.x) + timeScale(),
        y: (delta.y > 0 ? newPosition.y : normalizedPosition.y) + 1
      }
    }
    selectNotesFromSelectionArea(area)
    setSelectionArea(area)
    setSelectionPresence(newPosition)
  })
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
  // setNotes(produce(notes => notes.sort((a, b) => (a.time < b.time ? -1 : 1))))
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
    .filter(
      note => !doc().notes.find(({ pitch, time }) => note.pitch === pitch && note.time === time)
    )
  setDoc(doc => doc.notes.push(...newNotes))
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

  // Remove all notes that are
  // - intersecting with source and
  // - come after source
  setDoc(doc => {
    for (let index = doc.notes.length - 1; index >= 0; index--) {
      const note = doc.notes[index]
      if (findSourceIntersectingAndBeforeNote(sources, note)) {
        doc.notes.splice(index, 1)
      }
    }
  })

  // Clip all notes that are
  // - intersecting with source and
  // - come before source
  setDoc(doc =>
    doc.notes.forEach((note, index) => {
      const source = findSourceIntersectingAndAfterNote(sources, note)
      if (source) {
        doc.notes[index].duration = source.time - note.time
      }
    })
  )

  // Remove all notes that have 0 duration (after being clipped)
  setDoc(doc => {
    for (let index = doc.notes.length - 1; index >= 0; index--) {
      const note = doc.notes[index]
      if (note.duration === 0) {
        doc.notes.splice(index, 1)
      }
    }
  })

  // Handle sources intersecting with other sources
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
        setDoc(doc => {
          doc.notes.forEach(_note => {
            if (_note.id === note.id) {
              _note.duration = source.time - note.time
            }
          })
        })
      }
      break
    }
  })

  // Remove temporary values
  setDoc(doc => {
    doc.notes.forEach(note => {
      delete note._duration
      delete note._remove
    })
  })
}

/**
 * Mark overlapping notes temporarily for display purposes
 * - remove notes with note._remove
 * - clip notes with note._duration
 */
export function markOverlappingNotes(...sources: Array<NoteData>) {
  // Sort sources
  sources.sort((a, b) => (a.time < b.time ? -1 : 1))

  batch(() => {
    // Remove all notes that are
    // - intersecting with source and
    // - come after source
    setDoc(doc =>
      doc.notes.forEach(note => {
        if (findSourceIntersectingAndBeforeNote(sources, note)) {
          note._remove = true
        } else {
          delete note._remove
        }
      })
    )
    // Clip all notes that are
    // - intersecting with source and
    // - come before source
    setDoc(doc =>
      doc.notes.forEach((note, index) => {
        const source = findSourceIntersectingAndAfterNote(sources, note)
        if (source) {
          doc.notes[index]._duration = source.time - note.time
        } else {
          delete doc.notes[index]._duration
        }
      })
    )

    // Handle sources intersecting with other sources
    sources.forEach((source, index) => {
      const end = source.time + source.duration
      while (index + 1 < sources.length) {
        if (sources[index + 1].pitch !== source.pitch) {
          index++
          continue
        }
        if (sources[index + 1].time <= end) {
          setDoc(doc => {
            doc.notes.forEach(note => {
              if (note.id === source.id) {
                note._duration = sources[index + 1].time - source.time
              }
            })
          })

          break
        }
        setDoc(doc => {
          doc.notes.forEach(note => {
            if (note.id === source.id) {
              delete note._duration
            }
          })
        })

        break
      }
    })
  })
}
