import { createEffect, createSignal, For, Index, on, onCleanup, onMount, Show } from 'solid-js'
import { createStore, produce, SetStoreFunction, unwrap } from 'solid-js/store'
import Instruments from 'webaudio-instruments'
import './App.css'
import { pointerHelper } from './pointer-helper'

type Vector = { x: number; y: number }
interface NoteData {
  pitch: number
  time: number
  duration: number
}

interface Loop {
  time: number
  duration: number
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

const KEY_COLORS = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1].reverse()
const HEIGHT = 20
const WIDTH = 60
const MARGIN = 2

function Note(props: {
  note: NoteData
  sortNotes: () => void
  deleteNote: () => void
  origin: Vector
}) {
  const [note, setNote] = createStore(props.note)
  return (
    <rect
      x={note.time * WIDTH + MARGIN}
      y={-note.pitch * HEIGHT + MARGIN}
      width={note.duration * WIDTH - MARGIN * 2}
      height={HEIGHT - MARGIN * 2}
      fill="var(--color-note)"
      onDblClick={props.deleteNote}
      onPointerDown={e => {
        e.stopPropagation()
        e.preventDefault()

        const { width, left } = e.target.getBoundingClientRect()

        const originalTime = note.time
        const originalDuration = note.duration
        const originalPitch = note.pitch

        let previous = originalTime

        if (e.clientX < left + WIDTH / 3) {
          const offset = e.layerX - originalTime * WIDTH - props.origin.x

          let previous = originalTime
          pointerHelper(e, ({ delta }) => {
            const deltaX = Math.floor((delta.x + offset) / WIDTH)
            if (deltaX >= originalDuration) {
              setNote('duration', deltaX - originalDuration + 2)
            } else {
              const time = originalTime + deltaX
              setNote('time', time)
              setNote('duration', originalDuration - deltaX)
              if (previous !== time) {
                props.sortNotes()
                previous = time
              }
            }
          })
        } else if (e.layerX > left + width - WIDTH / 3) {
          pointerHelper(e, ({ delta }) => {
            const duration =
              Math.floor((e.layerX - props.origin.x + delta.x) / WIDTH) - originalTime

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
            setNote('pitch', originalPitch - Math.floor((delta.y + HEIGHT / 2) / HEIGHT))
            if (previous !== time) {
              props.sortNotes()
              previous = time
            }
          })
        }
      }}
    />
  )
}

