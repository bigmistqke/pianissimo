import { DropdownMenu } from '@kobalte/core/dropdown-menu'
import clsx from 'clsx'
import MidiWriter from 'midi-writer-js'
import {
  Accessor,
  batch,
  ComponentProps,
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
  internalTimeOffset,
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
  pasteNotes,
  playedNotes,
  playing,
  playNote,
  projectedHeight,
  projectedOrigin,
  projectedWidth,
  selectedNotes,
  selectionArea,
  selectionPresence,
  setDimensions,
  setDoc,
  setInternalTimeOffset,
  setLoop,
  setMode,
  setNow,
  setOrigin,
  setPlaying,
  setSelectedNotes,
  setSelectionArea,
  setSelectionPresence,
  setTimeScale,
  setVolume,
  setZoom,
  sortNotes,
  timeScale,
  togglePlaying,
  url,
  urls,
  volume,
  zoom
} from './state'
import { Loop, NoteData } from './types'
import { downloadDataUri } from './utils/download-data-uri'
import { mod } from './utils/mod'
import { pointerHelper } from './utils/pointer-helper'

function Button(props: ComponentProps<'button'>) {
  return <button {...props} class={clsx(props.class, styles.button)} />
}

function createMidiDataUri(notes: Array<NoteData>) {
  const track = new MidiWriter.Track()
  const division = 8

  notes.forEach(note => {
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
          let time = Math.floor(delta.x / projectedWidth() / timeScale()) * timeScale()

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
                  initialNotes[note.id].pitch -
                  Math.floor((delta.y + projectedHeight() / 2) / projectedHeight())
                if (hasChanged) {
                  playNote(note)
                }
              }
            })
          })
          markOverlappingNotes(...selectedNotes())
        })
        if (Math.floor((delta.x + projectedWidth() / 2) / projectedWidth()) !== 0) {
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
        const deltaX = Math.floor(delta.x / projectedWidth() / timeScale()) * timeScale()
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
      const time =
        Math.floor((initialTime + delta.x / projectedWidth()) / timeScale()) * timeScale()
      const pitch = initialPitch - Math.floor((delta.y + projectedHeight() / 2) / projectedHeight())

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
      x={props.note.time * projectedWidth() + MARGIN}
      y={-props.note.pitch * projectedHeight() + MARGIN}
      width={(props.note._duration ?? props.note.duration) * projectedWidth() - MARGIN * 2}
      height={projectedHeight() - MARGIN * 2}
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
                transform: `translateY(${mod(-projectedOrigin().y, projectedHeight()) * -1}px)`
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
                          index + Math.floor(-projectedOrigin().y / projectedHeight()),
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
    <g style={{ transform: `translateY(${mod(-projectedOrigin().y, projectedHeight()) * -1}px)` }}>
      <Index each={new Array(Math.floor(dimensions().height / projectedHeight()) + 2)}>
        {(_, index) => {
          return (
            <rect
              y={index * projectedHeight()}
              x={0}
              width={projectedWidth()}
              height={projectedHeight()}
              opacity={0.8}
              style={{
                fill: isPitchPlaying(
                  -(index + Math.floor(-projectedOrigin().y / projectedHeight()))
                )
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
      x: event.layerX - projectedOrigin().x,
      y: event.layerY - projectedOrigin().y
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
      const offset = event.layerX - initialTime * projectedWidth() - projectedOrigin().x

      await pointerHelper(event, ({ delta }) => {
        const deltaX = Math.floor((delta.x + offset) / projectedWidth())
        if (deltaX >= initialDuration) {
          props.setLoop('duration', deltaX - initialDuration + 2)
        } else {
          const time = initialTime + deltaX
          props.setLoop('time', time)
          props.setLoop('duration', initialDuration - deltaX)
        }
      })
    } else if (event.layerX > left + width - projectedWidth() / 3) {
      await pointerHelper(event, ({ delta }) => {
        const duration =
          Math.floor((event.layerX - projectedOrigin().x + delta.x) / projectedWidth()) -
          initialTime

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
        height={projectedHeight()}
        fill="var(--color-piano-black)"
        onPointerDown={handleCreateLoop}
      />
      <Show when={props.loop}>
        {loop => (
          <rect
            x={loop().time * projectedWidth()}
            y={0}
            width={loop().duration * projectedWidth()}
            height={projectedHeight()}
            fill={selected() || trigger() ? 'var(--color-loop-selected)' : 'var(--color-loop)'}
            style={{ transform: `translateX(${projectedOrigin().x}px)`, transition: 'fill 0.25s' }}
            onPointerDown={event => handleAdjustLoop(event, loop())}
          />
        )}
      </Show>
      {/* Now Indicator */}
      <rect
        class={styles.now}
        width={projectedWidth() * timeScale()}
        height={projectedHeight()}
        style={{
          opacity: 0.5,
          transform: `translateX(${
            projectedOrigin().x + Math.floor(now() / timeScale()) * projectedWidth() * timeScale()
          }px)`
        }}
      />
      <line
        x1={0}
        x2={dimensions().width}
        y1={projectedHeight()}
        y2={projectedHeight()}
        stroke="var(--color-stroke)"
      />
      <g style={{ transform: `translateX(${projectedOrigin().x % (projectedWidth() * 8)}px)` }}>
        <Index each={new Array(Math.floor(dimensions().width / projectedWidth() / 8) + 2)}>
          {(_, index) => (
            <line
              y1={0}
              y2={projectedHeight()}
              x1={index * projectedWidth() * 8}
              x2={index * projectedWidth() * 8}
              stroke="var(--color-stroke)"
              stroke-width="2px"
            />
          )}
        </Index>
      </g>
      <g style={{ transform: `translateX(${projectedOrigin().x % projectedWidth()}px)` }}>
        <Index each={new Array(Math.floor(dimensions().width / projectedWidth()) + 2)}>
          {(_, index) => (
            <line
              y1={0}
              y2={projectedHeight()}
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
          transform: `translateX(${projectedOrigin().x % (projectedWidth() * timeScale())}px)`
        }}
      >
        <Index
          each={new Array(Math.floor(dimensions().width / projectedWidth() / timeScale()) + 2)}
        >
          {(_, index) => (
            <line
              y1={0}
              y2={dimensions().height}
              x1={index * timeScale() * projectedWidth()}
              x2={index * timeScale() * projectedWidth()}
              stroke="var(--color-stroke-secondary)"
            />
          )}
        </Index>
      </g>
      <g style={{ transform: `translateX(${projectedOrigin().x % (projectedWidth() * 8)}px)` }}>
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
    <g style={{ transform: `translateY(${-mod(-projectedOrigin().y, projectedHeight())}px)` }}>
      <Index each={new Array(Math.floor(dimensions().height / projectedHeight()) + 2)}>
        {(_, index) => (
          <rect
            y={index * projectedHeight()}
            width={dimensions().width}
            height={projectedHeight()}
            style={{
              'pointer-events': 'none',
              fill: KEY_COLORS[
                mod(index + Math.floor(-projectedOrigin().y / projectedHeight()), KEY_COLORS.length)
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
        <Show when={mode() === 'select'}>
          <ActionButton
            disabled={selectionArea() === undefined}
            class={clsx(mode() === 'stretch' && styles.active)}
            onClick={() => {
              const area = selectionArea()
              if (!area) {
                console.error('Trying to ')
                return
              }
              setLoop({
                time: area.start.x,
                duration: area.end.x - area.start.x
              })
            }}
          >
            <IconGrommetIconsCycle style={{ 'margin-top': '3px' }} />
          </ActionButton>
        </Show>
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
          class={mode() === 'select' ? styles.active : undefined}
          onClick={() => setMode('select')}
        >
          <IconGrommetIconsSelect />
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
        <Button class={mode() === 'pan' ? styles.active : undefined} onClick={() => setMode('pan')}>
          <IconGrommetIconsPan />
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
                <ActionButton
                  disabled={!hasClipboardAndPresence()}
                  class={clsx(mode() === 'stretch' && styles.active)}
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
                  class={clsx(mode() === 'stretch' && styles.active)}
                  onClick={copyNotes}
                >
                  <IconGrommetIconsClipboard />
                </ActionButton>

                <ActionButton
                  disabled={selectedNotes().length === 0}
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
                        } satisfies NoteData
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
                  disabled={selectedNotes().length === 0}
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
                  disabled={selectedNotes().length === 0}
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
            </div>
          )
        }}
      </Show>
    </div>
  )
}

function BottomLeftHud() {
  return (
    <div class={styles.bottomLeftHud}>
      <div class={styles.list}>
        <DropdownMenu>
          <DropdownMenu.Trigger as={Button}>
            <IconGrommetIconsMenu />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class={styles['dropdown-menu__content']}>
              <DropdownMenu.Item as={Button} class={styles['dropdown-menu__item']} onClick={newDoc}>
                New File <div class={styles['dropdown-menu__item-right-slot']}>⌘+N</div>
              </DropdownMenu.Item>
              <DropdownMenu.Sub overlap gutter={4} shift={-8}>
                <DropdownMenu.SubTrigger as={Button} class={styles['dropdown-menu__sub-trigger']}>
                  Open File <div class={styles['dropdown-menu__item-right-slot']}>⌘+O</div>
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent class={styles['dropdown-menu__sub-content']}>
                    <For each={Object.entries(urls()).sort(([, a], [, b]) => (a - b > 0 ? -1 : 1))}>
                      {([_url, date]) => (
                        <DropdownMenu.Item
                          as={Button}
                          class={clsx(
                            styles['dropdown-menu__item'],
                            url() === _url && styles.current
                          )}
                          onClick={() => openUrl(_url)}
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
          label="zoom time"
          value={zoom().x}
          decrement={() => setZoom(zoom => ({ ...zoom, x: zoom.x + 0.1 }))}
          increment={() => setZoom(zoom => ({ ...zoom, x: zoom.x - 0.1 }))}
          canDecrement={zoom().x > 0}
          canIncrement={zoom().x < 10}
        />
      </div>
      <div>
        <NumberButton
          label="zoom pitch"
          value={zoom().y}
          decrement={() => setZoom(zoom => ({ ...zoom, y: zoom.y + 0.1 }))}
          increment={() => setZoom(zoom => ({ ...zoom, y: zoom.y - 0.1 }))}
          canDecrement={zoom().y > 0}
          canIncrement={zoom().y < 10}
        />
      </div>
      <div>
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
          value={doc().bpm}
          decrement={() => setDoc(doc => (doc.bpm = Math.max(0, doc.bpm - 1)))}
          increment={() => setDoc(doc => (doc.bpm = Math.min(1000, doc.bpm + 1)))}
          canDecrement={doc().bpm > 0}
          canIncrement={doc().bpm < 1000}
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
  let lastVelocity = doc().bpm / 60 // Track the last velocity to adjust time offset

  createEffect(
    on(playing, playing => {
      if (!playing || !audioContext) return

      let shouldPlay = true

      // Adjust timeOffset when BPM changes to prevent abrupt shifts
      const newVelocity = doc().bpm / 60
      const currentTime = audioContext!.currentTime
      const elapsedTime = currentTime * lastVelocity - internalTimeOffset()
      setInternalTimeOffset(currentTime * newVelocity - elapsedTime)
      lastVelocity = newVelocity

      function clock() {
        if (!shouldPlay) return

        const VELOCITY = doc().bpm / 60 // Calculate velocity dynamically from BPM
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
          onDblClick={() => setSelectedNotes([])}
          onWheel={event =>
            setOrigin(origin => ({
              x: origin.x - event.deltaX / zoom().x,
              y: origin.y - (event.deltaY / zoom().y) * (2 / 3)
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
                      x={area().start.x * projectedWidth() + projectedOrigin().x}
                      y={area().start.y * projectedHeight() + projectedOrigin().y}
                      width={(area().end.x - area().start.x) * projectedWidth()}
                      height={(area().end.y - area().start.y) * projectedHeight()}
                      opacity={0.3}
                      fill="var(--color-selection-area)"
                    />
                  )}
                </Show>
                {/* Selection Presence */}
                <Show when={mode() === 'select' && selectionPresence()}>
                  {presence => (
                    <rect
                      x={presence().x * projectedWidth() + projectedOrigin().x}
                      y={presence().y * projectedHeight() + projectedOrigin().y}
                      width={projectedWidth() * timeScale()}
                      height={projectedHeight()}
                      opacity={0.8}
                      fill="var(--color-selection-area)"
                    />
                  )}
                </Show>
                {/* Notes */}
                <Show when={doc().notes.length > 0}>
                  <g
                    style={{
                      transform: `translate(${projectedOrigin().x}px, ${projectedOrigin().y}px)`
                    }}
                  >
                    <For each={doc().notes}>{note => <Note note={note} />}</For>
                  </g>
                </Show>
                {/* Now Underlay */}
                <rect
                  class={styles.now}
                  width={projectedWidth() * timeScale()}
                  height={dimensions().height}
                  style={{
                    opacity: 0.075,
                    transform: `translateX(${
                      projectedOrigin().x +
                      Math.floor(now() / timeScale()) * projectedWidth() * timeScale()
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
