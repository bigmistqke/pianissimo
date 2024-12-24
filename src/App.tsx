import clsx from 'clsx'
import MidiWriter from 'midi-writer-js'
import {
  createContext,
  createEffect,
  createSelector,
  createSignal,
  For,
  Index,
  on,
  onCleanup,
  onMount,
  Show,
  useContext
} from 'solid-js'
import { createStore, produce, SetStoreFunction, unwrap } from 'solid-js/store'
import Instruments from 'webaudio-instruments'
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
}
interface SelectionBoxData {
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
                stroke: 'var(--color-stroke)',
                fill: KEY_COLORS[
                  mod(index + Math.floor(-context.origin.y / HEIGHT), KEY_COLORS.length)
                ]
                  ? 'white'
                  : 'var(--color-piano)'
              }}
            />
            <line
              y1={index * HEIGHT}
              y2={index * HEIGHT}
              x1={0}
              x2={WIDTH}
              stroke="var(--color-stroke)"
              stroke-width={
                mod(index + Math.floor(-context.origin.y / HEIGHT), KEY_COLORS.length) === 0
                  ? '2px'
                  : '1px'
              }
            />
          </>
        )}
      </Index>
    </g>
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
        fill="var(--color-piano)"
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

          const originalTime = loop.time
          const originalDuration = loop.duration
          const offset = absolutePosition.x - originalTime * WIDTH

          pointerHelper(event, ({ delta }) => {
            const deltaX = Math.floor((offset + delta.x) / WIDTH)
            if (deltaX < 0) {
              props.setLoop('time', originalTime + deltaX)
              props.setLoop('duration', 1 - deltaX)
            } else if (deltaX > 0) {
              props.setLoop('duration', originalDuration + deltaX)
            } else {
              props.setLoop('time', originalTime)
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

              const originalTime = loop().time
              const originalDuration = loop().duration

              if (e.clientX < left + WIDTH / 3) {
                const offset = e.layerX - originalTime * WIDTH - context.origin.x

                pointerHelper(e, ({ delta }) => {
                  const deltaX = Math.floor((delta.x + offset) / WIDTH)
                  if (deltaX >= originalDuration) {
                    props.setLoop('duration', deltaX - originalDuration + 2)
                  } else {
                    const time = originalTime + deltaX
                    props.setLoop('time', time)
                    props.setLoop('duration', originalDuration - deltaX)
                  }
                })
              } else if (e.layerX > left + width - WIDTH / 3) {
                pointerHelper(e, ({ delta }) => {
                  const duration =
                    Math.floor((e.layerX - context.origin.x + delta.x) / WIDTH) - originalTime

                  if (duration > 0) {
                    props.setLoop('duration', 1 + duration)
                  } else if (duration < 0) {
                    props.setLoop('duration', 1 - duration)
                    props.setLoop('time', originalTime + duration)
                  } else {
                    props.setLoop('time', originalTime)
                    props.setLoop('duration', 1)
                  }
                })
              } else {
                pointerHelper(e, ({ delta }) => {
                  const deltaX = Math.floor((delta.x + WIDTH / 2) / WIDTH)
                  const time = originalTime + deltaX
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

      <g style={{ transform: `translateX(${context.origin.x % (WIDTH * 4)}px)` }}>
        <Index each={new Array(Math.floor(context.dimensions.width / WIDTH / 4) + 2)}>
          {(_, index) => (
            <line
              y1={0}
              y2={HEIGHT}
              x1={index * WIDTH * 4}
              x2={index * WIDTH * 4}
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
              stroke="var(--color-stroke)"
            />
          )}
        </Index>
      </g>
      <g style={{ transform: `translateX(${context.origin.x % (WIDTH * 4)}px)` }}>
        <Index each={new Array(Math.floor(context.dimensions.width / WIDTH / 4) + 2)}>
          {(_, index) => (
            <line
              y1={0}
              y2={context.dimensions.height}
              x1={index * WIDTH * 4}
              x2={index * WIDTH * 4}
              stroke="var(--color-stroke)"
              stroke-width="2px"
            />
          )}
        </Index>
      </g>
      <g style={{ transform: `translateY(${mod(-context.origin.y, HEIGHT) * -1}px)` }}>
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
      </g>
    </>
  )
}

function SelectionBox(props: {
  selectionBox?: SelectionBoxData
  stroke?: string
  fill?: string
  opacity?: number
}) {
  const context = usePiano()
  return (
    <Show when={props.selectionBox}>
      {box => (
        <rect
          x={box().start.x + context.origin.x}
          y={box().start.y + context.origin.y}
          width={Math.abs(box().end.x - box().start.x)}
          height={Math.abs(box().end.y - box().start.y)}
          stroke={props.stroke ?? 'none'}
          fill={props.fill ?? 'none'}
          opacity={props.opacity}
        />
      )}
    </Show>
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
  const [dimensions, setDimensions] = createSignal<DOMRect>()
  const [instrument, setInstrument] = createSignal(24)
  const [loop, setLoop] = createStore<Loop>({
    time: 0,
    duration: 4
  })
  const [mode, setMode] = createSignal<Mode>('note')
  const [now, setNow] = createSignal(0)
  const [origin, setOrigin] = createSignal<Vector>({ x: WIDTH, y: 8 * HEIGHT * 12 })
  const [playing, setPlaying] = createSignal(false)
  const [selectedNotes, setSelectedNotes] = createSignal<Array<NoteData>>([])
  const [selectionBox, setSelectionBox] = createSignal<SelectionBoxData | undefined>(undefined)

  const [notes, setNotes] = createStore<
    Array<{
      pitch: number
      time: number
      duration: number
    }>
  >([])

  const velocity = 4
  let audioContext: AudioContext | undefined
  let player: Instruments
  let offset = 0
  let playedNotes = new Set<NoteData>()

  function normalize(value: Vector) {
    return {
      x: Math.floor(value.x / WIDTH),
      y: Math.floor(value.y / HEIGHT)
    }
  }

  function selectNotesFromSelectionBox(box: SelectionBoxData) {
    const start = normalize(box.start)
    const end = normalize(box.end)

    setSelectedNotes(
      notes.filter(note => {
        const noteStartTime = note.time
        const noteEndTime = note.time + note.duration
        const isWithinXBounds = noteStartTime < end.x && noteEndTime > start.x
        const isWithinYBounds = -note.pitch > start.y && -note.pitch < end.y
        return isWithinXBounds && isWithinYBounds
      })
    )
  }

  const isNoteSelected = createSelector(
    selectedNotes,
    (note: NoteData, notes) => !!notes?.includes(note)
  )

  function play() {
    if (!audioContext) {
      audioContext = new AudioContext()
      player = new Instruments()
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

  function handleNote(event: PointerEvent) {
    const absolutePosition = {
      x: event.layerX - origin().x,
      y: event.layerY - origin().y
    }

    const note = {
      time: Math.floor(absolutePosition.x / WIDTH),
      pitch: Math.floor(-absolutePosition.y / HEIGHT) + 1,
      duration: 1
    }

    setNotes(
      produce(notes => {
        notes.push(note)
        notes.sort((a, b) => (a.time < b.time ? -1 : 1))
      })
    )

    const index = unwrap(notes).findIndex(_note => note === _note)

    const originalTime = note.time
    const originalDuration = note.duration
    const offset = absolutePosition.x - originalTime * WIDTH

    pointerHelper(event, ({ delta }) => {
      const deltaX = Math.floor((offset + delta.x) / WIDTH)
      if (deltaX < 0) {
        setNotes(index, 'time', originalTime + deltaX)
        setNotes(index, 'duration', 1 - deltaX)
      } else if (deltaX > 0) {
        setNotes(index, 'duration', originalDuration + deltaX)
      } else {
        setNotes(index, 'time', originalTime)
        setNotes(index, 'duration', 1)
      }
    })
  }

  async function handleSelectionBox(event: PointerEvent) {
    const position = {
      x: event.clientX - origin().x,
      y: event.clientY - origin().y
    }
    await pointerHelper(event, ({ delta }) => {
      const box = {
        start: {
          x: delta.x < 0 ? position.x + delta.x : position.x,
          y: delta.y < 0 ? position.y + delta.y : position.y
        },
        end: {
          x: delta.x > 0 ? position.x + delta.x : position.x,
          y: delta.y > 0 ? position.y + delta.y : position.y
        }
      }
      setSelectionBox(box)
      selectNotesFromSelectionBox(box)
    })
    setSelectionBox()
  }

  function sortNotes() {
    setNotes(produce(notes => notes.sort((a, b) => (a.time < b.time ? -1 : 1))))
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
          if (note.time === now && !playedNotes.has(note)) {
            playedNotes.add(note)
            player.play(
              instrument(), // instrument: 24 is "Acoustic Guitar (nylon)"
              note.pitch, // note: midi number or frequency in Hz (if > 127)
              1, // velocity: 0..1
              0, // delay in seconds
              note.duration / velocity, // duration in seconds
              0, // (optional - specify channel for tinysynth to use)
              0.05 // (optional - override envelope "attack" parameter)
            )
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
      }
    })
  })

  createEffect(() => {
    if (mode() !== 'select') {
      setSelectedNotes([])
    }
  })

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <div
        class={styles.topHud}
        style={{
          top: `${HEIGHT}px`,
          'grid-template-rows': `${HEIGHT * 2 - 2}px 1px ${HEIGHT * 2 - 2}px 1px ${
            HEIGHT * 2 - 2
          }px 1px ${HEIGHT * 2 - 2}px`
        }}
      >
        <button
          class={clsx(styles.button, mode() === 'note' && styles.active)}
          onClick={() => setMode('note')}
        >
          <IconGrommetIconsMusic />
        </button>
        <div style={{ background: 'var(--color-stroke)' }} />
        <button
          class={clsx(styles.button, mode() === 'pan' && styles.active)}
          onClick={() => setMode('pan')}
        >
          <IconGrommetIconsPan />
        </button>
        <div style={{ background: 'var(--color-stroke)' }} />
        <button
          class={clsx(styles.button, mode() === 'select' && styles.active)}
          onClick={() => setMode('select')}
        >
          <IconGrommetIconsSelect />
        </button>
        <div style={{ background: 'var(--color-stroke)' }} />
        <button
          class={clsx(styles.button, mode() === 'stretch' && styles.active)}
          onClick={() => setMode('stretch')}
        >
          <IconGrommetIconsShift />
        </button>
      </div>
      <div
        style={{
          position: 'fixed',
          right: '0px',
          bottom: '0px',
          margin: `10px`,
          display: 'grid',
          'grid-template-columns': `${(WIDTH * 3) / 2}px repeat(5, 1px ${WIDTH}px)`,
          background: 'white',
          'border-radius': '3px',
          color: 'var(--color-text)',
          border: '1px solid var(--color-stroke)',
          'text-align': 'center'
        }}
      >
        <div
          style={{
            display: 'flex',
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
        <div style={{ background: 'var(--color-stroke)' }} />
        <button
          style={{ 'padding-top': '5px', 'padding-bottom': '5px' }}
          onClick={() => {
            setNotes([])
            setNow(0)
          }}
        >
          <IconGrommetIconsTrash />
        </button>
        <div style={{ background: 'var(--color-stroke)' }} />
        <button
          style={{ 'padding-top': '5px', 'padding-bottom': '5px' }}
          onClick={() => downloadDataUri(createMidiDataUri(notes), 'pianissimo.mid')}
        >
          <IconGrommetIconsShare />
        </button>
        <div style={{ background: 'var(--color-stroke)' }} />
        <button
          style={{ 'padding-top': '5px', 'padding-bottom': '5px' }}
          onClick={() => {
            const selection = notes.filter(
              note => note.time >= loop.time && note.time < loop.time + loop.duration
            )
            setNotes(
              produce(notes => {
                notes.push(...selection.map(note => ({ ...note, time: note.time + loop.duration })))
              })
            )
            setLoop('duration', duration => duration * 2)
          }}
        >
          <IconGrommetIconsCopy />
        </button>
        <div style={{ background: 'var(--color-stroke)' }} />
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
        <div style={{ background: 'var(--color-stroke)' }} />
        <button style={{ 'padding-top': '5px', 'padding-bottom': '5px' }} onClick={togglePlaying}>
          {!playing() ? <IconGrommetIconsPlay /> : <IconGrommetIconsPause />}
        </button>
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
          if (mode() === 'note') {
            handleNote(event)
          } else if (mode() === 'select') {
            handleSelectionBox(event)
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
              {/* Selection Box Underlay */}
              <SelectionBox
                selectionBox={selectionBox()}
                fill="var(--color-selected)"
                opacity={0.05}
              />
              {/* Notes */}
              <Show when={notes.length > 0}>
                <g style={{ transform: `translate(${origin().x}px, ${origin().y}px)` }}>
                  <For each={notes}>
                    {(note, index) => {
                      const selected = () => isNoteSelected(note)
                      const setNote = createStore(note)[1]
                      return (
                        <rect
                          class={clsx(styles.note, selected() && styles.selected)}
                          x={note.time * WIDTH + MARGIN}
                          y={-note.pitch * HEIGHT + MARGIN}
                          width={note.duration * WIDTH - MARGIN * 2}
                          height={HEIGHT - MARGIN * 2}
                          onDblClick={() => setNotes(produce(notes => notes.splice(index(), 1)))}
                          onPointerDown={async e => {
                            e.stopPropagation()
                            e.preventDefault()

                            const { width, left } = e.target.getBoundingClientRect()

                            switch (mode()) {
                              case 'select': {
                                const notes = selectedNotes().map(note => ({
                                  ...note,
                                  setNote: createStore(note)[1]
                                }))
                                if (notes.length > 0) {
                                  const { delta } = await pointerHelper(e, ({ delta }) => {
                                    notes?.forEach(note => {
                                      note.setNote(
                                        'time',
                                        note.time + Math.floor((delta.x + WIDTH / 2) / WIDTH)
                                      )

                                      note.setNote(
                                        'pitch',
                                        note.pitch - Math.floor((delta.y + HEIGHT / 2) / HEIGHT)
                                      )
                                    })
                                  })
                                  if (Math.floor((delta.x + WIDTH / 2) / WIDTH) !== 0) {
                                    sortNotes()
                                  }
                                } else {
                                  setSelectedNotes([note])
                                }
                                return
                              }
                              case 'note': {
                                const originalTime = note.time
                                const originalDuration = note.duration
                                const originalPitch = note.pitch

                                let previous = originalTime

                                if (e.clientX < left + WIDTH / 3) {
                                  const offset = e.layerX - originalTime * WIDTH - origin().x

                                  const { delta } = await pointerHelper(e, ({ delta }) => {
                                    const deltaX = Math.floor((delta.x + offset) / WIDTH)
                                    if (deltaX >= originalDuration) {
                                      setNote('duration', deltaX - originalDuration + 2)
                                    } else {
                                      const time = originalTime + deltaX
                                      setNote('time', time)
                                      setNote('duration', originalDuration - deltaX)
                                    }
                                  })

                                  if (Math.floor((delta.x + WIDTH / 2) / WIDTH) !== 0) {
                                    sortNotes()
                                  }
                                } else if (e.layerX > left + width - WIDTH / 3) {
                                  pointerHelper(e, ({ delta }) => {
                                    const duration =
                                      Math.floor((e.layerX - origin().x + delta.x) / WIDTH) -
                                      originalTime

                                    if (duration > 0) {
                                      setNote('duration', 1 + duration)
                                    } else if (duration < 0) {
                                      setNote('duration', 1 - duration)
                                      setNote('time', originalTime + duration)
                                    } else {
                                      setNote('time', originalTime)
                                      setNote('duration', 1)
                                    }
                                  })
                                } else {
                                  pointerHelper(e, ({ delta }) => {
                                    const deltaX = Math.floor((delta.x + WIDTH / 2) / WIDTH)
                                    const time = originalTime + deltaX
                                    setNote('time', time)
                                    setNote(
                                      'pitch',
                                      originalPitch - Math.floor((delta.y + HEIGHT / 2) / HEIGHT)
                                    )
                                    if (previous !== time) {
                                      sortNotes()
                                      previous = time
                                    }
                                  })
                                }
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
                width={WIDTH}
                height={dimensions().height}
                fill="var(--color-stroke)"
                style={{
                  opacity: 0.1,
                  transform: `translateX(${origin().x + now() * WIDTH}px)`,
                  'pointer-events': 'none'
                }}
              />
              <Piano />
              {/* Selection Box Overlay */}
              <SelectionBox selectionBox={selectionBox()} stroke="var(--color-selected)" />
            </pianoContext.Provider>
          )}
        </Show>
      </svg>
      <div></div>
    </div>
  )
}

export default App
