interface Vector {
  x: number
  y: number
}

/**
 * dragHelper
 *
 * @param e MouseEvent
 * @param callback called every onMouseMove
 * @returns Promise resolved onMouseUp
 */
export const pointerHelper = (
  e: PointerEvent,
  callback?: (event: { delta: Vector; movement: Vector; event: PointerEvent; time: number }) => void
) => {
  return new Promise<{
    delta: Vector
    movement: Vector
    event: PointerEvent
    time: number
  }>(resolve => {
    const start = {
      x: e.clientX,
      y: e.clientY
    }
    const startTime = performance.now()
    let previousDelta = {
      x: 0,
      y: 0
    }

    function getDataFromPointerEvent(event: PointerEvent) {
      const delta = {
        x: event.clientX - start.x,
        y: event.clientY - start.y
      }
      const movement = {
        x: delta.x - previousDelta.x,
        y: delta.y - previousDelta.y
      }
      previousDelta = delta
      return {
        delta: {
          x: event.clientX - start.x,
          y: event.clientY - start.y
        },
        movement,
        event,
        time: performance.now() - startTime
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      callback?.(getDataFromPointerEvent(event))
    }

    const onPointerUp = (event: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      const data = getDataFromPointerEvent(event)
      callback?.(data)
      resolve(data)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  })
}
