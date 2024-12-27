import { DropdownMenu } from '@kobalte/core/dropdown-menu'
import clsx from 'clsx'
import MidiWriter from 'midi-writer-js'
import {
  Accessor,
  batch,
  createContext,
  createEffect,
  createSignal,
  For,
  Index,
  mapArray,
  on,
  onCleanup,
  onMount,
  ParentProps,
  Show,
  useContext
} from 'solid-js'
import { JSX } from 'solid-js/h/jsx-runtime'
import { DOMElement } from 'solid-js/jsx-runtime'
import { SetStoreFunction } from 'solid-js/store'
import zeptoid from 'zeptoid'
import styles from './App.module.css'
import {
  audioContext,
  clipboard,
  clipOverlappingNotes,
  copyNotes,
  deserializeDate,
  dimensions,
  doc,
  filterNote,
  handleCreateNote,
  handlePan,
  handleSelectionBox,
  HEIGHT,
  isNotePlaying,
  isNoteSelected,
  isPitchPlaying,
  KEY_COLORS,
  loop,
  MARGIN,
  markOverlappingNotes,
  mode,
  newDoc,
  now,
  openUrl,
  origin,
  pasteNotes,
  playedNotes,
  playing,
  playNote,
  selectedNotes,
  selectionArea,
  selectionPresence,
  setDimensions,
  setDoc,
  setLoop,
  setMode,
  setNow,
  setOrigin,
  setPlaying,
  setSelectedNotes,
  setSelectionArea,
  setSelectionPresence,
  setTimeOffset,
  setTimeScale,
  sortNotes,
  timeOffset,
  timeScale,
  togglePlaying,
  urls,
  VELOCITY,
  WIDTH
} from './state'
import { Loop, NoteData } from './types'
import { downloadDataUri } from './utils/download-data-uri'
import { mod } from './utils/mod'
import { pointerHelper } from './utils/pointer-helper'

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

function ActionButton(
  props: ParentProps<{
    onClick(
      event: MouseEvent & {
        currentTarget: HTMLButtonElement
        target: DOMElement
      }
    ): void
    class?: string
    style?: JSX.CSSProperties
  }>
) {
  const [trigger, setTrigger] = createSignal(false)
  return (
    <button
      class={clsx(props.class, trigger() && styles.trigger)}
      style={props.style}
      onClick={event => {
        setTrigger(true)
        props.onClick(event)
        setTimeout(() => setTrigger(false), 250)
      }}
    >
      {props.children}
    </button>
  )
}

function NumberButton(props: { increment(): void; decrement(): void; value: string | number }) {
  return (
    <div class={styles.numberButton}>
      <ActionButton onClick={props.decrement}>
        <IconGrommetIconsFormPreviousLink />
      </ActionButton>
      <span>{props.value}</span>
      <ActionButton onClick={props.increment}>
        <IconGrommetIconsFormNextLink />
      </ActionButton>
    </div>
  )
}

