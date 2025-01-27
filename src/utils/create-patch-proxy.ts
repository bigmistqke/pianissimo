export type Patch =
  | {
      op: 'delete'
      path: string[]
    }
  | {
      op: 'update' | 'add'
      path: string[]
      value: any
    }
  | {
      op: 'splice'
      path: string[]
      start: number
      length: number
      values: Array<any>
    }

const $PATCH = Symbol()
let TRACKING = true

function untrack(callback: () => void) {
  TRACKING = false
  callback()
  TRACKING = true
}

export function createPatchProxy<T extends object>(target: T, basePath: string[] = []) {
  const patches = new Array<Patch>()

  function createProxy<T extends object>(target: T, currentPath: string[]): T {
    return new Proxy<T>(target, {
      get(obj, prop) {
        // Express all array mutations that result in shifting indices as splice-patches.
        if (Array.isArray(target)) {
          switch (prop) {
            case 'splice':
              return (start: number, length: number, ...values: Array<any>) => {
                target.splice(start, length, ...values)
                patches.push({
                  op: 'splice',
                  start,
                  length,
                  values,
                  path: currentPath
                })
              }
            case 'shift':
              return () => {
                patches.push({
                  op: 'splice',
                  start: 0,
                  length: 1,
                  values: [],
                  path: currentPath
                })
              }
            case 'unshift':
              return (...values: Array<any>) => {
                patches.push({
                  op: 'splice',
                  start: 0,
                  length: 0,
                  values,
                  path: currentPath
                })
              }
          }
        }

        if (!TRACKING) {
          return obj[prop]
        }

        if (prop === $PATCH) {
          return true
        }

        const value = obj[prop]

        if (typeof value === 'object' && value !== null) {
          if (!obj[$PATCH]) {
            obj[prop] = Array.isArray(value) ? [...value] : { ...value }
          }
          return createProxy(obj[prop], [...currentPath, prop.toString()])
        }

        return value
      },
      set(obj, prop, value) {
        if (!TRACKING || (Array.isArray(obj) && prop === 'length')) {
          target[prop] = value
          return true
        }

        const fullPath = [...currentPath, prop.toString()]

        if (prop in obj) {
          patches.push({ op: 'update', path: fullPath, value })
        } else {
          patches.push({ op: 'add', path: fullPath, value })
        }

        target[prop] = value

        return true
      },
      deleteProperty(obj, prop) {
        if (prop in obj) {
          const fullPath = [...currentPath, prop.toString()]
          patches.push({
            op: 'delete',
            path: fullPath,
            shifts: Array.isArray(obj)
          })
          delete obj[prop]
          return true
        }

        return false
      }
    })
  }

  return {
    proxy: createProxy<T>({ ...target }, basePath),
    patches,
    clearPatches: () => (patches.length = 0)
  }
}

interface ShiftIndex {
  indices: number[]
  apply: (index: number, delta: number) => void
  deleteAt: (index: number) => void
  insertAt: (index: number) => void
}

export function createShiftIndex(length: number): ShiftIndex {
  const indices = Array.from({ length }, (_, i) => i)
  function apply(index: number, delta: number) {
    for (let i = index; i < indices.length; i++) {
      if (indices[i] !== -1) {
        indices[i] += delta
      }
    }
  }
  function deleteAt(index: number) {
    indices[index] = -1
    apply(index + 1, -1)
  }
  function insertAt(index: number) {
    apply(index, 1)
    indices.splice(index, 0, index)
  }
  return {
    indices,
    apply,
    deleteAt,
    insertAt
  }
}

export function optimizePatches(patches: Array<Patch>) {
  const optimized: Patch[] = []

  // First pass: Create shift-index arrays for each unique array path
  const shiftIndices: Map<string, ShiftIndex> = new Map()

  // First pass: Process patches to build shift indices
  for (const patch of patches) {
    if (patch.op === 'splice' && patch.path.length > 0) {
      const arrayPath = patch.path.join('.')
      const { start, length, values } = patch

      if (!shiftIndices.has(arrayPath)) {
        // Initialize shift index based on the initial array size (guessing large enough size)
        shiftIndices.set(arrayPath, createShiftIndex(start + length + (values?.length || 0)))
      }

      const shiftIndex = shiftIndices.get(arrayPath)!

      // Apply delete part of splice
      for (let i = 0; i < length; i++) {
        shiftIndex.deleteAt(start)
      }

      // Apply insert part of splice
      if (values?.length) {
        for (let i = 0; i < values.length; i++) {
          shiftIndex.insertAt(start + i)
        }
      }
    }
  }

  // Second pass: Optimize patches based on shift indices
  const updateMap = new Map<string, Patch>()

  function resolveShiftedPath(path: string[]): string[] {
    const arrayPath = path.slice(0, -1).join('.')
    const lastSegment = path[path.length - 1]
    const arrayIndex = parseInt(lastSegment, 10)

    if (!shiftIndices.has(arrayPath) || isNaN(arrayIndex)) return path

    const shiftIndex = shiftIndices.get(arrayPath)!

    if (arrayIndex >= shiftIndex.indices.length || shiftIndex.indices[arrayIndex] === -1) {
      return path
    }

    const shiftedIndex = shiftIndex.indices[arrayIndex]
    return [...path.slice(0, -1), shiftedIndex.toString()]
  }

  const order = new Map<Patch, number>()

  for (let index = 0; index < patches.length; index++) {
    const patch = patches[index]
    const path = resolveShiftedPath(patch.path)
    const pathKey = path.join('.')
    order.set(patch, index)

    switch (patch.op) {
      case 'splice':
        optimized.push({ ...patch })
        const keys = [...updateMap.keys()]

        const affectedPaths = Array.from({ length: patch.length }, (_, index) => [
          ...patch.path,
          (index + patch.start).toString()
        ])

        keys
          .filter(key => {
            const splitKey = key.split('.')
            return affectedPaths.find(affectedPath =>
              affectedPath.every((part, index) => part === splitKey[index])
            )
          })
          .forEach(key => updateMap.delete(key))

        break
      case 'update':
        // Store only the last update for each path
        updateMap.set(pathKey, {
          ...patch,
          path
        })
        break
      default:
        optimized.push({ ...patch, path })
    }
  }

  // Add the latest updates to the optimized patches
  for (const update of updateMap.values()) {
    optimized.push(update)
  }

  optimized.sort((a, b) => (order.get(a)! - order.get(b)! < 0 ? -1 : 1))

  console.log('optimized', optimized)

  return optimized
}

export function applyPatches(target: object, patches: Array<Patch>) {
  untrack(() => {
    for (const patch of patches) {
      // Traverse the object to the second-to-last key
      const lastKey = patch.path[patch.path.length - 1]
      const parent = patch.path.slice(0, -1).reduce((acc, key) => {
        if (!(key in acc)) {
          console.log(patch.path, patch, target, patches)
          throw new Error(`Path not found: ${patch.path.join('.')}`)
        }
        return acc[key]
      }, target)

      switch (patch.op) {
        case 'splice':
          parent[lastKey].splice(patch.start, patch.length, ...patch.values)
          break
        case 'add':
        case 'update':
          parent[lastKey] = patch.value
          break
        case 'delete':
          if (lastKey in parent) {
            delete parent[lastKey]
          } else {
            throw new Error(`Key not found for deletion: ${patch.path.join('.')}`)
          }
          break
        default:
          throw new Error(`Unknown operation: ${patch.op}`)
      }
    }
  })
  return target
}
