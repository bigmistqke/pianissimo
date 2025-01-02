import { DropdownMenu } from '@kobalte/core/dropdown-menu'
import clsx from 'clsx'
import MidiWriter from 'midi-writer-js'
import {
  Accessor,
  ComponentProps,
  createContext,
  createEffect,
  createSignal,
  For,
  Index,
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
  handleCreateNote,
  handleDragSelectedNotes,
  handleErase,
  handlePan,
  handleSelectionArea,
  handleSnip,
  handleStretchSelectedNotes,
  handleVelocitySelectedNotes,
  HEIGHT,
  internalTimeOffset,
  isNotePlaying,
  isNoteSelected,
  isPitchPlaying,
  KEY_COLORS,
  loop,
  MARGIN,
  midiOutputEnabled,
  midiOutputs,
  mode,
  now,
  pasteNotes,
  playedNotes,
  playing,
  playNote,
  projectedHeight,
  projectedOriginX,
  projectedOriginY,
  projectedWidth,
  savedDocumentUrls,
  selectedMidiOutputs,
  selectedNotes,
  selectionArea,
  selectionLocked,
  selectionPresence,
  setDimensions,
  setInternalTimeOffset,
  setLoop,
  setMidiOutputEnabled,
  setMode,
  setNow,
  setOrigin,
  setPlaying,
  setSelectedMidiOutputs,
  setSelectedNotes,
  setSelectionArea,
  setSelectionLocked,
  setSelectionPresence,
  setTimeScale,
  setVolume,
  setZoom,
  timeScale,
  timeScaleWidth,
  togglePlaying,
  volume,
  zoom
} from './state'
import { Loop, NoteData } from './types'
import { downloadDataUri } from './utils/download-data-uri'
import { mod } from './utils/mod'
import { pointerHelper } from './utils/pointer-helper'

function createMidiDataUri(notes: Record<string, NoteData>) {
  const track = new MidiWriter.Track()
  const division = 8

  Object.values(notes).forEach(note => {
    track.addEvent(
      new MidiWriter.NoteEvent({
        pitch: [MidiWriter.Utils.getPitch(note.pitch)],
        duration: Array.from({ length: note.duration }).fill(division),
        startTick: note.time * (512 / division),
        velocity: note.velocity / 100
      })
    )
  })

  const write = new MidiWriter.Writer(track)
  return write.dataUri()
}

function Button(props: ComponentProps<'button'>) {
  return <button {...props} class={clsx(props.class, styles.button)} />
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
    disabled?: boolean
  }>
) {
  const [trigger, setTrigger] = createSignal(false)
  return (
    <Button
      class={clsx(props.class, trigger() && styles.trigger)}
      style={props.style}
      disabled={props.disabled}
      onClick={event => {
        setTrigger(true)
        props.onClick(event)
        setTimeout(() => setTrigger(false), 250)
      }}
    >
      {props.children}
    </Button>
  )
}

function NumberButton(props: {
  increment(): void
  decrement(): void
  canIncrement?: boolean
  canDecrement?: boolean
  value: string | number
  label: string
}) {
  async function handleLongPress(event: PointerEvent, callback: () => void) {
    function loop() {
      timeout = setTimeout(loop, 100)
      callback()
    }
    let timeout = setTimeout(loop, 500)
    await pointerHelper(event)
    clearTimeout(timeout)
  }

  return (
    <div class={styles.numberButton} style={{ display: 'flex', 'flex-direction': 'column' }}>
      <div class={styles.textContainer} style={{ 'flex-direction': 'column' }}>
        <label class={styles.numberButtonLabel}>{props.label}</label>
        <span class={styles.numberButtonValue}>{props.value}</span>
      </div>
      <div class={styles.buttonContainer}>
        <button
          disabled={props.canDecrement === false}
          onPointerDown={event => handleLongPress(event, props.decrement)}
          onClick={props.decrement}
          style={{ display: 'flex', 'flex-direction': 'column' }}
        >
          <div />
          <div>
            <IconGrommetIconsFormPreviousLink />
          </div>
        </button>
        <button
          disabled={props.canIncrement === false}
          onPointerDown={event => handleLongPress(event, props.increment)}
          onClick={props.increment}
          style={{ display: 'flex', 'flex-direction': 'column' }}
        >
          <div />
          <div>
            <IconGrommetIconsFormNextLink />
          </div>
        </button>
      </div>
    </div>
  )
}