function Note(props: { note: NoteData }) {
  async function handleSelect(event: PointerEvent) {
    if (isNoteSelected(props.note)) {
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

        let previous = 0
        const { delta } = await pointerHelper(event, ({ delta }) => {
          let time = Math.floor(delta.x / WIDTH / timeScale()) * timeScale()

          if (time === timeScale() * -1) {
            time = 0
          } else if (time < timeScale() * -1) {
            time = time + timeScale()
          }

          const hasChanged = previous !== time
          previous = time

          setDoc(doc => {
            doc.notes.forEach(note => {
              if (isNoteSelected(note)) {
                note.time = initialNotes[note.id].time + time - offset
                note.pitch =
                  initialNotes[note.id].pitch - Math.floor((delta.y + HEIGHT / 2) / HEIGHT)
                if (hasChanged) {
                  playNote(note)
                }
              }
            })
          })
          markOverlappingNotes(...selectedNotes())
        })
        if (Math.floor((delta.x + WIDTH / 2) / WIDTH) !== 0) {
          sortNotes()
        }
        clipOverlappingNotes(...selectedNotes())
      }
    }
  }

  async function handleStretch(
    event: PointerEvent & {
      currentTarget: SVGRectElement
      target: DOMElement
    }
  ) {
    event.stopPropagation()
    event.preventDefault()

    if (!isNoteSelected(props.note)) {
      setSelectedNotes([props.note])
    }

    const initialSelectedNotes = Object.fromEntries(
      selectedNotes().map(note => [note.id, { ...note }])
    )

    console.log(initialSelectedNotes.length)

    await pointerHelper(event, ({ delta }) => {
      batch(() => {
        const deltaX = Math.floor(delta.x / WIDTH / timeScale()) * timeScale()
        setDoc(doc => {
          doc.notes.forEach(note => {
            if (!isNoteSelected(note)) return
            const duration = initialSelectedNotes[note.id].duration + deltaX
            if (duration > timeScale()) {
              note.duration = duration
            } else {
              note.time = initialSelectedNotes[note.id].time
              note.duration = timeScale()
            }
          })
        })
        markOverlappingNotes(...selectedNotes())
      })
    })

    clipOverlappingNotes(...selectedNotes())
    if (selectedNotes().length === 1) {
      setSelectedNotes([])
    }
  }

  async function handleNote(event: PointerEvent) {
    event.stopPropagation()
    event.preventDefault()
    const initialTime = props.note.time
    const initialPitch = props.note.pitch
    let previousTime = initialTime
    let previousPitch = initialPitch
    setSelectedNotes([props.note])
    await pointerHelper(event, ({ delta }) => {
      const time = Math.floor((initialTime + delta.x / WIDTH) / timeScale()) * timeScale()
      const pitch = initialPitch - Math.floor((delta.y + HEIGHT / 2) / HEIGHT)

      setDoc(doc => {
        const note = doc.notes.find(note => note.id === props.note.id)
        if (!note) return
        note.time = time
        note.pitch = pitch

        if (previousPitch !== pitch) {
          playNote(note)
          previousPitch = pitch
        }

        if (previousTime !== time) {
          sortNotes()
          previousTime = time
        }
      })

      markOverlappingNotes(props.note)
    })
    setSelectedNotes([])
    clipOverlappingNotes(props.note)
  }

  async function handleVelocity(event: PointerEvent) {
    let initiallySelected = !!selectedNotes().find(filterNote(props.note))
    if (!initiallySelected) {
      setSelectedNotes([props.note])
    }
    const initialNotes = Object.fromEntries(selectedNotes().map(note => [note.id, { ...note }]))
    await pointerHelper(event, ({ delta }) => {
      setDoc(doc => {
        doc.notes.forEach(note => {
          if (!note.active) {
            note.active = true
          }
          if (note.id in initialNotes) {
            note.velocity = Math.min(1, Math.max(0, initialNotes[note.id].velocity - delta.y / 100))
          }
        })
      })
    })
    if (!initiallySelected) {
      setSelectedNotes([])
    }
  }

  return (
    <rect
      class={clsx(
        styles.note,
        (isNoteSelected(props.note) || isNotePlaying(props.note)) && styles.selected
      )}
      x={props.note.time * WIDTH + MARGIN}
      y={-props.note.pitch * HEIGHT + MARGIN}
      width={(props.note._duration ?? props.note.duration) * WIDTH - MARGIN * 2}
      height={HEIGHT - MARGIN * 2}
      opacity={!props.note._remove && props.note.active ? props.note.velocity * 0.75 + 0.25 : 0.25}
      onDblClick={() => {
        if (mode() === 'note') {
          setDoc(doc => {
            const index = doc.notes.findIndex(filterNote(props.note))
            if (index !== -1) doc.notes.splice(index, 1)
          })
        }
      }}
      onPointerDown={async event => {
        switch (mode()) {
          case 'select':
            return await handleSelect(event)
          case 'stretch':
            return handleStretch(event)
          case 'note':
            return handleNote(event)
          case 'velocity':
            return handleVelocity(event)
        }
      }}
    />
  )
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

function PlayingNotes() {
  const dimensions = useDimensions()
  return (
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
                fill: isPitchPlaying(-(index + Math.floor(-origin().y / HEIGHT)))
                  ? 'var(--color-note-selected)'
                  : 'none'
              }}
            />
          )
        }}
      </Index>
    </g>
  )
}

