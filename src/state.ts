import { Repo } from '@automerge/automerge-repo'
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket'
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb'
import { makePersisted } from '@solid-primitives/storage'
import {
  batch,
  createEffect,
  createMemo,
  createResource,
  createRoot,
  createSelector,
  createSignal
} from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import Instruments from 'webaudio-instruments'
import { Output, WebMidi } from 'webmidi'
import zeptoid from 'zeptoid'
import { Loop, Mode, NoteData, SelectionArea, SharedState, Vector } from './types'
import { createDocumentStore } from './utils/create-document-store'
import { pointerHelper } from './utils/pointer-helper'

/**********************************************************************************/
/*                                                                                */
/*                                    Constants                                   */
/*                                                                                */
/**********************************************************************************/

export const KEY_COLORS = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1].reverse()
export const HEIGHT = 20
export const WIDTH = 60
export const MARGIN = 2
export const VELOCITY = 4

/**********************************************************************************/
/*                                                                                */
/*                                 Automerge State                                */
/*                                                                                */
/**********************************************************************************/

export const repo = new Repo({
  network: [new BrowserWebSocketClientAdapter('wss://sync.cyberspatialstudies.org')],
  storage: new IndexedDBStorageAdapter()
})
export const doc = createRoot(() =>
  createDocumentStore<SharedState>({
    repo,
    url: `${document.location.hash.substring(1)}`,
    initialValue: {
      notes: {},
      instrument: 24,
      bpm: 140,
      get date() {
        return serializeDate()
      }
    }
  })
)
export const [savedDocumentUrls, setSavedDocumentUrls] = makePersisted(
  createSignal<Record<string, number>>({})
)

// Set hash to current handle-url and save it to local-storage.
createRoot(() => {
  createEffect(() => {
    document.location.hash = doc.url()
  })
  createEffect(() => {
    if (doc.get().date && Object.keys(doc.get().notes).length > 0) {
      setSavedDocumentUrls(urls => ({
        ...urls,
        [doc.url()]: doc.get().date
      }))
    }
  })
})

