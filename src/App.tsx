import {
  createEffect,
  createSignal,
  For,
  Index,
  on,
  onCleanup,
  onMount,
  Show,
  untrack
} from 'solid-js'
import { createStore, produce, unwrap } from 'solid-js/store'
import Instruments from 'webaudio-instruments'
import './App.css'
import { pointerHelper } from './pointer-helper'

type Vector = { x: number; y: number }
interface NoteData {
  pitch: number
  time: number
  duration: number
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

const KEY_COLORS = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1]
const HEIGHT = 20
const WIDTH = 60

function Note(props: { note: NoteData; sortNotes: () => void; deleteNote: () => void }) {
  const [note, setNote] = createStore(props.note)
  return (
    <rect
      x={note.time * WIDTH}
      y={-note.pitch * HEIGHT}
      width={note.duration * WIDTH}
      height={HEIGHT}
      fill="blue"
      onDblClick={props.deleteNote}
      onPointerDown={e => {
        e.stopPropagation()

        const { width, left } = e.target.getBoundingClientRect()

        const originalTime = note.time
        const originalDuration = note.duration
        const originalPitch = note.pitch

        let previous = originalTime

        if (e.clientX < left + WIDTH / 3) {
          pointerHelper(e, ({ delta }) => {
            const deltaX = Math.floor((delta.x + WIDTH / 2) / WIDTH)
            let previous = originalTime
            if (deltaX >= originalDuration) {
              setNote('duration', deltaX - originalDuration + 1)
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
            const time = Math.floor((e.layerX + delta.x) / WIDTH) - originalTime
            if (time > 0) {
              setNote('duration', 1 + time)
            } else if (time < 0) {
              setNote('duration', 1 - time)
              setNote('time', originalTime + time)
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
    <Index each={new Array(Math.floor(props.dimensions.height / HEIGHT) + 2)}>
      {(_, index) => (
        <rect
          y={index * HEIGHT - mod(-props.origin.y, HEIGHT)}
          x={0}
          width={WIDTH}
          height={HEIGHT}
          style={{
            stroke: 'black',
            fill: KEY_COLORS[mod(index + Math.floor(-props.origin.y / HEIGHT), KEY_COLORS.length)]
              ? 'white'
              : 'black'
          }}
        />
      )}
    </Index>
  )
}

function Grid(props: { dimensions: DOMRect; origin: Vector }) {
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
              style={{ stroke: 'black' }}
            />
          )}
        </Index>
      </g>
      <g style={{ transform: `translateY(${props.origin.y % HEIGHT}px)` }}>
        <Index each={new Array(Math.floor(props.dimensions.height / HEIGHT) + 1)}>
          {(_, index) => (
            <line
              y1={index * HEIGHT}
              y2={index * HEIGHT}
              x1={0}
              x2={props.dimensions.width}
              style={{ stroke: 'black' }}
            />
          )}
        </Index>
      </g>
    </>
  )
}

function App() {
  const [notes, setNotes] = createStore<
    Array<{
      pitch: number
      time: number
      duration: number
    }>
  >([])

  const [dimensions, setDimensions] = createSignal<DOMRect>()
  const [origin, setOrigin] = createSignal<Vector>({ x: 0, y: 0 })

  const [now, setNow] = createSignal(0)
  const [playing, setPlaying] = createSignal(false)
  const [audioContext, setAudioContext] = createSignal<AudioContext>()
  const velocity = 4
  let offset = 0

  let playedNotes = new Set<NoteData>()
  var player = new Instruments()

  createEffect(
    on(playing, playing => {
      const ctx = audioContext()
      if (!playing || !ctx) return
      let previous = untrack(now)
      let shouldPlay = true
      function clock() {
        if (!shouldPlay) return
        const time = ctx!.currentTime * velocity - offset
        if (previous !== Math.floor(time)) {
          const now = Math.floor(time)
          setNow(now)
          const notesToPlay = notes.filter(note => note.time === now && !playedNotes.has(note))

          notesToPlay.forEach(note => playedNotes.add(note))

          notesToPlay.forEach(note => {
            player.play(
              24, // instrument: 24 is "Acoustic Guitar (nylon)"
              72 + note.pitch, // note: midi number or frequency in Hz (if > 127)
              1, // velocity: 0..1
              0, // delay in seconds
              note.duration / velocity, // duration in seconds
              0, // (optional - specify channel for tinysynth to use)
              0.05 // (optional - override envelope "attack" parameter)
            )
          })
        }

        requestAnimationFrame(clock)
      }
      clock()
      onCleanup(() => (shouldPlay = false))
    })
  )

  function toggle() {
    if (!playing()) {
      const ctx = audioContext()
      if (!ctx) setAudioContext(new AudioContext())
      else offset = ctx.currentTime * velocity - now()
      setPlaying(true)
    } else {
      setPlaying(false)
    }
  }

  function resetTime() {
    setNow(0)
    playedNotes.clear()
    const ctx = audioContext()
    if (ctx) {
      offset = ctx.currentTime * velocity
    }
  }

  function onWheel(e: WheelEvent) {
    setOrigin(origin => ({
      x: origin.x - e.deltaX,
      y: origin.y - (e.deltaY * 2) / 3
    }))
  }

  function project(position: Vector) {
    return {
      x: position.x - origin().x,
      y: position.y - origin().y
    }
  }

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
        <button onClick={resetTime}>reset time</button>
        <button onClick={toggle}>{!playing() ? 'play' : 'pause'}</button>
      </div>
      <svg
        style={{ width: '100%', height: '100%', overflow: 'hidden' }}
        ref={element => {
          onMount(() => {
            const observer = new ResizeObserver(() => {
              setDimensions(element.getBoundingClientRect())
            })
            observer.observe(element)
          })
        }}
        onWheel={onWheel}
        onPointerDown={event => {
          const absolutePosition = project({
            x: event.layerX,
            y: event.layerY
          })

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
          pointerHelper(event, ({ delta }) => {
            if (delta.x < 0) {
              setNotes(index, 'time', originalTime + Math.floor(delta.x / WIDTH) + 1)
              setNotes(index, 'duration', Math.floor(delta.x / WIDTH) + 1)
            } else {
              setNotes(index, 'duration', Math.floor(delta.x / WIDTH) + 1)
            }
          })
        }}
      >
        <Show when={dimensions()}>
          {dimensions => (
            <>
              <Grid dimensions={dimensions()} origin={origin()} />
              <rect
                x={(now() + 1) * WIDTH}
                y={0}
                width={WIDTH}
                height={dimensions().height}
                fill="black"
                style={{ opacity: 0.1, transform: `translateX(${origin().x}px)` }}
              />
              <g style={{ transform: `translate(${origin().x}px, ${origin().y}px)` }}>
                <For each={notes}>
                  {(note, index) => (
                    <Note
                      note={note}
                      sortNotes={() =>
                        setNotes(produce(notes => notes.sort((a, b) => (a.time < b.time ? -1 : 1))))
                      }
                      deleteNote={() => {
                        setNotes(produce(notes => notes.splice(index(), 1)))
                      }}
                    />
                  )}
                </For>
              </g>
              <Piano dimensions={dimensions()} origin={origin()} />
            </>
          )}
        </Show>
      </svg>
    </div>
  )
}

export default App