function Piano(props: { dimensions: DOMRect; origin: Vector }) {
  return (
    <g style={{ transform: `translateY(${mod(-props.origin.y, HEIGHT) * -1}px)` }}>
      <Index each={new Array(Math.floor(props.dimensions.height / HEIGHT) + 2)}>
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
                  mod(index + Math.floor(-props.origin.y / HEIGHT), KEY_COLORS.length)
                ]
                  ? 'white'
                  : 'var(--color-keys)'
              }}
            />
            <line
              y1={index * HEIGHT}
              y2={index * HEIGHT}
              x1={0}
              x2={WIDTH}
              stroke="var(--color-stroke)"
              stroke-width={
                mod(index + Math.floor(-props.origin.y / HEIGHT), KEY_COLORS.length) === 0
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

function Ruler(props: {
  dimensions: DOMRect
  origin: Vector
  setLoop: SetStoreFunction<Loop>
  loop: Loop
}) {
  return (
    <>
      <rect
        x={0}
        y={0}
        width={props.dimensions.width}
        height={HEIGHT}
        fill="var(--color-keys)"
        onPointerDown={event => {
          event.stopPropagation()

          const absolutePosition = {
            x: event.layerX - props.origin.x,
            y: event.layerY - props.origin.y
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
            style={{ transform: `translateX(${props.origin.x}px)` }}
            onPointerDown={e => {
              e.stopPropagation()
              e.preventDefault()

              const { width, left } = e.target.getBoundingClientRect()

              const originalTime = loop().time
              const originalDuration = loop().duration

              if (e.clientX < left + WIDTH / 3) {
                const offset = e.layerX - originalTime * WIDTH - props.origin.x

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
                    Math.floor((e.layerX - props.origin.x + delta.x) / WIDTH) - originalTime

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
        x2={props.dimensions.width}
        y1={HEIGHT}
        y2={HEIGHT}
        stroke="var(--color-stroke)"
      />

      <g style={{ transform: `translateX(${props.origin.x % (WIDTH * 4)}px)` }}>
        <Index each={new Array(Math.floor(props.dimensions.width / WIDTH / 4) + 2)}>
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
      <g style={{ transform: `translateX(${props.origin.x % WIDTH}px)` }}>
        <Index each={new Array(Math.floor(props.dimensions.width / WIDTH) + 2)}>
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

function Grid(props: { origin: Vector; dimensions: DOMRect }) {
  return (
    <>
      <g style={{ transform: `translateX(${props.origin.x % WIDTH}px)` }}>
        <Index each={new Array(Math.floor(props.dimensions.width / WIDTH) + 2)}>
          {(_, index) => (
            <line
              y1={0}
              y2={props.dimensions.height}
              x1={index * WIDTH}
              x2={index * WIDTH}
              stroke="var(--color-stroke)"
            />
          )}
        </Index>
      </g>
      <g style={{ transform: `translateX(${props.origin.x % (WIDTH * 4)}px)` }}>
        <Index each={new Array(Math.floor(props.dimensions.width / WIDTH / 4) + 2)}>
          {(_, index) => (
            <line
              y1={0}
              y2={props.dimensions.height}
              x1={index * WIDTH * 4}
              x2={index * WIDTH * 4}
              stroke="var(--color-stroke)"
              stroke-width="2px"
            />
          )}
        </Index>
      </g>
      <g style={{ transform: `translateY(${mod(-props.origin.y, HEIGHT) * -1}px)` }}>
        <Index each={new Array(Math.floor(props.dimensions.height / HEIGHT) + 1)}>
          {(_, index) => (
            <line
              y1={index * HEIGHT}
              y2={index * HEIGHT}
              x1={0}
              x2={props.dimensions.width}
              stroke="var(--color-stroke)"
              stroke-width={
                mod(index + Math.floor(-props.origin.y / HEIGHT), KEY_COLORS.length) === 0
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

function App() {
  let instrument = 24
  const [notes, setNotes] = createStore<
    Array<{
      pitch: number
      time: number
      duration: number
    }>
  >([])

  const [dimensions, setDimensions] = createSignal<DOMRect>()
  const [origin, setOrigin] = createSignal<Vector>({ x: WIDTH, y: 0 })
  const [loop, setLoop] = createStore<Loop>({
    time: 0,
    duration: 4
  })

  const [now, setNow] = createSignal(0)
  const [playing, setPlaying] = createSignal(false)
  let audioContext: AudioContext | undefined
  let player: Instruments

  const velocity = 4
  let offset = 0

  let playedNotes = new Set<NoteData>()

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
              instrument, // instrument: 24 is "Acoustic Guitar (nylon)"
              72 + note.pitch, // note: midi number or frequency in Hz (if > 127)
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

  function togglePlaying() {
    if (!playing()) {
      if (!audioContext) {
        audioContext = new AudioContext()
        player = new Instruments()
      } else offset = audioContext.currentTime * velocity - now()
      setPlaying(true)
    } else {
      setPlaying(false)
    }
  }

  onMount(() => {
    window.addEventListener('keydown', e => {
      if (e.code === 'Space') {
        togglePlaying()
      }
    })
  })

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <div
        style={{
          position: 'fixed',
          right: '0px',
          bottom: '0px',
          margin: `${HEIGHT}px`,
          display: 'flex',
          'flex-direction': 'column',
          gap: '5px'
        }}
      >
        <button onClick={() => setNotes([])}>clear</button>
        <div style={{ display: 'flex', gap: '5px' }}>
          <button
            onClick={() => {
              if (instrument > 0) {
                instrument--
              } else {
                instrument = 174
              }
            }}
          >
            {'<'}
          </button>
          <button
            onClick={() => {
              if (instrument >= 174) {
                instrument = 0
              } else {
                instrument++
              }
            }}
          >
            {'>'}
          </button>
        </div>
        <button onClick={togglePlaying}>{!playing() ? 'play' : 'pause'}</button>
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
        onPointerDown={event => {
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
        }}
      >
        <Show when={dimensions()}>
          {dimensions => (
            <>
              <Grid dimensions={dimensions()} origin={origin()} />
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
                        opacity: 0.1,
                        fill: KEY_COLORS[
                          mod(index + Math.floor(-origin().y / HEIGHT), KEY_COLORS.length)
                        ]
                          ? 'transparent'
                          : 'var(--color-keys)'
                      }}
                    />
                  )}
                </Index>
              </g>
              {/* Notes */}
              <Show when={notes.length > 0}>
                <g style={{ transform: `translate(${origin().x}px, ${origin().y}px)` }}>
                  <For each={notes}>
                    {(note, index) => (
                      <Note
                        origin={origin()}
                        note={note}
                        sortNotes={() => {
                          setNotes(
                            produce(notes => notes.sort((a, b) => (a.time < b.time ? -1 : 1)))
                          )
                        }}
                        deleteNote={() => {
                          setNotes(produce(notes => notes.splice(index(), 1)))
                        }}
                      />
                    )}
                  </For>
                </g>
              </Show>
              <Ruler dimensions={dimensions()} origin={origin()} loop={loop} setLoop={setLoop} />
              {/* Now */}
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
              <Piano dimensions={dimensions()} origin={origin()} />
            </>
          )}
        </Show>
      </svg>
    </div>
  )
}

export default App
