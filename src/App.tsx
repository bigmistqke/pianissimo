import clsx from 'clsx'
import MidiWriter from 'midi-writer-js'
import {
  Accessor,
  batch,
  createContext,
  createEffect,
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
import zeptoid from 'zeptoid'
import './App.css'
import styles from './App.module.css'
import {
  audioContext,
  clipboard,
  clipOverlappingNotes,
  copyNotes,
  dimensions,
  handleNote,
  handlePan,
  handleSelectionBox,
  HEIGHT,
  instrument,
  isNoteSelected,
  isPitchPlaying,
  KEY_COLORS,
  loop,
  MARGIN,
  markOverlappingNotes,
  mode,
  notes,
  now,
  origin,
  pasteNotes,
  playedNotes,
  playing,
  playNote,
  selectedNotes,
  selectionArea,
  selectionPresence,
  setDimensions,
  setInstrument,
  setLoop,
  setMode,
  setNotes,
  setNow,
  setOrigin,
  setPlaying,
  setSelectedNotes,
  setSelectionPresence,
  setTimeOffset,
  sortNotes,
  timeOffset,
  togglePlaying,
  VELOCITY,
  WIDTH
} from './state'
import { Loop, NoteData } from './types'
import { downloadDataUri } from './utils/download-data-uri'
import { pointerHelper } from './utils/pointer-helper'

function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

function Note(props: { note: NoteData }) {
  {
    const setNote: ReturnType<typeof createStore<NoteData>>[1] = (...args: any[]) =>
      setNotes(
        _note => _note.id === props.note.id,
        // @ts-ignore
        ...args
      )
    return (
      <rect
        class={clsx(styles.note, isNoteSelected(props.note) && styles.selected)}
        x={props.note.time * WIDTH + MARGIN}
        y={-props.note.pitch * HEIGHT + MARGIN}
        width={(props.note._duration ?? props.note.duration) * WIDTH - MARGIN * 2}
        height={HEIGHT - MARGIN * 2}
        opacity={!props.note._remove && props.note.active ? 1 : 0.25}
        onDblClick={() => {
          if (mode() === 'note') {
            setNotes(notes => notes.filter(note => note.id !== props.note.id))
          }
        }}
        onPointerDown={async e => {
          const { left } = e.target.getBoundingClientRect()
          switch (mode()) {
            case 'select': {
              if (isNoteSelected(props.note)) {
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
                          initialNotes[note.id].time + Math.floor((delta.x + WIDTH / 2) / WIDTH)
                        note.pitch =
                          initialNotes[note.id].pitch - Math.floor((delta.y + HEIGHT / 2) / HEIGHT)
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
              const initialTime = props.note.time
              if (!isNoteSelected(props.note)) {
                setSelectedNotes([props.note])
              }

              const initialSelectedNotes = selectedNotes().map(note => ({
                ...note
              }))

              // NOTE: it irks me that the 2 implementations aren't symmetrical
              if (e.clientX < left + (WIDTH * props.note.duration) / 2) {
                const offset = e.layerX - initialTime * WIDTH - origin().x
                const { delta } = await pointerHelper(e, ({ delta }) => {
                  const deltaX = Math.floor((delta.x + offset) / WIDTH)
                  initialSelectedNotes.forEach(note => {
                    if (deltaX < note.duration) {
                      setNotes(({ id }) => note.id === id, {
                        time: note.time + deltaX,
                        duration: note.duration - deltaX
                      })
                    }
                  })
                  markOverlappingNotes(...selectedNotes())
                })
                if (Math.floor((delta.x + WIDTH / 2) / WIDTH) !== 0) {
                  clipOverlappingNotes(...selectedNotes())
                  sortNotes()
                }
              } else {
                await pointerHelper(e, ({ delta }) => {
                  batch(() => {
                    const scaledDelta = Math.floor((delta.x + WIDTH / 2) / WIDTH)
                    // ...
                    // ... -2 -1 0 1 2 ...
                    const normalizedDelta =
                      scaledDelta > 0 ? scaledDelta : scaledDelta < -1 ? scaledDelta + 1 : 0

                    initialSelectedNotes.forEach(note => {
                      const duration = note.duration + Math.floor(normalizedDelta)

                      if (duration > 1) {
                        setNotes(({ id }) => id === note.id, 'duration', duration)
                      } else {
                        setNotes(({ id }) => id === note.id, {
                          time: note.time,
                          duration: 1
                        })
                      }
                    })
                    markOverlappingNotes(...selectedNotes())
                  })
                })
              }
              clipOverlappingNotes(...selectedNotes())
              if (selectedNotes().length === 1) {
                setSelectedNotes([])
              }
              return
            }
            case 'note': {
              e.stopPropagation()
              e.preventDefault()
              const initialTime = props.note.time
              const initialPitch = props.note.pitch
              let previousTime = initialTime
              setSelectedNotes([props.note])
              await pointerHelper(e, ({ delta }) => {
                const deltaX = Math.floor((delta.x + WIDTH / 2) / WIDTH)
                const time = initialTime + deltaX
                const pitch = initialPitch - Math.floor((delta.y + HEIGHT / 2) / HEIGHT)
                setNote({ time, pitch })

                if (previousTime !== time) {
                  sortNotes()
                  previousTime = time
                }

                markOverlappingNotes(props.note)
              })
              setSelectedNotes([])
              clipOverlappingNotes(props.note)
            }
          }
        }}
      />
    )
  }
}

function Piano() {
  const dimensions = useDimensions()
  return (
    <>
      <rect width={WIDTH} height={dimensions().height} fill="var(--color-piano-white)" />
      <g style={{ transform: `translateY(${mod(-origin().y, HEIGHT) * -1}px)` }}>
        <Index each={new Array(Math.floor(dimensions().height / HEIGHT) + 2)}>
          {(_, index) => (
            <rect
              y={index * HEIGHT}
              x={0}
              width={WIDTH}
              height={HEIGHT}
              style={{
                fill: KEY_COLORS[mod(index + Math.floor(-origin().y / HEIGHT), KEY_COLORS.length)]
                  ? 'none'
                  : 'var(--color-piano-black)'
              }}
            />
          )}
        </Index>
      </g>
    </>
  )
}

function PlayingNotes(props: { isPitchPlaying: (pitch: number) => boolean }) {
  const dimensions = useDimensions()
  return (
    <>
      <g style={{ transform: `translateY(${mod(-origin().y, HEIGHT) * -1}px)` }}>
        <Index each={new Array(Math.floor(dimensions().height / HEIGHT) + 2)}>
          {(_, index) => {
            return (
              <rect
                y={index * HEIGHT}
                x={0}
                width={WIDTH}
                height={HEIGHT}
                opacity={0.8}
                style={{
                  fill: props.isPitchPlaying(-(index + Math.floor(-origin().y / HEIGHT)))
                    ? 'var(--color-note-selected)'
                    : 'none'
                }}
              />
            )
          }}
        </Index>
      </g>
    </>
  )
}

function Ruler(props: { setLoop: SetStoreFunction<Loop>; loop: Loop }) {
  const dimensions = useDimensions()
  return (
    <>
      <rect
        x={0}
        y={0}
        width={dimensions().width}
        height={HEIGHT}
        fill="var(--color-piano-black)"
        onPointerDown={event => {
          event.stopPropagation()

          const absolutePosition = {
            x: event.layerX - origin().x,
            y: event.layerY - origin().y
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
            style={{ transform: `translateX(${origin().x}px)` }}
            onPointerDown={e => {
              e.stopPropagation()
              e.preventDefault()

              const { width, left } = e.target.getBoundingClientRect()

              const initialTime = loop().time
              const initialDuration = loop().duration

              if (e.clientX < left + WIDTH / 3) {
                const offset = e.layerX - initialTime * WIDTH - origin().x

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
                    Math.floor((e.layerX - origin().x + delta.x) / WIDTH) - initialTime

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
      <line x1={0} x2={dimensions().width} y1={HEIGHT} y2={HEIGHT} stroke="var(--color-stroke)" />

      <g style={{ transform: `translateX(${origin().x % (WIDTH * 8)}px)` }}>
        <Index each={new Array(Math.floor(dimensions().width / WIDTH / 8) + 2)}>
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
      <g style={{ transform: `translateX(${origin().x % WIDTH}px)` }}>
        <Index each={new Array(Math.floor(dimensions().width / WIDTH) + 2)}>
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
  const dimensions = useDimensions()
  return (
    <>
      <g style={{ transform: `translateX(${origin().x % WIDTH}px)` }}>
        <Index each={new Array(Math.floor(dimensions().width / WIDTH) + 2)}>
          {(_, index) => (
            <line
              y1={0}
              y2={dimensions().height}
              x1={index * WIDTH}
              x2={index * WIDTH}
              stroke="var(--color-stroke-secondary)"
            />
          )}
        </Index>
      </g>
      <g style={{ transform: `translateX(${origin().x % (WIDTH * 8)}px)` }}>
        <Index each={new Array(Math.floor(dimensions().width / WIDTH / 8) + 2)}>
          {(_, index) => (
            <line
              y1={0}
              y2={dimensions().height}
              x1={index * WIDTH * 8}
              x2={index * WIDTH * 8}
              stroke="var(--color-stroke)"
              stroke-width="2px"
            />
          )}
        </Index>
      </g>
      {/* <g style={{ transform: `translateY(${mod(-origin().y, HEIGHT) * -1}px)` }}>
        <Index each={new Array(Math.floor(context.dimensions.height / HEIGHT) + 1)}>
          {(_, index) => (
            <line
              y1={index * HEIGHT}
              y2={index * HEIGHT}
              x1={0}
              x2={context.dimensions.width}
              stroke="var(--color-stroke)"
              stroke-width={
                mod(index + Math.floor(-origin().y / HEIGHT), KEY_COLORS.length) === 0
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

const dimensionsContext = createContext<Accessor<DOMRect>>()
function useDimensions() {
  const context = useContext(dimensionsContext)
  if (!context) {
    throw `PianoContext is undefined.`
  }
  return context
}

function App() {
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

  createEffect(() => {
    if (mode() !== 'select') {
      setSelectionPresence()
    }
  })

  createEffect(
    mapArray(
      () => notes,
      note => {
        createEffect(
          on(
            () => isNoteSelected(note),
            selected => selected && playNote(note)
          )
        )
        createEffect(
          on(
            () => note.pitch,
            () => playNote(note)
          )
        )
      }
    )
  )

  // Audio Loop
  createEffect(
    on(playing, playing => {
      if (!playing || !audioContext) return

      let shouldPlay = true

      function clock() {
        if (!shouldPlay) return
        let time = audioContext!.currentTime * VELOCITY - timeOffset()

        if (loop) {
          if (time < loop.time) {
            playedNotes.clear()
            time = loop.time
            setTimeOffset(audioContext!.currentTime * VELOCITY - loop.time)
          } else if (time > loop.time + loop.duration) {
            playedNotes.clear()
            setTimeOffset(audioContext!.currentTime * VELOCITY - loop.time)
            clock()
            return
          }
        }

        const now = Math.floor(time)
        setNow(now)

        notes.forEach(note => {
          if (note.active && note.time === now && !playedNotes.has(note)) {
            playedNotes.add(note)
            playNote(note)
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
          const notes = clipboard()
          if (notes && presence) {
            pasteNotes(notes, presence)
          }
        }
      }
    })
  })

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
        <Show when={selectedNotes().length > 0 && mode() === 'select'}>
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
                const newNotes = selection.map(note => ({
                  ...note,
                  id: zeptoid(),
                  time: note.time + loop.duration
                }))
                setNotes(
                  produce(notes => {
                    notes.push(...newNotes)
                  })
                )
                setLoop('duration', duration => duration * 2)
                clipOverlappingNotes(...newNotes)
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
        <Show
          when={
            mode() === 'select' &&
            clipboard() &&
            selectionPresence() &&
            ([clipboard()!, selectionPresence()!] as const)
          }
        >
          {clipboardAndPresence => (
            <div
              style={{
                display: 'grid',
                'grid-template-rows': `${HEIGHT * 2 - 2}px`
              }}
            >
              <button
                class={mode() === 'stretch' ? styles.active : undefined}
                onClick={() => pasteNotes(...clipboardAndPresence())}
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
        onDblClick={() => setSelectedNotes([])}
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
            <dimensionsContext.Provider value={dimensions}>
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
                  <For each={notes}>{note => <Note note={note} />}</For>
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
              <PlayingNotes isPitchPlaying={isPitchPlaying} />
            </dimensionsContext.Provider>
          )}
        </Show>
      </svg>
    </div>
  )
}

export default App