function Note(props: { note: NoteData }) {
  async function handleDragNote(event: PointerEvent) {
    event.stopPropagation()
    event.preventDefault()
    const initialTime = props.note.time
    const initialPitch = props.note.pitch
    let previousPitch = initialPitch
    setSelectedNotes([props.note])

    await doc.branch(update =>
      pointerHelper(event, ({ delta }) => {
        const time =
          Math.floor((initialTime + delta.x / projectedWidth()) / timeScale()) * timeScale()
        const pitch =
          initialPitch - Math.floor((delta.y + projectedHeight() / 2) / projectedHeight())

        update(doc => {
          const note = doc.notes[props.note.id]
          if (!note) return
          note.time = time
          note.pitch = pitch

          if (previousPitch !== pitch) {
            previousPitch = pitch
          }
        })
      })
    )

    setSelectedNotes([])
  }

  async function handleDeleteNote(event: PointerEvent) {
    event.preventDefault()
    event.stopPropagation()
    setSelectedNotes([props.note])
    await pointerHelper(event)
    setSelectedNotes([])
    doc.set(doc => {
      delete doc.notes[props.note.id]
    })
  }

  async function handlePointerDown(
    event: PointerEvent & { currentTarget: SVGElement; target: Element }
  ) {
    let initiallySelected = isNoteSelected(props.note)
    switch (mode()) {
      case 'select':
        if (selectionLocked()) break
        if (initiallySelected) {
          await handleDragSelectedNotes(event)
        }
        break
      case 'stretch':
        if (selectionLocked()) break
        if (!initiallySelected) {
          setSelectedNotes([props.note])
        }
        await handleStretchSelectedNotes(event)
        if (!initiallySelected) {
          setSelectedNotes([])
        }
        break
      case 'note':
        await handleDragNote(event)
        break
      case 'velocity':
        if (selectionLocked()) break
        if (!initiallySelected) {
          setSelectedNotes([props.note])
        }
        await handleVelocitySelectedNotes(event)
        if (!initiallySelected && !selectionLocked()) {
          setSelectedNotes([])
        }
        break
      case 'erase':
        handleDeleteNote(event)
        break
    }
  }

  const shouldSnip = () =>
    mode() === 'snip' &&
    isNoteSelected(props.note) &&
    selectionArea() &&
    props.note.time < selectionArea()!.start.x &&
    props.note.time + props.note.duration > selectionArea()!.start.x

  return (
    <Show
      when={shouldSnip()}
      fallback={
        <rect
          class={clsx(
            styles.note,
            isNoteSelected(props.note)
              ? mode() !== 'erase' && mode() !== 'snip'
                ? styles.selected
                : mode() === 'erase'
                  ? styles.inactive
                  : undefined
              : isNotePlaying(props.note)
                ? styles.selected
                : undefined
          )}
          x={props.note.time * projectedWidth() + MARGIN}
          y={-props.note.pitch * projectedHeight() + MARGIN}
          width={(props.note._duration ?? props.note.duration) * projectedWidth() - MARGIN * 2}
          height={projectedHeight() - MARGIN * 2}
          opacity={props.note.active ? props.note.velocity * 0.5 + 0.5 : 0.25}
          onDblClick={() => {
            if (mode() === 'note') {
              doc.set(doc => {
                delete doc.notes[props.note.id]
              })
            }
          }}
          onPointerDown={handlePointerDown}
        />
      }
    >
      {_ => {
        const startDuration = () => selectionArea()!.start.x - props.note.time
        const endDuration = () => props.note.time + props.note.duration - selectionArea()!.start.x
        return (
          <>
            <rect
              class={clsx(styles.note)}
              x={props.note.time * projectedWidth() + MARGIN}
              y={-props.note.pitch * projectedHeight() + MARGIN}
              width={startDuration() * projectedWidth() - MARGIN * 2}
              height={projectedHeight() - MARGIN * 2}
              opacity={props.note.velocity * 0.5 + 0.5}
            />
            <rect
              class={clsx(styles.note)}
              x={(props.note.time + startDuration()) * projectedWidth() + MARGIN}
              y={-props.note.pitch * projectedHeight() + MARGIN}
              width={endDuration() * projectedWidth() - MARGIN * 2}
              height={projectedHeight() - MARGIN * 2}
              opacity={props.note.velocity * 0.5 + 0.5}
            />
          </>
        )
      }}
    </Show>
  )
}