// Utils
export function serializeDate(): number {
  return Number(
    new Date()
      .toISOString()
      .replace(/[-:TZ]/g, '')
      .slice(0, 17)
      .padEnd(18, '0') // Add zeros for milliseconds
  )
}
export function deserializeDate(serialized: number): string {
  const str = serialized.toString().padStart(18, '0')
  return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}-${str.slice(8, 10)}-${str.slice(10, 12)}-${str.slice(12, 14)}-${str.slice(14)}`
}

/**********************************************************************************/
/*                                                                                */
/*                                      State                                     */
/*                                                                                */
/**********************************************************************************/

export let audioContext: AudioContext | undefined
export let player: Instruments | undefined
export let playedNotes = new Set<NoteData>()

export const [mode, setMode] = createSignal<Mode>('note')
export const [dimensions, setDimensions] = createSignal<DOMRect>()
export const [timeScale, setTimeScale] = createSignal(1)

// Select-related state
export const [selectedNotes, setSelectedNotes] = createSignal<Array<NoteData>>([])
export const [selectionArea, setSelectionArea] = createSignal<SelectionArea>()
export const [selectionPresence, setSelectionPresence] = createSignal<Vector>()
export const [clipboard, setClipboard] = createSignal<Array<NoteData>>()
export const [selectionLocked, setSelectionLocked] = createSignal<boolean>(false)

// Play-related state
export const [playing, setPlaying] = createSignal(false)
export const [internalTimeOffset, setInternalTimeOffset] = createSignal(0)
export const [playingNotes, setPlayingNotes] = createStore<Array<NoteData>>([])
export const [now, setNow] = createSignal(0)
export const [loop, setLoop] = createStore<Loop>({ time: 0, duration: 4 })
export const [volume, setVolume] = createSignal(10)

// Projection state
export const [origin, setOrigin] = createSignal<Vector>({ x: 0, y: 6 * HEIGHT * 12 })
const [_zoom, _setZoom] = createSignal({ x: 100, y: 100 })
export const zoom = createMemo(() => ({ x: _zoom().x / 100, y: _zoom().y / 100 }))
export const setZoom = _setZoom

export const projectedWidth = () => WIDTH * zoom().x
export const projectedHeight = () => HEIGHT * zoom().y
export const projectedOriginX = () => WIDTH + origin().x * zoom().x
export const projectedOriginY = () => origin().y * zoom().y
export const timeScaleWidth = () => projectedWidth() * timeScale()

// WebMidi state
export const [midiOutputEnabled, setMidiOutputEnabled] = createSignal(false)
export const [midiOutputs] = createResource(midiOutputEnabled, async () => {
  await WebMidi.enable()
  return WebMidi.outputs
})
export const [selectedMidiOutputs, setSelectedMidiOutputs] = createSignal<Array<Output>>([])

/**********************************************************************************/
/*                                                                                */
/*                                    Selectors                                   */
/*                                                                                */
/**********************************************************************************/

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

/**********************************************************************************/
/*                                                                                */
/*                                     Actions                                    */
/*                                                                                */
/**********************************************************************************/

function normalizeVector(value: Vector) {
  return {
    x: Math.floor(value.x / timeScaleWidth()) * timeScale(),
    y: Math.floor(value.y / projectedHeight())
  }
}

export function filterNote(...notes: Array<NoteData>) {
  return ({ id }: NoteData) => !!notes.find(note => note.id === id)
}

export function selectNotesFromSelectionArea(area: SelectionArea) {
  setSelectedNotes(
    Object.values(doc.get().notes).filter(note => {
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
    doc.get().instrument, // instrument: 24 is "Acoustic Guitar (nylon)"
    note.pitch, // note: midi number or frequency in Hz (if > 127)
    // NOTE: later commit should use GainNode to change volume
    note.velocity * (volume() / 10), // velocity
    delay, // delay
    note.duration / (doc.get().bpm / 60), // duration
    0, // (optional - specify channel for tinysynth to use)
    0.05 // (optional - override envelope "attack" parameter)
  )

  selectedMidiOutputs().forEach(output => {
    output.playNote(note.pitch, {
      duration: (note.duration / (doc.get().bpm / 60)) * 1000 - 100,
      time: `+${delay * 1000}`
    })
  })

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
    x: event.layerX - projectedOriginX(),
    y: event.layerY - projectedOriginY()
  }

  const note: NoteData = {
    id: zeptoid(),
    active: true,
    duration: timeScale(),
    pitch: Math.floor(-absolutePosition.y / projectedHeight()) + 1,
    time: Math.floor(absolutePosition.x / timeScaleWidth()) * timeScale(),
    velocity: 1
  }

  await doc.branch(async update => {
    update(doc => {
      doc.notes[note.id] = note
    })

    const initialTime = note.time
    const initialDuration = note.duration
    const offset = absolutePosition.x - initialTime * projectedWidth()

    setSelectedNotes([note])

    await pointerHelper(event, ({ delta }) => {
      const deltaX = Math.floor((offset + delta.x) / timeScaleWidth()) * timeScale()
      if (deltaX < 0) {
        update(({ notes }) => {
          if (!notes[note.id]) return
          notes[note.id].time = initialTime + deltaX
          notes[note.id].duration = 1 - deltaX
        })
      } else if (deltaX > 0) {
        update(({ notes }) => {
          if (!notes[note.id]) return
          notes[note.id].duration = initialDuration + deltaX
        })
      } else {
        update(({ notes }) => {
          if (!notes[note.id]) return
          notes[note.id].time = initialTime
          notes[note.id].duration = timeScale()
        })
      }
      // markOverlappingNotes(note)
    })
  })

  setSelectedNotes([])
  // clipOverlappingNotes(note)
}

export async function handleErase(event: PointerEvent & { currentTarget: SVGElement }) {
  await handleSelectionArea(event)
  doc.set(doc => {
    for (const id in doc.notes) {
      if (isNoteSelected(doc.notes[id])) {
        delete doc.notes[id]
      }
    }
  })
  setSelectedNotes([])
  setSelectionArea()
  setSelectionPresence()
}

export async function handleSnip(event: PointerEvent & { currentTarget: SVGElement }) {
  await handleSelectionArea(event)

  const cutLine = selectionArea()?.start.x

  if (!cutLine) {
    console.error('Attempting to slice without slice-line')
    return
  }

  const newNotes = selectedNotes()
    .filter(note => note.time < selectionArea()!.start.x)
    .map(note => {
      return {
        id: zeptoid(),
        active: true,
        duration: note.duration - (cutLine - note.time),
        pitch: note.pitch,
        time: cutLine,
        velocity: note.velocity
      } satisfies NoteData
    })

  doc.set(doc => {
    newNotes.forEach(note => {
      doc.notes[note.id] = note
    })
    Object.values(doc.notes).forEach(note => {
      if (isNoteSelected(note) && note.time < cutLine) {
        note.duration = cutLine - note.time
      }
    })
  })

  setSelectedNotes(notes => [...notes, ...newNotes])
  setSelectedNotes([])
  setSelectionArea()
  setSelectionPresence()
}

export async function handleSelectionArea(event: PointerEvent & { currentTarget: SVGElement }) {
  const offset = event.currentTarget.getBoundingClientRect().left
  const position = {
    x: event.clientX - projectedOriginX() - offset,
    y: event.clientY - projectedOriginY()
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

  return selectionArea()!
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

export async function handleDragSelectedNotes(event: PointerEvent) {
  event.stopPropagation()
  event.preventDefault()

  selectedNotes().sort((a, b) => (a.time < b.time ? -1 : 1))

  if (selectedNotes().length > 0) {
    const offset = selectedNotes()[0].time % timeScale()
    const initialNotes = Object.fromEntries(
      selectedNotes().map(note => [
        note.id,
        {
          time: note.time,
          pitch: note.pitch
        }
      ])
    )

    await doc.branch(update =>
      pointerHelper(event, ({ delta }) => {
        let time = Math.floor(delta.x / timeScaleWidth()) * timeScale()

        if (time === timeScale() * -1) {
          time = 0
        } else if (time < timeScale() * -1) {
          time = time + timeScale()
        }

        update(doc => {
          Object.values(doc.notes).forEach(note => {
            if (isNoteSelected(note)) {
              note.time = initialNotes[note.id].time + time - offset
              note.pitch =
                initialNotes[note.id].pitch -
                Math.floor((delta.y + projectedHeight() / 2) / projectedHeight())
            }
          })
        })
        // markOverlappingNotes(...selectedNotes())
      })
    )

    // clipOverlappingNotes(...selectedNotes())
  }
}

export async function handleStretchSelectedNotes(
  event: PointerEvent & {
    currentTarget: SVGElement
  }
) {
  event.stopPropagation()
  event.preventDefault()

  const initialSelectedNotes = Object.fromEntries(
    selectedNotes().map(note => [note.id, { ...note }])
  )

  await doc.branch(update =>
    pointerHelper(event, ({ delta }) => {
      let deltaX =
        Math.floor(
          delta.x < 0
            ? (delta.x + timeScaleWidth() * 0.5) / timeScaleWidth()
            : delta.x / timeScaleWidth()
        ) * timeScale()
      update(doc => {
        selectedNotes().forEach(({ id }) => {
          const note = doc.notes[id]

          const duration = initialSelectedNotes[note.id].duration + deltaX
          if (duration > timeScale()) {
            note.duration = duration
          } else {
            note.time = initialSelectedNotes[note.id].time
            note.duration = timeScale()
          }
        })
      })
      //markOverlappingNotes(...selectedNotes())
    })
  )

  // clipOverlappingNotes(...selectedNotes())
  if (selectedNotes().length === 1) {
    setSelectedNotes([])
  }
}

export async function handleVelocitySelectedNotes(event: PointerEvent) {
  event.preventDefault()
  event.stopPropagation()

  await doc.branch(async update => {
    const initialNotes = Object.fromEntries(selectedNotes().map(note => [note.id, { ...note }]))
    await pointerHelper(event, ({ delta }) => {
      update(doc => {
        Object.values(doc.notes).forEach(note => {
          if (!note.active) {
            note.active = true
          }
          if (note.id in initialNotes) {
            note.velocity = Math.min(1, Math.max(0, initialNotes[note.id].velocity - delta.y / 100))
          }
        })
      })
    })
  })
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
      note =>
        !Object.values(doc.get().notes).find(
          ({ pitch, time }) => note.pitch === pitch && note.time === time
        )
    )
  doc.set(doc => {
    newNotes.forEach(note => {
      doc.notes[note.id] = note
    })
  })
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
  doc.set(doc => {
    for (const id in doc.notes) {
      const note = doc.notes[id]
      if (findSourceIntersectingAndBeforeNote(sources, note)) {
        delete doc.notes[id]
      }
    }
  })

  // Clip all notes that are
  // - intersecting with source and
  // - come before source
  doc.set(doc => {
    for (const id in doc.notes) {
      const note = doc.notes[id]
      const source = findSourceIntersectingAndAfterNote(sources, note)
      if (source) {
        const newDuration = source.time - note.time
        if (newDuration === 0) {
          delete doc.notes[id]
        } else {
          doc.notes[id].duration = source.time - note.time
        }
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
        doc.set(doc => {
          Object.values(doc.notes).forEach(_note => {
            if (_note.id === note.id) {
              _note.duration = source.time - note.time
            }
          })
        })
      }
      break
    }
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
    doc.set(doc =>
      Object.values(doc.notes).forEach(note => {
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
    doc.set(doc =>
      Object.values(doc.notes).forEach((note, index) => {
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
          doc.set(doc => {
            Object.values(doc.notes).forEach(note => {
              if (note.id === source.id) {
                note._duration = sources[index + 1].time - source.time
              }
            })
          })

          break
        }
        doc.set(doc => {
          Object.values(doc.notes).forEach(note => {
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
