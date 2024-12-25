import clsx from 'clsx'
import MidiWriter from 'midi-writer-js'
import {
  batch,
  createContext,
  createEffect,
  createSelector,
  createSignal,
  For,
  Index,
  mapArray,
  on,
  onCleanup,
  onMount,
  Show,
  useContext
} from 'solid-js'
import { createStore, produce, SetStoreFunction } from 'solid-js/store'
import Instruments from 'webaudio-instruments'
import zeptoid from 'zeptoid'
import './App.css'
import styles from './App.module.css'
import { pointerHelper } from './pointer-helper'

interface Vector {
  x: number
  y: number
}
interface NoteData {
  pitch: number
  time: number
  duration: number
  active: boolean
  id: string
  _remove?: boolean
  _duration?: number
}
interface SelectionArea {
  start: Vector
  end: Vector
}
interface Loop {
  time: number
  duration: number
}
type Mode = 'note' | 'select' | 'pan' | 'stretch'

function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

const KEY_COLORS = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1].reverse()
const HEIGHT = 20
const WIDTH = 60
const MARGIN = 2

function createMidiDataUri(notes: Array<NoteData>) {
  const track = new MidiWriter.Track()
  const division = 8

  notes.forEach(note => {
    track.addEvent(
      new MidiWriter.NoteEvent({
        pitch: [MidiWriter.Utils.getPitch(note.pitch)],
        duration: Array.from({ length: note.duration }).fill(division),
        startTick: note.time * (512 / division),
        velocity: 100
      })
    )
  })

  const write = new MidiWriter.Writer(track)
  return write.dataUri()
}