function Piano() {
  const [dimensions, setDimensions] = createSignal<DOMRect>()
  return (
    <svg
      class={styles.piano}
      style={{
        width: 'var(--width-piano)',
        fill: '100%',
        background: 'var(--color-piano-white)'
      }}
      ref={element => {
        onMount(() => {
          const observer = new ResizeObserver(() => {
            setDimensions(element.getBoundingClientRect())
          })
          observer.observe(element)
          onCleanup(() => observer.disconnect())
        })
      }}
    >
      <Show when={dimensions()}>
        {dimensions => (
          <dimensionsContext.Provider value={dimensions}>
            <PlayingNotes />
            <g
              style={{
                transform: `translateY(${mod(-projectedOriginY(), projectedHeight()) * -1}px)`
              }}
            >
              <Index each={new Array(Math.floor(dimensions().height / projectedHeight()) + 2)}>
                {(_, index) => (
                  <rect
                    y={index * projectedHeight()}
                    x={0}
                    style={{
                      height: `${projectedHeight()}px`,
                      fill: KEY_COLORS[
                        mod(
                          index + Math.floor(-projectedOriginY() / projectedHeight()),
                          KEY_COLORS.length
                        )
                      ]
                        ? 'none'
                        : 'var(--color-piano-black)'
                    }}
                  />
                )}
              </Index>
            </g>
          </dimensionsContext.Provider>
        )}
      </Show>
    </svg>
  )
}