function Ruler(props: { setLoop: SetStoreFunction<Loop>; loop: Loop }) {
  const dimensions = useDimensions()

  const [selected, setSelected] = createSignal(false)
  const [trigger, setTrigger] = createSignal(false)

  function handleCreateLoop(event: PointerEvent) {
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
  }

  async function handleAdjustLoop(
    event: PointerEvent & {
      currentTarget: SVGRectElement
      target: DOMElement
    },
    loop: Loop
  ) {
    event.stopPropagation()
    event.preventDefault()

    setSelected(true)

    const { width, left } = event.target.getBoundingClientRect()

    const initialTime = loop.time
    const initialDuration = loop.duration

    if (event.clientX < left + WIDTH / 3) {
      const offset = event.layerX - initialTime * WIDTH - origin().x

      await pointerHelper(event, ({ delta }) => {
        const deltaX = Math.floor((delta.x + offset) / WIDTH)
        if (deltaX >= initialDuration) {
          props.setLoop('duration', deltaX - initialDuration + 2)
        } else {
          const time = initialTime + deltaX
          props.setLoop('time', time)
          props.setLoop('duration', initialDuration - deltaX)
        }
      })
    } else if (event.layerX > left + width - WIDTH / 3) {
      await pointerHelper(event, ({ delta }) => {
        const duration = Math.floor((event.layerX - origin().x + delta.x) / WIDTH) - initialTime

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
      await pointerHelper(event, ({ delta }) => {
        const deltaX = Math.floor((delta.x + WIDTH / 2) / WIDTH)
        const time = initialTime + deltaX
        props.setLoop('time', time)
      })
    }

    setSelected(false)
  }

  let initial = true
  createEffect(
    on(
      () => [props.loop.duration, props.loop.time],
      () => {
        if (initial) {
          initial = false
          return
        }
        setTrigger(true)
        setTimeout(() => {
          setTrigger(false)
        }, 250)
      }
    )
  )

  return (
    <>
      <rect
        x={0}
        y={0}
        width={dimensions().width}
        height={HEIGHT}
        fill="var(--color-piano-black)"
        onPointerDown={handleCreateLoop}
      />
      <Show when={props.loop}>
        {loop => (
          <rect
            x={loop().time * WIDTH}
            y={0}
            width={loop().duration * WIDTH}
            height={HEIGHT}
            fill={selected() || trigger() ? 'var(--color-loop-selected)' : 'var(--color-loop)'}
            style={{ transform: `translateX(${origin().x}px)`, transition: 'fill 0.25s' }}
            onPointerDown={event => handleAdjustLoop(event, loop())}
          />
        )}
      </Show>
      {/* Now Indicator */}
      <rect
        class={styles.now}
        width={WIDTH * timeScale()}
        height={HEIGHT}
        style={{
          opacity: 0.5,
          transform: `translateX(${
            origin().x + Math.floor(now() / timeScale()) * WIDTH * timeScale()
          }px)`
        }}
      />
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
      <g style={{ transform: `translateX(${origin().x % (WIDTH * timeScale())}px)` }}>
        <Index each={new Array(Math.floor(dimensions().width / WIDTH / timeScale()) + 2)}>
          {(_, index) => (
            <line
              y1={0}
              y2={dimensions().height}
              x1={index * timeScale() * WIDTH}
              x2={index * timeScale() * WIDTH}
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

function PianoUnderlay() {
  const dimensions = useDimensions()
  return (
    <g style={{ transform: `translateY(${-mod(-origin().y, HEIGHT)}px)` }}>
      <Index each={new Array(Math.floor(dimensions().height / HEIGHT) + 2)}>
        {(_, index) => (
          <rect
            y={index * HEIGHT}
            width={dimensions().width}
            height={HEIGHT}
            style={{
              'pointer-events': 'none',
              fill: KEY_COLORS[mod(index + Math.floor(-origin().y / HEIGHT), KEY_COLORS.length)]
                ? 'none'
                : 'var(--color-piano-underlay)'
            }}
          />
        )}
      </Index>
    </g>
  )
}

function TopLeftHud() {
  const isSelectionAreaCyclable = () =>
    selectionArea() === undefined ||
    (selectionArea()!.start.x === selectionArea()!.end.x &&
      selectionArea()!.start.y === selectionArea()!.end.y)
  return (
    <div
      class={styles.topLeftHud}
      style={{
        top: `${HEIGHT}px`,
        gap: '5px'
      }}
    >
      <div>
        <ActionButton
          onClick={() => {
            const selection = doc().notes?.filter(
              note => note.time >= loop.time && note.time < loop.time + loop.duration
            )

            if (!selection) return

            const newNotes = selection.map(note => ({
              ...note,
              id: zeptoid(),
              time: note.time + loop.duration
            }))

            setDoc(doc => doc.notes.push(...newNotes))

            setLoop('duration', duration => duration * 2)
            clipOverlappingNotes(...newNotes)
          }}
        >
          <IconGrommetIconsDuplicate />
        </ActionButton>
      </div>
      <Show when={mode() === 'select'}>
        <div
          style={{
            opacity: isSelectionAreaCyclable() ? 0.5 : undefined,
            'pointer-events': isSelectionAreaCyclable() ? 'none' : undefined
          }}
        >
          <ActionButton
            class={mode() === 'stretch' ? styles.active : undefined}
            onClick={() => {
              const area = selectionArea()
              if (!area) {
                console.error('Trying to ')
                return
              }
              setLoop({
                time: area.start.x,
                duration: area.end.x - area.start.x + timeScale()
              })
            }}
          >
            <IconGrommetIconsCycle style={{ 'margin-top': '3px' }} />
          </ActionButton>
        </div>
      </Show>
    </div>
  )
}

function TopRightHud() {
  return (
    <div class={styles.topRightHud}>
      <div>
        <button
          class={mode() === 'note' ? styles.active : undefined}
          onClick={() => setMode('note')}
        >
          <IconGrommetIconsMusic />
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
        <button
          class={mode() === 'velocity' ? styles.active : undefined}
          onClick={() => setMode('velocity')}
        >
          <IconGrommetIconsVolumeControl />
        </button>
        <button class={mode() === 'pan' ? styles.active : undefined} onClick={() => setMode('pan')}>
          <IconGrommetIconsPan />
        </button>
      </div>
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
            <ActionButton
              class={mode() === 'stretch' ? styles.active : undefined}
              onClick={() => pasteNotes(...clipboardAndPresence())}
            >
              <IconGrommetIconsCopy />
            </ActionButton>
          </div>
        )}
      </Show>
      <Show when={mode() === 'select'}>
        <div
          style={{
            opacity: selectedNotes().length === 0 ? 0.5 : undefined,
            'pointer-events': selectedNotes().length === 0 ? 'none' : undefined
          }}
        >
          <ActionButton
            class={mode() === 'stretch' ? styles.active : undefined}
            onClick={copyNotes}
          >
            <IconGrommetIconsClipboard />
          </ActionButton>
          <ActionButton
            onClick={() => {
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
                  }
                })

              setDoc(doc => doc.notes.push(...newNotes))
              setSelectedNotes(notes => [...notes, ...newNotes])

              setDoc(doc => {
                doc.notes.forEach(note => {
                  if (isNoteSelected(note) && note.time < cutLine) {
                    note.duration = cutLine - note.time
                  }
                })
              })
            }}
          >
            <IconGrommetIconsCut />
          </ActionButton>
          <ActionButton
            onClick={() => {
              setDoc(doc => {
                for (let index = doc.notes.length - 1; index >= 0; index--) {
                  if (isNoteSelected(doc.notes[index])) {
                    doc.notes.splice(index, 1)
                  }
                }
              })
              setSelectedNotes([])
            }}
          >
            <IconGrommetIconsErase />
          </ActionButton>
          <ActionButton
            onClick={() => {
              let inactiveSelectedNotes = 0
              selectedNotes().forEach(note => {
                if (!note.active) {
                  inactiveSelectedNotes++
                }
              })

              const shouldActivate = inactiveSelectedNotes > selectedNotes().length / 2

              setDoc(doc => {
                doc.notes.forEach(note => {
                  if (isNoteSelected(note)) {
                    note.active = shouldActivate
                  }
                })
              })
            }}
          >
            <IconGrommetIconsDisabledOutline />
          </ActionButton>
        </div>
      </Show>
    </div>
  )
}

function BottomLeftHud() {
  return (
    <div class={styles.bottomLeftHud}>
      <div>
        <DropdownMenu>
          <DropdownMenu.Trigger as="button" onClick={() => setTimeScale(duration => duration / 2)}>
            <IconGrommetIconsMenu />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class={styles['dropdown-menu__content']}>
              <DropdownMenu.Item as="button" class={styles['dropdown-menu__item']} onClick={newDoc}>
                New File <div class={styles['dropdown-menu__item-right-slot']}>⌘+N</div>
              </DropdownMenu.Item>
              <DropdownMenu.Sub overlap gutter={4} shift={-8}>
                <DropdownMenu.SubTrigger as="button" class={styles['dropdown-menu__sub-trigger']}>
                  Open File <div class={styles['dropdown-menu__item-right-slot']}>⌘+O</div>
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent class={styles['dropdown-menu__sub-content']}>
                    <For each={Object.entries(urls()).sort(([, a], [, b]) => (a - b > 0 ? -1 : 1))}>
                      {([url, date]) => (
                        <DropdownMenu.Item
                          as="button"
                          class={styles['dropdown-menu__item']}
                          onClick={() => openUrl(url)}
                        >
                          {deserializeDate(date)}
                        </DropdownMenu.Item>
                      )}
                    </For>
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
              <DropdownMenu.Item
                as="button"
                closeOnSelect={false}
                class={styles['dropdown-menu__item']}
                onClick={() => downloadDataUri(createMidiDataUri(doc().notes), 'pianissimo.mid')}
              >
                Export to Midi <div class={styles['dropdown-menu__item-right-slot']}>⇧+⌘+E</div>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </div>
    </div>
  )
}

function BottomRightHud() {
  return (
    <div class={styles.bottomRightHud}>
      <div>
        <NumberButton
          value={timeScale() < 1 ? `1:${1 / timeScale()}` : timeScale()}
          decrement={() => setTimeScale(duration => duration / 2)}
          increment={() => setTimeScale(duration => duration * 2)}
        />
      </div>
      <div>
        <NumberButton
          value={doc().instrument.toString().padStart(3, '0')}
          decrement={() => {
            if (doc().instrument > 0) {
              setDoc(doc => {
                doc.instrument = doc.instrument - 1
              })
            } else {
              setDoc(doc => {
                doc.instrument = 174
              })
            }
          }}
          increment={() => {
            if (doc().instrument >= 174) {
              setDoc(doc => {
                doc.instrument = 0
              })
            } else {
              setDoc(doc => {
                doc.instrument = doc.instrument + 1
              })
            }
          }}
        />
      </div>
      <div>
        <button
          onClick={() => {
            setNow(loop.time)
            setPlaying(false)
            playedNotes.clear()
          }}
        >
          <IconGrommetIconsStop />
        </button>
        <button onClick={togglePlaying}>
          {!playing() ? <IconGrommetIconsPlay /> : <IconGrommetIconsPause />}
        </button>
      </div>
    </div>
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
  // Reset selection-presence after switching mode from select-mode
  createEffect(() => {
    if (mode() !== 'select') {
      setSelectionPresence()
      setSelectionArea()
    }
  })

  // Play notes when they are selected/change pitch
  createEffect(
    mapArray(
      () => doc().notes,
      note => {
        createEffect(
          on(
            () => isNoteSelected(note),
            selected => selected && playNote({ ...note, duration: Math.min(1, note.duration) })
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

        setNow(time)

        doc().notes.forEach(note => {
          if (!note.active) return
          if (playedNotes.has(note)) return

          const loopEnd = loop.time + loop.duration
          const overflow = time + 1 - loopEnd

          if (overflow > 0) {
            if (note.time >= time && note.time < loopEnd) {
              playedNotes.add(note)
              playNote(note, (note.time - time) / VELOCITY)
            } else if (note.time >= loop.time && note.time < loop.time + overflow) {
              playedNotes.add(note)
              playNote(note, (note.time + loopEnd - time) / VELOCITY)
            }
          } else if (note.time >= time && note.time < time + 1) {
            playedNotes.add(note)
            playNote(note, (note.time - time) / VELOCITY)
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
      <TopLeftHud />
      <TopRightHud />
      <BottomRightHud />
      <BottomLeftHud />
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
              handleCreateNote(event)
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
              <PianoUnderlay />
              <Grid />
              {/* Selection Area */}
              <Show when={mode() === 'select' && selectionArea()}>
                {area => (
                  <rect
                    x={area().start.x * WIDTH + origin().x}
                    y={area().start.y * HEIGHT + origin().y}
                    width={(area().end.x - area().start.x) * WIDTH}
                    height={(area().end.y - area().start.y) * HEIGHT}
                    opacity={0.3}
                    fill="var(--color-selection-area)"
                  />
                )}
              </Show>
              {/* Selection Presence */}
              <Show when={mode() === 'select' && selectionPresence()}>
                {presence => (
                  <rect
                    x={presence().x * WIDTH + origin().x}
                    y={presence().y * HEIGHT + origin().y}
                    width={WIDTH * timeScale()}
                    height={HEIGHT}
                    opacity={0.8}
                    fill="var(--color-selection-area)"
                  />
                )}
              </Show>
              {/* Notes */}
              <Show when={doc().notes.length > 0}>
                <g style={{ transform: `translate(${origin().x}px, ${origin().y}px)` }}>
                  <For each={doc().notes}>{note => <Note note={note} />}</For>
                </g>
              </Show>
              {/* Now Underlay */}
              <rect
                class={styles.now}
                width={WIDTH * timeScale()}
                height={dimensions().height}
                style={{
                  opacity: 0.075,
                  transform: `translateX(${
                    origin().x + Math.floor(now() / timeScale()) * WIDTH * timeScale()
                  }px)`
                }}
              />
              <Ruler loop={loop} setLoop={setLoop} />
              <Piano />
              <PlayingNotes />
            </dimensionsContext.Provider>
          )}
        </Show>
      </svg>
    </div>
  )
}

export default App