function downloadDataUri(dataUri: string, filename: string) {
  const link = document.createElement('a')
  link.href = dataUri
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function Piano() {
  const context = usePiano()
  return (
    <>
      <rect width={WIDTH} height={context.dimensions.height} fill="var(--color-piano-white)" />
      <g style={{ transform: `translateY(${mod(-context.origin.y, HEIGHT) * -1}px)` }}>
        <Index each={new Array(Math.floor(context.dimensions.height / HEIGHT) + 2)}>
          {(_, index) => (
            <>
              <rect
                y={index * HEIGHT}
                x={0}
                width={WIDTH}
                height={HEIGHT}
                style={{
                  fill: KEY_COLORS[
                    mod(index + Math.floor(-context.origin.y / HEIGHT), KEY_COLORS.length)
                  ]
                    ? 'none'
                    : 'var(--color-piano-black)'
                }}
              />
            </>
          )}
        </Index>
      </g>
    </>
  )
}

function Ruler(props: { setLoop: SetStoreFunction<Loop>; loop: Loop }) {
  const context = usePiano()
  return (
    <>
      <rect
        x={0}
        y={0}
        width={context.dimensions.width}
        height={HEIGHT}
        fill="var(--color-piano-black)"
        onPointerDown={event => {
          event.stopPropagation()

          const absolutePosition = {
            x: event.layerX - context.origin.x,
            y: event.layerY - context.origin.y
          }

          const loop = {
            time: Math.floor(absolutePosition.x / WIDTH),
            duration: 1
          }

          props.setLoop(loop)

          const initialTime = loop.time
          const initialDuration = loop.duration
          const offset = absolutePosition.x - initialTime * WIDTH

          pointerHelper(event, ({ delta }) => {
            const deltaX = Math.floor((offset + delta.x) / WIDTH)
            if (deltaX < 0) {
              props.setLoop('time', initialTime + deltaX)
              props.setLoop('duration', 1 - deltaX)
            } else if (deltaX > 0) {
              props.setLoop('duration', initialDuration + deltaX)
            } else {
              props.setLoop('time', initialTime)
              props.setLoop('duration', 1)
            }
          })
        }}
      />
      <Show when={props.loop}>
        {loop => (
          <rect
            x={loop().time * WIDTH}
            y={0}
            width={loop().duration * WIDTH}
            height={HEIGHT}
            fill="var(--color-loop)"
            style={{ transform: `translateX(${context.origin.x}px)` }}
            onPointerDown={e => {
              e.stopPropagation()
              e.preventDefault()

              const { width, left } = e.target.getBoundingClientRect()

              const initialTime = loop().time
              const initialDuration = loop().duration

              if (e.clientX < left + WIDTH / 3) {
                const offset = e.layerX - initialTime * WIDTH - context.origin.x

                pointerHelper(e, ({ delta }) => {
                  const deltaX = Math.floor((delta.x + offset) / WIDTH)
                  if (deltaX >= initialDuration) {
                    props.setLoop('duration', deltaX - initialDuration + 2)
                  } else {
                    const time = initialTime + deltaX
                    props.setLoop('time', time)
                    props.setLoop('duration', initialDuration - deltaX)
                  }
                })
              } else if (e.layerX > left + width - WIDTH / 3) {
                pointerHelper(e, ({ delta }) => {
                  const duration =
                    Math.floor((e.layerX - context.origin.x + delta.x) / WIDTH) - initialTime

                  if (duration > 0) {
                    props.setLoop('duration', 1 + duration)
                  } else if (duration < 0) {
                    props.setLoop('duration', 1 - duration)
                    props.setLoop('time', initialTime + duration)
                  } else {
                    props.setLoop('time', initialTime)
                    props.setLoop('duration', 1)
                  }
                })
              } else {
                pointerHelper(e, ({ delta }) => {
                  const deltaX = Math.floor((delta.x + WIDTH / 2) / WIDTH)
                  const time = initialTime + deltaX
                  props.setLoop('time', time)
                })
              }
            }}
          />
        )}
      </Show>
      <line
        x1={0}
        x2={context.dimensions.width}
        y1={HEIGHT}
        y2={HEIGHT}
        stroke="var(--color-stroke)"
      />

      <g style={{ transform: `translateX(${context.origin.x % (WIDTH * 8)}px)` }}>
        <Index each={new Array(Math.floor(context.dimensions.width / WIDTH / 8) + 2)}>
          {(_, index) => (
            <line
              y1={0}
              y2={HEIGHT}
              x1={index * WIDTH * 8}
              x2={index * WIDTH * 8}
              stroke="var(--color-stroke)"
              stroke-width="2px"
            />
          )}
        </Index>
      </g>
      <g style={{ transform: `translateX(${context.origin.x % WIDTH}px)` }}>
        <Index each={new Array(Math.floor(context.dimensions.width / WIDTH) + 2)}>
          {(_, index) => (
            <line
              y1={0}
              y2={HEIGHT}
              x1={index * WIDTH}
              x2={index * WIDTH}
              stroke="var(--color-stroke)"
              stroke-width="1px"
            />
          )}
        </Index>
      </g>
    </>
  )
}

function Grid() {
  const context = usePiano()
  return (
    <>
      <g style={{ transform: `translateX(${context.origin.x % WIDTH}px)` }}>
        <Index each={new Array(Math.floor(context.dimensions.width / WIDTH) + 2)}>
          {(_, index) => (
            <line
              y1={0}
              y2={context.dimensions.height}
              x1={index * WIDTH}
              x2={index * WIDTH}
              stroke="var(--color-stroke-secondary)"
            />
          )}
        </Index>
      </g>
      <g style={{ transform: `translateX(${context.origin.x % (WIDTH * 8)}px)` }}>
        <Index each={new Array(Math.floor(context.dimensions.width / WIDTH / 8) + 2)}>
          {(_, index) => (
            <line
              y1={0}
              y2={context.dimensions.height}
              x1={index * WIDTH * 8}
              x2={index * WIDTH * 8}
              stroke="var(--color-stroke)"
              stroke-width="2px"
            />
          )}
        </Index>
      </g>
      {/* <g style={{ transform: `translateY(${mod(-context.origin.y, HEIGHT) * -1}px)` }}>
        <Index each={new Array(Math.floor(context.dimensions.height / HEIGHT) + 1)}>
          {(_, index) => (
            <line
              y1={index * HEIGHT}
              y2={index * HEIGHT}
              x1={0}
              x2={context.dimensions.width}
              stroke="var(--color-stroke)"
              stroke-width={
                mod(index + Math.floor(-context.origin.y / HEIGHT), KEY_COLORS.length) === 0
                  ? '2px'
                  : '1px'
              }
            />
          )}
        </Index>
      </g> */}
    </>
  )
}

const pianoContext = createContext<{
  dimensions: DOMRect
  origin: Vector
  mode: Mode
}>()
function usePiano() {
  const context = useContext(pianoContext)
  if (!context) {
    throw `PianoContext is undefined.`
  }
  return context
}

function App() {
  const [mode, setMode] = createSignal<Mode>('note')
  const [dimensions, setDimensions] = createSignal<DOMRect>()
  const [origin, setOrigin] = createSignal<Vector>({ x: WIDTH, y: 6 * HEIGHT * 12 })
  // Select-related state
  const [selectedNotes, setSelectedNotes] = createSignal<Array<NoteData>>([])
  const [selectionArea, setSelectionArea] = createSignal<SelectionArea>()
  const [selectionPresence, setSelectionPresence] = createSignal<Vector>()
  const [clipboard, setClipboard] = createSignal<Array<NoteData>>()
  // Playing related state
  const [instrument, setInstrument] = createSignal(24)
  const [loop, setLoop] = createStore<Loop>({
    time: 0,
    duration: 4
  })
  const [now, setNow] = createSignal(0)
  const [playing, setPlaying] = createSignal(false)
  const [notes, setNotes] = createStore<Array<NoteData>>([])

  const velocity = 4
  let audioContext: AudioContext | undefined
  let player: Instruments | undefined
  let offset = 0
  let playedNotes = new Set<NoteData>()

  function normalize(value: Vector) {
    return {
      x: Math.floor(value.x / WIDTH),
      y: Math.floor(value.y / HEIGHT)
    }
  }

  function selectNotesFromSelectionArea(area: SelectionArea) {
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

  const isNoteSelected = createSelector(
    selectedNotes,
    (note: NoteData, notes) => !!notes.find(_note => _note.id === note.id)
  )

  function play() {
    if (!audioContext) {
      audioContext = new AudioContext()
    } else offset = audioContext.currentTime * velocity - now()
    setPlaying(true)
  }

  function togglePlaying() {
    if (!playing()) {
      play()
    } else {
      setPlaying(false)
    }
  }

  async function handleNote(event: PointerEvent) {
    const absolutePosition = {
      x: event.layerX - origin().x,
      y: event.layerY - origin().y
    }

    const note = {
      id: zeptoid(),
      active: true,
      duration: 1,
      pitch: Math.floor(-absolutePosition.y / HEIGHT) + 1,
      time: Math.floor(absolutePosition.x / WIDTH)
    }

    playNote(note.pitch, note.duration)

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

    await pointerHelper(event, ({ delta }) => {
      const deltaX = Math.floor((offset + delta.x) / WIDTH)
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
          duration: 1
        })
      }
    })

    clipOverlappingNotes(note)
  }

  async function handleSelectionBox(event: PointerEvent) {
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

  async function handlePan(event: PointerEvent) {
    const initialOrigin = { ...origin() }
    await pointerHelper(event, ({ delta }) => {
      setOrigin({
        x: initialOrigin.x + delta.x,
        y: initialOrigin.y + delta.y
      })
    })
  }

  function sortNotes() {
    setNotes(produce(notes => notes.sort((a, b) => (a.time < b.time ? -1 : 1))))
  }

  function copyNotes() {
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

  function pasteNotes(position: Vector) {
    const newNotes = clipboard()!.map(note => ({
      ...note,
      time: note.time + position.x,
      id: zeptoid()
    }))
    setNotes(
      produce(notes => {
        notes.push(...newNotes)
      })
    )
    clipOverlappingNotes(...newNotes)
  }

  function clipOverlappingNotes(...sources: Array<NoteData>) {
    batch(() => {
      setNotes(
        produce(notes => {
          notes.forEach(note => {
            // Remove temporary values
            delete note._duration
            delete note._remove
          })
        })
      )

      // Remove all notes that are
      // - intersecting with source and
      // - come after source
      const isIntersectingAndAfterSource = ({ id, time, pitch }: NoteData) =>
        sources.find(
          source =>
            source.pitch === pitch &&
            id !== source.id &&
            source.time < time &&
            source.time + source.duration > time
        )
      setNotes(notes =>
        notes.filter(note => {
          if (isIntersectingAndAfterSource(note)) {
            return false
          }
          return true
        })
      )
      // Clip all notes that are
      // - intersecting with source and
      // - come before source
      const isIntersectingAndBeforeSource = ({ id, time, duration, pitch }: NoteData) =>
        sources.find(
          source =>
            source.pitch === pitch &&
            id !== source.id &&
            source.time >= time &&
            source.time <= time + duration
        )
      setNotes(
        produce(notes =>
          notes.forEach((note, index) => {
            const source = isIntersectingAndBeforeSource(note)
            if (source) {
              notes[index].duration = source.time - note.time
            }
          })
        )
      )
    })
  }

  function markOverlappingNotes(...sources: Array<NoteData>) {
    batch(() => {
      // Remove all notes that are
      // - intersecting with source and
      // - come after source
      const isIntersectingAndAfterSource = ({ id, time, pitch }: NoteData) =>
        sources.find(
          source =>
            source.pitch === pitch &&
            id !== source.id &&
            source.time < time &&
            source.time + source.duration > time
        )
      setNotes(
        produce(notes =>
          notes.forEach(note => {
            if (isIntersectingAndAfterSource(note)) {
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
      const isIntersectingAndBeforeSource = ({ id, time, duration, pitch }: NoteData) =>
        sources.find(
          source =>
            source.pitch === pitch &&
            id !== source.id &&
            source.time >= time &&
            source.time <= time + duration
        )
      setNotes(
        produce(notes =>
          notes.forEach((note, index) => {
            const source = isIntersectingAndBeforeSource(note)
            if (source) {
              notes[index]._duration = source.time - note.time
            } else {
              delete notes[index]._duration
            }
          })
        )
      )
    })
  }

  function playNote(pitch: number, duration: number) {
    if (!player) {
      player = new Instruments()
    }
    player.play(
      instrument(), // instrument: 24 is "Acoustic Guitar (nylon)"
      pitch, // note: midi number or frequency in Hz (if > 127)
      1, // velocity: 0..1
      0, // delay in seconds
      duration / velocity, // duration in seconds
      0, // (optional - specify channel for tinysynth to use)
      0.05 // (optional - override envelope "attack" parameter)
    )
  }

  // Audio Loop
  createEffect(
    on(playing, playing => {
      if (!playing || !audioContext) return

      let shouldPlay = true

      function clock() {
        if (!shouldPlay) return
        let time = audioContext!.currentTime * velocity - offset

        if (loop) {
          if (time < loop.time) {
            playedNotes.clear()
            time = loop.time
            offset = audioContext!.currentTime * velocity - loop.time
          } else if (time > loop.time + loop.duration) {
            playedNotes.clear()
            offset = audioContext!.currentTime * velocity - loop.time
            clock()
            return
          }
        }

        const now = Math.floor(time)
        setNow(now)

        notes.forEach(note => {
          if (note.active && note.time === now && !playedNotes.has(note)) {
            playedNotes.add(note)
            playNote(note.pitch, note.duration)
          }
        })

        requestAnimationFrame(clock)
      }
      clock()
      onCleanup(() => (shouldPlay = false))
    })
  )

  onMount(() => {
    window.addEventListener('keydown', e => {
      if (e.code === 'Space') {
        togglePlaying()
      } else if (mode() === 'select') {
        if (e.code === 'KeyC' && (e.ctrlKey || e.metaKey)) {
          copyNotes()
        } else if (e.code === 'KeyV' && (e.ctrlKey || e.metaKey)) {
          const presence = selectionPresence()
          if (presence) {
            pasteNotes(presence)
          }
        }
      }
    })
  })

  createEffect(() => {
    if (mode() !== 'select') {
      setSelectedNotes([])
      setSelectionPresence()
    }
  })

  createEffect(
    mapArray(
      () => notes,
      note => {
        createEffect(() => {
          if (isNoteSelected(note)) {
            playNote(note.pitch, note.duration)
          }
        })
        createEffect(
          on(
            () => note.pitch,
            pitch => {
              playNote(pitch, note.duration)
            }
          )
        )
      }
    )
  )

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <div
        class={styles.topHud}
        style={{
          top: `${HEIGHT}px`,
          gap: '5px'
        }}
      >
        <div>
          <button
            class={mode() === 'note' ? styles.active : undefined}
            onClick={() => setMode('note')}
          >
            <IconGrommetIconsMusic />
          </button>
          <button
            class={mode() === 'pan' ? styles.active : undefined}
            onClick={() => setMode('pan')}
          >
            <IconGrommetIconsPan />
          </button>
          <button
            class={mode() === 'select' ? styles.active : undefined}
            onClick={() => setMode('select')}
          >
            <IconGrommetIconsSelect />
          </button>
          <button
            class={mode() === 'stretch' ? styles.active : undefined}
            onClick={() => setMode('stretch')}
          >
            <IconGrommetIconsShift />
          </button>
        </div>
        <Show when={selectedNotes().length > 0}>
          <div>
            <button class={mode() === 'stretch' ? styles.active : undefined} onClick={copyNotes}>
              <IconGrommetIconsClipboard />
            </button>
            <button
              class={mode() === 'stretch' ? styles.active : undefined}
              onClick={() => {
                let inactiveSelectedNotes = 0
                selectedNotes().forEach(note => {
                  if (!note.active) {
                    inactiveSelectedNotes++
                  }
                })

                const shouldActivate = inactiveSelectedNotes > selectedNotes().length / 2

                selectedNotes().forEach(selectedNote => {
                  setNotes(note => note.id === selectedNote.id, 'active', shouldActivate)
                })
              }}
            >
              <IconGrommetIconsDisabledOutline />
            </button>
            <button
              class={mode() === 'stretch' ? styles.active : undefined}
              onClick={() => {
                setNotes(notes.filter(note => !isNoteSelected(note)))
                setSelectedNotes([])
              }}
            >
              <IconGrommetIconsErase />
            </button>
          </div>
        </Show>
        <Show when={mode() === 'note'}>
          <div>
            <button
              onClick={() => {
                const selection = notes.filter(
                  note => note.time >= loop.time && note.time < loop.time + loop.duration
                )
                setNotes(
                  produce(notes => {
                    notes.push(
                      ...selection.map(note => ({
                        ...note,
                        id: zeptoid(),
                        time: note.time + loop.duration
                      }))
                    )
                  })
                )
                setLoop('duration', duration => duration * 2)
              }}
            >
              <IconGrommetIconsDuplicate />
            </button>
          </div>
        </Show>
        {/*  <Show when={selectedNotes().length > 0}>
          <div
            style={{
              display: 'grid',
              'grid-template-rows': `${HEIGHT * 2 - 2}px`
            }}
          >
            <button
              class={mode() === 'stretch' ? styles.active : undefined}
              onClick={() => {
                const loop = {
                  start: Infinity,
                  end: -Infinity
                }
                selectedNotes().forEach(note => {
                  if (note.time < loop.start) {
                    loop.start = note.time
                  }
                  if (note.time + note.duration > loop.end) {
                    loop.end = note.time + note.duration
                  }
                })
                setLoop({
                  time: loop.start,
                  duration: loop.end - loop.start
                })
              }}
            >
              <IconGrommetIconsCycle />
            </button>
          </div>
        </Show> */}
        <Show when={mode() === 'select' && clipboard() && selectionPresence()}>
          {presence => (
            <div
              style={{
                display: 'grid',
                'grid-template-rows': `${HEIGHT * 2 - 2}px`
              }}
            >
              <button
                class={mode() === 'stretch' ? styles.active : undefined}
                onClick={() => pasteNotes(presence())}
              >
                <IconGrommetIconsCopy />
              </button>
            </div>
          )}
        </Show>
      </div>
      <div class={styles.bottomHud}>
        <div>
          <div
            style={{
              display: 'flex',
              width: '90px',
              'justify-content': 'space-evenly',
              'padding-top': '5px',
              'padding-bottom': '5px'
            }}
          >
            <button
              onClick={() => {
                if (instrument() > 0) {
                  setInstrument(instrument => instrument - 1)
                } else {
                  setInstrument(174)
                }
              }}
            >
              <IconGrommetIconsFormPreviousLink />
            </button>
            {instrument()}
            <button
              onClick={() => {
                if (instrument() >= 174) {
                  setInstrument(0)
                } else {
                  setInstrument(instrument => instrument + 1)
                }
              }}
            >
              <IconGrommetIconsFormNextLink />
            </button>
          </div>
        </div>
        <div>
          <button
            style={{ 'padding-top': '5px', 'padding-bottom': '5px' }}
            onClick={() => {
              setNotes([])
              setNow(0)
            }}
          >
            <IconGrommetIconsSave />
          </button>
          <button
            style={{ 'padding-top': '5px', 'padding-bottom': '5px' }}
            onClick={() => {
              setNotes([])
              setNow(0)
            }}
          >
            <IconGrommetIconsDocument />
          </button>
          <button
            style={{ 'padding-top': '5px', 'padding-bottom': '5px' }}
            onClick={() => downloadDataUri(createMidiDataUri(notes), 'pianissimo.mid')}
          >
            <IconGrommetIconsShare />
          </button>
        </div>
        <div>
          <button
            style={{ 'padding-top': '5px', 'padding-bottom': '5px' }}
            onClick={() => {
              setNow(loop.time)
              setPlaying(false)
              playedNotes.clear()
            }}
          >
            <IconGrommetIconsStop />
          </button>
          <button style={{ 'padding-top': '5px', 'padding-bottom': '5px' }} onClick={togglePlaying}>
            {!playing() ? <IconGrommetIconsPlay /> : <IconGrommetIconsPause />}
          </button>
        </div>
      </div>
      <svg
        style={{ width: '100%', height: '100%', overflow: 'hidden' }}
        ref={element => {
          onMount(() => {
            const observer = new ResizeObserver(() => {
              setDimensions(element.getBoundingClientRect())
            })
            observer.observe(element)
            onCleanup(() => observer.disconnect())
          })
        }}
        onWheel={event =>
          setOrigin(origin => ({
            x: origin.x - event.deltaX,
            y: origin.y - (event.deltaY * 2) / 3
          }))
        }
        onPointerDown={async event => {
          switch (mode()) {
            case 'note':
              handleNote(event)
              break
            case 'select':
              handleSelectionBox(event)
              break
            case 'pan':
              handlePan(event)
          }
        }}
      >
        <Show when={dimensions()}>
          {dimensions => (
            <pianoContext.Provider
              value={{
                get dimensions() {
                  return dimensions()
                },
                get origin() {
                  return origin()
                },
                get mode() {
                  return mode()
                }
              }}
            >
              {/* Piano underlay */}
              <g style={{ transform: `translateY(${-mod(-origin().y, HEIGHT)}px)` }}>
                <Index each={new Array(Math.floor(dimensions().height / HEIGHT) + 2)}>
                  {(_, index) => (
                    <rect
                      y={index * HEIGHT}
                      width={dimensions().width}
                      height={HEIGHT}
                      style={{
                        'pointer-events': 'none',
                        fill: KEY_COLORS[
                          mod(index + Math.floor(-origin().y / HEIGHT), KEY_COLORS.length)
                        ]
                          ? 'none'
                          : 'var(--color-piano-underlay)'
                      }}
                    />
                  )}
                </Index>
              </g>
              <Grid />
              {/* Selection Area */}
              <Show when={mode() === 'select' && selectionArea()}>
                {area => (
                  <rect
                    x={area().start.x * WIDTH + origin().x}
                    y={area().start.y * HEIGHT + origin().y}
                    width={(area().end.x - area().start.x + 1) * WIDTH}
                    height={(area().end.y - area().start.y + 1) * HEIGHT}
                    opacity={0.3}
                    fill="var(--color-selection-area)"
                  />
                )}
              </Show>
              {/* Selection Area */}
              <Show when={mode() === 'select' && selectionPresence()}>
                {presence => (
                  <rect
                    x={presence().x * WIDTH + origin().x}
                    y={presence().y * HEIGHT + origin().y}
                    width={(presence().x - presence().x + 1) * WIDTH}
                    height={(presence().y - presence().y + 1) * HEIGHT}
                    opacity={0.8}
                    fill="var(--color-selection-area)"
                  />
                )}
              </Show>
              {/* Notes */}
              <Show when={notes.length > 0}>
                <g style={{ transform: `translate(${origin().x}px, ${origin().y}px)` }}>
                  <For each={notes}>
                    {(note, index) => {
                      const setNote: ReturnType<typeof createStore<typeof note>>[1] = (
                        ...args: any[]
                      ) =>
                        setNotes(
                          _note => _note.id === note.id,
                          // @ts-ignore
                          ...args
                        )
                      return (
                        <rect
                          class={clsx(styles.note, isNoteSelected(note) && styles.selected)}
                          x={note.time * WIDTH + MARGIN}
                          y={-note.pitch * HEIGHT + MARGIN}
                          width={(note._duration ?? note.duration) * WIDTH - MARGIN * 2}
                          height={HEIGHT - MARGIN * 2}
                          opacity={!note._remove && note.active ? 1 : 0.25}
                          onDblClick={() => {
                            if (mode() === 'note') {
                              setNotes(produce(notes => notes.splice(index(), 1)))
                            }
                          }}
                          onPointerDown={async e => {
                            const { left } = e.target.getBoundingClientRect()
                            switch (mode()) {
                              case 'select': {
                                if (isNoteSelected(note)) {
                                  e.stopPropagation()
                                  e.preventDefault()
                                  if (selectedNotes().length > 0) {
                                    const initialNotes = Object.fromEntries(
                                      selectedNotes().map(note => [
                                        note.id,
                                        {
                                          time: note.time,
                                          pitch: note.pitch
                                        }
                                      ])
                                    )
                                    const { delta } = await pointerHelper(e, ({ delta }) => {
                                      setNotes(
                                        isNoteSelected,
                                        produce(note => {
                                          note.time =
                                            initialNotes[note.id].time +
                                            Math.floor((delta.x + WIDTH / 2) / WIDTH)
                                          note.pitch =
                                            initialNotes[note.id].pitch -
                                            Math.floor((delta.y + HEIGHT / 2) / HEIGHT)
                                        })
                                      )
                                      markOverlappingNotes(...selectedNotes())
                                    })
                                    if (Math.floor((delta.x + WIDTH / 2) / WIDTH) !== 0) {
                                      sortNotes()
                                    }
                                    clipOverlappingNotes(...selectedNotes())
                                  }
                                }
                                return
                              }
                              case 'stretch': {
                                e.stopPropagation()
                                e.preventDefault()
                                const initialTime = note.time
                                const initialDuration = note.duration

                                // NOTE: it irks me that the 2 implementations aren't symmetrical
                                if (e.clientX < left + (WIDTH * note.duration) / 2) {
                                  const offset = e.layerX - initialTime * WIDTH - origin().x
                                  const { delta } = await pointerHelper(e, ({ delta }) => {
                                    const deltaX = Math.floor((delta.x + offset) / WIDTH)
                                    if (deltaX >= initialDuration) {
                                      setNote('duration', deltaX - initialDuration + 2)
                                    } else {
                                      const time = initialTime + deltaX
                                      setNote({ time, duration: initialDuration - deltaX })
                                    }
                                    markOverlappingNotes(note)
                                  })
                                  if (Math.floor((delta.x + WIDTH / 2) / WIDTH) !== 0) {
                                    clipOverlappingNotes(note)
                                    sortNotes()
                                  }
                                } else {
                                  await pointerHelper(e, ({ delta }) => {
                                    const duration =
                                      Math.floor((e.layerX - origin().x + delta.x) / WIDTH) -
                                      initialTime

                                    if (duration > 0) {
                                      setNote('duration', 1 + duration)
                                    } else if (duration < 0) {
                                      setNote({
                                        duration: 1 - duration,
                                        time: initialTime + duration
                                      })
                                    } else {
                                      setNote({
                                        time: initialTime,
                                        duration: 1
                                      })
                                    }
                                    markOverlappingNotes(note)
                                  })
                                }
                                clipOverlappingNotes(note)
                                return
                              }
                              case 'note': {
                                e.stopPropagation()
                                e.preventDefault()
                                const initialTime = note.time
                                const initialPitch = note.pitch
                                let previousTime = initialTime
                                setSelectedNotes([note])
                                await pointerHelper(e, ({ delta }) => {
                                  const deltaX = Math.floor((delta.x + WIDTH / 2) / WIDTH)
                                  const time = initialTime + deltaX
                                  const pitch =
                                    initialPitch - Math.floor((delta.y + HEIGHT / 2) / HEIGHT)
                                  setNote({ time, pitch })

                                  if (previousTime !== time) {
                                    sortNotes()
                                    previousTime = time
                                  }

                                  markOverlappingNotes(note)
                                })
                                setSelectedNotes([])
                                clipOverlappingNotes(note)
                              }
                            }
                          }}
                        />
                      )
                    }}
                  </For>
                </g>
              </Show>
              <Ruler loop={loop} setLoop={setLoop} />
              {/* Now Indicator */}
              <rect
                class={styles.now}
                width={WIDTH}
                height={dimensions().height}
                fill="var(--color-stroke)"
                style={{
                  transform: `translateX(${origin().x + now() * WIDTH}px)`
                }}
              />
              <Piano />
            </pianoContext.Provider>
          )}
        </Show>
      </svg>
    </div>
  )
}

export default App