function PlayingNotes() {
  const dimensions = useDimensions()
  return (
    <g style={{ transform: `translateY(${mod(-projectedOriginY(), projectedHeight()) * -1}px)` }}>
      <Index each={new Array(Math.floor(dimensions().height / projectedHeight()) + 2)}>
        {(_, index) => {
          return (
            <rect
              y={index * projectedHeight()}
              height={projectedHeight()}
              opacity={0.8}
              style={{
                fill: isPitchPlaying(-(index + Math.floor(-projectedOriginY() / projectedHeight())))
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
      x: event.layerX - projectedOriginX(),
      y: event.layerY - projectedOriginY()
    }

    const loop = {
      time: Math.floor(absolutePosition.x / projectedWidth()),
      duration: 1
    }

    props.setLoop(loop)

    const initialTime = loop.time
    const initialDuration = loop.duration
    const offset = absolutePosition.x - initialTime * projectedWidth()

    pointerHelper(event, ({ delta }) => {
      const deltaX = Math.floor((offset + delta.x) / projectedWidth())
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

    if (event.clientX < left + projectedWidth() / 3) {
      const offset = event.clientX - initialTime * projectedWidth() - projectedOriginX()

      await pointerHelper(event, ({ delta }) => {
        const deltaX = Math.floor((delta.x + offset) / projectedWidth())
        if (deltaX >= initialDuration) {
          props.setLoop('duration', deltaX - initialDuration + 2)
        } else {
          const time = initialTime + deltaX - 1
          props.setLoop('time', time)
          props.setLoop('duration', initialDuration - deltaX + 1)
        }
      })
    } else if (event.clientX > left + width - projectedWidth() / 3) {
      await pointerHelper(event, ({ delta }) => {
        const duration =
          Math.floor((event.clientX - projectedOriginX() + delta.x) / projectedWidth()) -
          initialTime

        if (duration > 0) {
          props.setLoop('duration', duration)
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
        const deltaX = Math.floor((delta.x + projectedWidth() / 2) / projectedWidth())
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
            x={loop().time * projectedWidth()}
            y={0}
            width={loop().duration * projectedWidth()}
            height={HEIGHT}
            fill={selected() || trigger() ? 'var(--color-loop-selected)' : 'var(--color-loop)'}
            style={{ transform: `translateX(${projectedOriginX()}px)`, transition: 'fill 0.25s' }}
            onPointerDown={event => handleAdjustLoop(event, loop())}
          />
        )}
      </Show>
      {/* Now Indicator */}
      <rect
        class={styles.now}
        width={timeScaleWidth()}
        height={HEIGHT}
        style={{
          opacity: 0.5,
          transform: `translateX(${
            projectedOriginX() + Math.floor(now() / timeScale()) * timeScaleWidth()
          }px)`
        }}
      />
      <line x1={0} x2={dimensions().width} y1={HEIGHT} y2={HEIGHT} stroke="var(--color-stroke)" />
      <g style={{ transform: `translateX(${projectedOriginX() % (projectedWidth() * 8)}px)` }}>
        <Index each={new Array(Math.floor(dimensions().width / projectedWidth() / 8) + 2)}>
          {(_, index) => (
            <line
              y1={0}
              y2={HEIGHT}
              x1={index * projectedWidth() * 8}
              x2={index * projectedWidth() * 8}
              stroke="var(--color-stroke)"
              stroke-width="2px"
            />
          )}
        </Index>
      </g>
      <g style={{ transform: `translateX(${projectedOriginX() % projectedWidth()}px)` }}>
        <Index each={new Array(Math.floor(dimensions().width / projectedWidth()) + 2)}>
          {(_, index) => (
            <line
              y1={0}
              y2={HEIGHT}
              x1={index * projectedWidth()}
              x2={index * projectedWidth()}
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
      <g
        style={{
          transform: `translateX(${projectedOriginX() % timeScaleWidth()}px)`
        }}
      >
        <Index each={new Array(Math.floor(dimensions().width / timeScaleWidth()) + 2)}>
          {(_, index) => (
            <line
              y1={0}
              y2={dimensions().height}
              x1={index * timeScaleWidth()}
              x2={index * timeScaleWidth()}
              stroke="var(--color-stroke-secondary)"
            />
          )}
        </Index>
      </g>
      <g style={{ transform: `translateX(${projectedOriginX() % (projectedWidth() * 8)}px)` }}>
        <Index each={new Array(Math.floor(dimensions().width / projectedWidth() / 8) + 2)}>
          {(_, index) => (
            <line
              y1={0}
              y2={dimensions().height}
              x1={index * projectedWidth() * 8}
              x2={index * projectedWidth() * 8}
              stroke="var(--color-stroke)"
              stroke-width="2px"
            />
          )}
        </Index>
      </g>
    </>
  )
}

function PianoUnderlay() {
  const dimensions = useDimensions()
  return (
    <g style={{ transform: `translateY(${-mod(-projectedOriginY(), projectedHeight())}px)` }}>
      <Index each={new Array(Math.floor(dimensions().height / projectedHeight()) + 2)}>
        {(_, index) => (
          <rect
            y={index * projectedHeight()}
            width={dimensions().width}
            height={projectedHeight()}
            style={{
              'pointer-events': 'none',
              fill: KEY_COLORS[
                mod(index + Math.floor(-projectedOriginY() / projectedHeight()), KEY_COLORS.length)
              ]
                ? 'none'
                : 'var(--color-piano-underlay)'
            }}
          />
        )}
      </Index>
    </g>
  )
}

function Hud() {
  return (
    <div class={styles.hud}>
      <div class={styles.topHudContainer}>
        <TopLeftHud />
        <TopRightHud />
      </div>
      <div class={styles.bottomHudContainer}>
        <BottomLeftHud />
        <BottomRightHud />
      </div>
    </div>
  )
}

function TopLeftHud() {
  return (
    <div
      class={styles.topLeftHud}
      style={{
        top: `${projectedHeight()}px`,
        gap: '5px'
      }}
    >
      <div class={styles.list}>
        <ActionButton
          onClick={() => {
            const selection = Object.values(doc.get().notes)?.filter(
              note => note.time >= loop.time && note.time < loop.time + loop.duration
            )

            if (!selection) return

            const newNotes = selection.map(note => ({
              ...note,
              id: zeptoid(),
              time: note.time + loop.duration
            }))

            doc.set(doc => {
              newNotes.forEach(note => {
                doc.notes[note.id] = note
              })
            })

            setLoop('duration', duration => duration * 2)
            clipOverlappingNotes(...newNotes)
          }}
        >
          <IconGrommetIconsDuplicate />
        </ActionButton>
        <Button
          class={mode() === 'loop' ? styles.active : undefined}
          onClick={() => setMode('loop')}
        >
          <IconGrommetIconsCycle style={{ 'margin-top': '3px' }} />
        </Button>
        <Button class={mode() === 'pan' ? styles.active : undefined} onClick={() => setMode('pan')}>
          <IconGrommetIconsPan />
        </Button>
      </div>
    </div>
  )
}

function TopRightHud() {
  return (
    <div class={styles.topRightHud}>
      <div class={styles.list}>
        <Button
          class={mode() === 'note' ? styles.active : undefined}
          onClick={() => setMode('note')}
        >
          <IconGrommetIconsMusic />
        </Button>
        <Button
          class={mode() === 'stretch' ? styles.active : undefined}
          onClick={() => setMode('stretch')}
        >
          <IconGrommetIconsShift />
        </Button>
        <Button
          class={mode() === 'velocity' ? styles.active : undefined}
          onClick={() => setMode('velocity')}
        >
          <IconGrommetIconsVolumeControl />
        </Button>
        <Button
          class={mode() === 'erase' ? styles.active : undefined}
          onClick={() => setMode('erase')}
        >
          <IconGrommetIconsErase />
        </Button>
        <Button
          class={mode() === 'snip' ? styles.active : undefined}
          onClick={() => setMode('snip')}
        >
          <IconGrommetIconsCut />
        </Button>
        <Button
          class={mode() === 'select' ? styles.active : undefined}
          onClick={() => setMode('select')}
        >
          <IconGrommetIconsSelect />
        </Button>
      </div>
      <Show when={mode() === 'select'}>
        {_ => {
          const hasClipboardAndPresence = () => clipboard() && selectionPresence()
          const clipboardAndPresence = () =>
            hasClipboardAndPresence() && ([clipboard()!, selectionPresence()!] as const)
          return (
            <div class={styles.listContainer}>
              <div class={styles.list}>
                <Button
                  disabled={selectedNotes().length === 0}
                  class={selectionLocked() ? styles.active : undefined}
                  onClick={() => setSelectionLocked(locked => !locked)}
                >
                  <IconGrommetIconsLock />
                </Button>
                <ActionButton
                  disabled={!hasClipboardAndPresence()}
                  class={mode() === 'stretch' ? styles.active : undefined}
                  onClick={() => {
                    const _clipboardAndPresence = clipboardAndPresence()
                    if (!_clipboardAndPresence) return
                    pasteNotes(..._clipboardAndPresence)
                  }}
                >
                  <IconGrommetIconsCopy />
                </ActionButton>
                <ActionButton
                  disabled={selectedNotes().length === 0}
                  class={mode() === 'stretch' ? styles.active : undefined}
                  onClick={copyNotes}
                >
                  <IconGrommetIconsClipboard />
                </ActionButton>
              </div>
            </div>
          )
        }}
      </Show>
      <Show when={mode() === 'velocity'}>
        <div class={styles.listContainer}>
          <div class={styles.list}>
            <Button
              disabled={selectedNotes().length === 0}
              class={selectionLocked() ? styles.active : undefined}
              onClick={() => setSelectionLocked(locked => !locked)}
            >
              <IconGrommetIconsLock />
            </Button>
            <ActionButton
              disabled={selectedNotes().length === 0}
              onClick={() => {
                let inactiveSelectedNotes = 0
                selectedNotes().forEach(note => {
                  if (!note.active) {
                    inactiveSelectedNotes++
                  }
                })

                const shouldActivate = inactiveSelectedNotes > selectedNotes().length / 2

                doc.set(doc => {
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
        </div>
      </Show>
      <Show when={mode() === 'stretch'}>
        <div class={styles.listContainer}>
          <div class={styles.list}>
            <Button
              disabled={selectedNotes().length === 0}
              class={selectionLocked() ? styles.active : undefined}
              onClick={() => setSelectionLocked(locked => !locked)}
            >
              <IconGrommetIconsLock />
            </Button>
          </div>
        </div>
      </Show>
    </div>
  )
}

function BottomLeftHud() {
  const [fullscreen, setFullscreen] = createSignal(false)

  const root = document.body
  createEffect(() => {
    if (fullscreen()) {
      root.requestFullscreen()
    } else if (document.fullscreenElement) {
      document.exitFullscreen()
    }
  })

  return (
    <div class={styles.bottomLeftHud}>
      <div class={styles.list}>
        <DropdownMenu>
          <DropdownMenu.Trigger as={Button}>
            <IconGrommetIconsMenu />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class={styles['dropdown-menu__content']}>
              <DropdownMenu.Item
                as={Button}
                class={styles['dropdown-menu__item']}
                onClick={doc.new}
              >
                New File
              </DropdownMenu.Item>
              <DropdownMenu.Sub overlap gutter={4} shift={-8}>
                <DropdownMenu.SubTrigger as={Button} class={styles['dropdown-menu__sub-trigger']}>
                  Open File
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent class={styles['dropdown-menu__sub-content']}>
                    <For
                      each={Object.entries(savedDocumentUrls()).sort(([, a], [, b]) =>
                        a - b > 0 ? -1 : 1
                      )}
                    >
                      {([_url, date]) => (
                        <DropdownMenu.Item
                          as={Button}
                          class={clsx(
                            styles['dropdown-menu__item'],
                            doc.url() === _url && styles.selected
                          )}
                          onClick={() => doc.openUrl(_url)}
                        >
                          {deserializeDate(date)}
                        </DropdownMenu.Item>
                      )}
                    </For>
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
              <DropdownMenu.Item
                as={Button}
                closeOnSelect={false}
                class={styles['dropdown-menu__item']}
                onClick={() =>
                  downloadDataUri(createMidiDataUri(doc.get().notes), 'pianissimo.mid')
                }
              >
                Export to Midi
              </DropdownMenu.Item>
              <DropdownMenu.Item
                as={Button}
                closeOnSelect={false}
                class={styles['dropdown-menu__item']}
                onClick={() => setFullscreen(fullscreen => !fullscreen)}
              >
                {fullscreen() ? 'Close' : 'Open'} Fullscreen
              </DropdownMenu.Item>
              <DropdownMenu.Sub overlap gutter={4} shift={-8}>
                <DropdownMenu.SubTrigger
                  as={Button}
                  class={styles['dropdown-menu__sub-trigger']}
                  onClick={() => {
                    setMidiOutputEnabled(true)
                  }}
                >
                  Midi Out
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <Show when={midiOutputEnabled()}>
                    <DropdownMenu.SubContent class={styles['dropdown-menu__sub-content']}>
                      <For each={midiOutputs()}>
                        {output => (
                          <DropdownMenu.Item
                            as={Button}
                            closeOnSelect={false}
                            class={clsx(
                              styles['dropdown-menu__item'],
                              selectedMidiOutputs().includes(output) && styles.selected
                            )}
                            onClick={() =>
                              setSelectedMidiOutputs(outputs =>
                                outputs.includes(output)
                                  ? outputs.filter(_output => _output !== output)
                                  : [...outputs, output]
                              )
                            }
                          >
                            {output.name}
                          </DropdownMenu.Item>
                        )}
                      </For>
                    </DropdownMenu.SubContent>
                  </Show>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
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
      <div class={styles.desktop}>
        <NumberButton
          label="zoom time"
          value={zoom().x}
          decrement={() => setZoom(zoom => ({ ...zoom, x: zoom.x - 10 }))}
          increment={() => setZoom(zoom => ({ ...zoom, x: zoom.x + 10 }))}
          canDecrement={zoom().x > 0.1}
          canIncrement={zoom().x < 1}
        />
      </div>
      <div class={styles.desktop}>
        <NumberButton
          label="zoom pitch"
          value={zoom().y}
          decrement={() => setZoom(zoom => ({ ...zoom, y: zoom.y - 10 }))}
          increment={() => setZoom(zoom => ({ ...zoom, y: zoom.y + 10 }))}
          canDecrement={zoom().y > 0.1}
          canIncrement={zoom().y < 1}
        />
      </div>
      <div class={styles.desktop}>
        <NumberButton
          label="volume"
          value={volume()}
          decrement={() => setVolume(bpm => Math.max(0, bpm - 1))}
          increment={() => setVolume(bpm => Math.min(10, bpm + 1))}
          canDecrement={volume() > 0}
          canIncrement={volume() < 10}
        />
      </div>
      <div>
        <NumberButton
          label="tempo"
          value={doc.get().bpm}
          decrement={() => doc.set(doc => (doc.bpm = Math.max(0, doc.bpm - 1)))}
          increment={() => doc.set(doc => (doc.bpm = Math.min(1000, doc.bpm + 1)))}
          canDecrement={doc.get().bpm > 0}
          canIncrement={doc.get().bpm < 1000}
        />
      </div>
      <div>
        <NumberButton
          label="grid"
          value={timeScale() / 8 < 1 ? `1:${1 / (timeScale() / 8)}` : timeScale() / 8}
          decrement={() => setTimeScale(duration => Math.max(duration / 2, 8 / 128))}
          increment={() => setTimeScale(duration => duration * 2)}
          canDecrement={timeScale() > 8 / 128}
        />
      </div>
      <div>
        <NumberButton
          label="instrument"
          value={doc.get().instrument.toString().padStart(3, '0')}
          decrement={() => {
            if (doc.get().instrument > 0) {
              doc.set(doc => {
                doc.instrument = doc.instrument - 1
              })
            } else {
              doc.set(doc => {
                doc.instrument = 174
              })
            }
          }}
          increment={() => {
            if (doc.get().instrument >= 174) {
              doc.set(doc => {
                doc.instrument = 0
              })
            } else {
              doc.set(doc => {
                doc.instrument = doc.instrument + 1
              })
            }
          }}
        />
      </div>
      <div>
        <Button
          class={styles.horizontal}
          onClick={() => {
            setNow(loop.time)
            setPlaying(false)
            playedNotes.clear()
          }}
        >
          <IconGrommetIconsStop />
        </Button>
        <Button class={styles.horizontal} onClick={togglePlaying}>
          {!playing() ? <IconGrommetIconsPlay /> : <IconGrommetIconsPause />}
        </Button>
      </div>
    </div>
  )
}

const dimensionsContext = createContext<Accessor<DOMRect>>()
function useDimensions() {
  const context = useContext(dimensionsContext)
  if (!context) {
    throw `DimensionsContext is undefined.`
  }
  return context
}

function App() {
  // Reset selectionLocked when mode changes
  createEffect(on(mode, () => setSelectionLocked(false)))

  async function handlePointerDown(event: PointerEvent & { currentTarget: SVGElement }) {
    if (selectionLocked()) {
      switch (mode()) {
        case 'stretch':
          await handleStretchSelectedNotes(event)
          break
        case 'velocity':
          await handleVelocitySelectedNotes(event)
          break
        case 'select':
          await handleDragSelectedNotes(event)
      }
    } else {
      switch (mode()) {
        case 'note':
          handleCreateNote(event)
          break
        case 'stretch':
        case 'select':
          await handleSelectionArea(event)
          setSelectionArea()
          break
        case 'velocity':
          await handleSelectionArea(event)
          setSelectionArea()
          setSelectionPresence()
          break
        case 'loop':
          const area = await handleSelectionArea(event)
          setLoop({
            time: area.start.x,
            duration: area.end.x - area.start.x
          })
          break
        case 'erase':
          handleErase(event)
          break
        case 'snip':
          handleSnip(event)
          break
        case 'pan':
          handlePan(event)
          break
      }
    }
  }

  // Audio Loop
  let lastVelocity = doc.get().bpm / 60 // Track the last velocity to adjust time offset
  createEffect(
    on(playing, playing => {
      if (!playing || !audioContext) return

      let shouldPlay = true

      // Adjust timeOffset when BPM changes to prevent abrupt shifts
      const newVelocity = doc.get().bpm / 60
      const currentTime = audioContext!.currentTime
      const elapsedTime = currentTime * lastVelocity - internalTimeOffset()
      setInternalTimeOffset(currentTime * newVelocity - elapsedTime)
      lastVelocity = newVelocity

      function clock() {
        if (!shouldPlay) return

        const VELOCITY = doc.get().bpm / 60 // Calculate velocity dynamically from BPM
        let time = audioContext!.currentTime * VELOCITY - internalTimeOffset()

        if (loop) {
          if (time < loop.time) {
            playedNotes.clear()
            time = loop.time
            setInternalTimeOffset(audioContext!.currentTime * VELOCITY - loop.time)
          } else if (time > loop.time + loop.duration) {
            playedNotes.clear()
            setInternalTimeOffset(audioContext!.currentTime * VELOCITY - loop.time)
            clock()
            return
          }
        }

        setNow(time)
        for (const id in doc.get().notes) {
          const note = doc.get().notes[id]

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
        }

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
    <>
      <Piano />
      <div class={styles.main}>
        <Hud />
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
          onDblClick={() => !selectionLocked() && setSelectedNotes([])}
          onWheel={event =>
            setOrigin(origin => ({
              x: origin.x - event.deltaX / zoom().x,
              y: origin.y - (event.deltaY / zoom().y) * (2 / 3)
            }))
          }
          onPointerDown={handlePointerDown}
        >
          <Show when={dimensions()}>
            {dimensions => (
              <dimensionsContext.Provider value={dimensions}>
                <PianoUnderlay />
                <Grid />
                {/* Selection Area */}
                <Show when={selectionArea()}>
                  {area => (
                    <rect
                      x={area().start.x * projectedWidth() + projectedOriginX()}
                      y={area().start.y * projectedHeight() + projectedOriginY()}
                      width={(area().end.x - area().start.x) * projectedWidth()}
                      height={(area().end.y - area().start.y) * projectedHeight()}
                      opacity={0.3}
                      fill="var(--color-selection-area)"
                    />
                  )}
                </Show>
                {/* Selection Presence */}
                <Show when={selectionPresence()}>
                  {presence => (
                    <rect
                      x={presence().x * projectedWidth() + projectedOriginX()}
                      y={presence().y * projectedHeight() + projectedOriginY()}
                      width={timeScaleWidth()}
                      height={projectedHeight()}
                      opacity={0.8}
                      fill="var(--color-selection-area)"
                    />
                  )}
                </Show>
                {/* Notes */}
                <Show when={Object.values(doc.get().notes).length > 0}>
                  <g
                    style={{
                      transform: `translate(${projectedOriginX()}px, ${projectedOriginY()}px)`
                    }}
                  >
                    <For each={Object.values(doc.get().notes)}>{note => <Note note={note} />}</For>
                  </g>
                </Show>
                {/* Now Underlay */}
                <rect
                  class={styles.now}
                  width={timeScaleWidth()}
                  height={dimensions().height}
                  style={{
                    opacity: 0.075,
                    transform: `translateX(${
                      projectedOriginX() + Math.floor(now() / timeScale()) * timeScaleWidth()
                    }px)`
                  }}
                />
                <Ruler loop={loop} setLoop={setLoop} />
              </dimensionsContext.Provider>
            )}
          </Show>
        </svg>
      </div>
    </>
  )
}

export default App
