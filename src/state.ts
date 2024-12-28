import { Repo } from '@automerge/automerge-repo'
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket'
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb'
import { makePersisted } from '@solid-primitives/storage'
import { batch, createEffect, createMemo, createRoot, createSelector, createSignal } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import Instruments from 'webaudio-instruments'
import { OutputChannel, WebMidi } from 'webmidi'
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

// Utils

function serializeDate(): number {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1 // Months are zero-based
  const date = now.getDate()
  const hours = now.getHours()
  const minutes = now.getMinutes()
  const seconds = now.getSeconds()
  const milliSeconds = now.getMilliseconds()

  // Format as YYYYMMDDHHMMSS (padded with zeros)
  const serialized = `${year}${month.toString().padStart(2, '0')}${date.toString().padStart(2, '0')}${hours.toString().padStart(2, '0')}${minutes.toString().padStart(2, '0')}${seconds.toString().padStart(2, '0')}${milliSeconds.toString().padStart(4, '0')}`
  return Number(serialized) // Convert to a number
}

// Deserialize the number back to a readable string
export function deserializeDate(serialized: number): string {
  const str = serialized.toString()
  const year = str.slice(0, 4)
  const month = str.slice(4, 6)
  const date = str.slice(6, 8)
  const hours = str.slice(8, 10)
  const minutes = str.slice(10, 12)
  const seconds = str.slice(12, 14)
  const milliseconds = str.slice(14, 18)

  // Format as YYYY-MM-DD-HH-MM-SS
  return `${year}-${month}-${date}-${hours}-${minutes}-${seconds}-${milliseconds}`
}

// Initialise automerge-state

export const repo = new Repo({
  network: [new BrowserWebSocketClientAdapter('wss://sync.automerge.org')],
  storage: new IndexedDBStorageAdapter()
})

export const {
  document: doc,
  setDocument: setDoc,
  newDocument: newDoc,
  url,
  openUrl
} = createRoot(() =>
  createDocumentStore<SharedState>({
    repo,
    url: `${document.location.hash.substring(1)}`,
    initialValue: {
      notes: [],
      instrument: 24,
      bpm: 140,
      get date() {
        return serializeDate()
      }
    }
  })
)

const [urls, setUrls] = makePersisted(createSignal<Record<string, number>>({}))

export { urls }

createRoot(() => {
  createEffect(() => {
    document.location.hash = url()
  })
  createEffect(() => {
    if (doc().date && doc().notes.length > 0) {
      setUrls(urls => ({
        ...urls,
        [url()]: doc().date
      }))
    }
  })
})

// WebMidi

const [midiOutputChannel, setMidiOutputChannel] = createSignal<OutputChannel>()

WebMidi.enable()
  .then(function () {
    console.log('enabled!', WebMidi.inputs, WebMidi.outputs)
    // Inputs
    WebMidi.inputs.forEach(input => console.log(input.manufacturer, input.name))

    // Outputs
    WebMidi.outputs.forEach(output => console.log(output.manufacturer, output.name))
    setMidiOutputChannel(WebMidi.outputs[0].channels[1])
  })
  .catch(err => alert(err))

// Initialise local state

export let audioContext: AudioContext | undefined
export let player: Instruments | undefined
export let playedNotes = new Set<NoteData>()

export const [mode, setMode] = createSignal<Mode>('note')
export const [dimensions, setDimensions] = createSignal<DOMRect>()

// Grid size
export const [timeScale, setTimeScale] = createSignal(1)

// Select-related state
export const [selectedNotes, setSelectedNotes] = createSignal<Array<NoteData>>([])
export const [selectionArea, setSelectionArea] = createSignal<SelectionArea>()
export const [selectionPresence, setSelectionPresence] = createSignal<Vector>()
export const [clipboard, setClipboard] = createSignal<Array<NoteData>>()

// Play-related state
export const [playing, setPlaying] = createSignal(false)
export const [internalTimeOffset, setInternalTimeOffset] = createSignal(0)
export const [playingNotes, setPlayingNotes] = createStore<Array<NoteData>>([])
export const [now, setNow] = createSignal(0)
export const [loop, setLoop] = createStore<Loop>({ time: 0, duration: 4 })
export const [volume, setVolume] = createSignal(10)

// Projection
export const [origin, setOrigin] = createSignal<Vector>({ x: 0, y: 6 * HEIGHT * 12 })
export const [zoom, setZoom] = createSignal({ x: 1, y: 1 })

export const projectedWidth = () => WIDTH * zoom().x
export const projectedHeight = () => HEIGHT * zoom().y
export const projectedOrigin = createMemo(() => {
  return {
    x: WIDTH + origin().x * zoom().x,
    y: origin().y * zoom().y
  }
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
    x: Math.floor(value.x / projectedWidth() / timeScale()) * timeScale(),
    y: Math.floor(value.y / projectedHeight())
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
  } else setInternalTimeOffset(audioContext.currentTime * VELOCITY - now())
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
    // NOTE: later commit should use GainNode to change volume
    note.velocity * (volume() / 10), // velocity
    delay, // delay
    note.duration / VELOCITY, // duration
    0, // (optional - specify channel for tinysynth to use)
    0.05 // (optional - override envelope "attack" parameter)
  )

  const _midiOutputChannel = midiOutputChannel()
  if (_midiOutputChannel) {
    _midiOutputChannel.playNote(note.pitch, {
      duration: (note.duration / (doc().bpm / 60)) * 1000 - 100,
      time: `+${delay * 1000}`
    })
  }

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
    x: event.layerX - projectedOrigin().x,
    y: event.layerY - projectedOrigin().y
  }

  const note: NoteData = {
    id: zeptoid(),
    active: true,
    duration: timeScale(),
    pitch: Math.floor(-absolutePosition.y / projectedHeight()) + 1,
    time: Math.floor(absolutePosition.x / projectedWidth() / timeScale()) * timeScale(),
    velocity: 1
  }

  setDoc(doc => {
    doc.notes.push(note)
    // notes.sort((a, b) => (a.time < b.time ? -1 : 1))
  })

  const initialTime = note.time
  const initialDuration = note.duration
  const offset = absolutePosition.x - initialTime * projectedWidth()

  setSelectedNotes([note])

  await pointerHelper(event, ({ delta }) => {
    const deltaX = Math.floor((offset + delta.x) / projectedWidth() / timeScale()) * timeScale()
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

export async function handleSelectionBox(event: PointerEvent & { currentTarget: SVGElement }) {
  const offset = event.currentTarget.getBoundingClientRect().left
  const position = {
    x: event.clientX - projectedOrigin().x - offset,
    y: event.clientY - projectedOrigin().y
  }
  const normalizedPosition = normalizeVector(position)
  setSelectionArea({
    start: normalizedPosition,
    end: {
      x: normalizedPosition.x + timeScale() * zoom().x,
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
      x: initialOrigin.x + delta.x / zoom().x,
      y: initialOrigin.y + delta.y / zoom().y
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
