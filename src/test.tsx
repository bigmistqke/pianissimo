import { createSignal } from 'solid-js'
import { createStore } from 'solid-js/store'
import { render } from 'solid-js/web'

type Patch = {
  op: 'add' | 'update' | 'delete'
  path: string[]
  value?: any
}

function createPatchingProxy<T extends object>(target: T, basePath: string[] = []) {
  const patches: Patch[] = []
  function createProxy(target: any, currentPath: string[]): ProxyHandler<any> {
    return new Proxy(Array.isArray(target) ? [...target] : { ...target }, {
      get(obj, prop) {
        const value = obj[prop]
        if (typeof value === 'object' && value !== null) {
          return createProxy(value, [...currentPath, prop.toString()])
        }
        return value
      },
      set(obj, prop, value) {
        const fullPath = [...currentPath, prop.toString()]
        if (prop in obj) {
          patches.push({ op: 'update', path: fullPath, value })
        } else {
          patches.push({ op: 'add', path: fullPath, value })
        }
        obj[prop] = value
        return true
      },
      deleteProperty(obj, prop) {
        if (prop in obj) {
          const fullPath = [...currentPath, prop.toString()]
          patches.push({ op: 'delete', path: fullPath })
          delete obj[prop]
          return true
        }
        return false
      }
    })
  }

  return {
    proxy: createProxy(target, basePath),
    getPatches: () => patches,
    clearPatches: () => (patches.length = 0)
  }
}

const [store, setStore] = createStore({ id: 'hallo' })

// Example usage:
const { proxy, getPatches } = createPatchingProxy(store)

proxy.name = 'Bob' // Update

console.log(getPatches(), store, proxy)

function Counter() {
  const [count, setCount] = createSignal(1)
  const increment = () => setCount(count => count + 1)

  return (
    <button type="button" onClick={increment}>
      {count()}
    </button>
  )
}

render(() => <Counter />, document.getElementById('app')!)
