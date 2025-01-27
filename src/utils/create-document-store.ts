// Interpolated from https://github.com/chee/automerge-repo-solid-primitives

import {
  DocHandle,
  isValidAutomergeUrl,
  type ChangeFn,
  type Doc,
  type Repo
} from '@automerge/automerge-repo'
import { apply, fromAutomerge } from 'cabbages'
import { createEffect, createSignal } from 'solid-js'
import { createStore, produce, reconcile, type Store } from 'solid-js/store'
import {
  applyPatches,
  createPatchProxy,
  optimizePatches,
  type Patch as ProxyPatch
} from './create-patch-proxy'

export type DocumentStore<T> = [Store<Doc<T>>, (fn: ChangeFn<T>) => void]

export function createDocumentStore<T extends object>({
  initialValue,
  url,
  repo
}: {
  initialValue: T
  url?: string
  repo: Repo
}) {
  const [handle, setHandle] = createSignal<DocHandle<T>>(
    isValidAutomergeUrl(url) ? repo.find(url) : repo.create<T>(initialValue)
  )

  const [doc, update] = createStore<T>({ ...(handle().docSync()! ?? initialValue) })

  let queue: ChangeFn<T>[] = []

  createEffect(async () => {
    await handle().whenReady()

    update(reconcile(handle().docSync()!))

    handle().on('change', payload => {
      console.log(payload.patches)
      update(
        produce<T>(doc => {
          for (let patch of payload.patches) {
            const [path, range, val] = fromAutomerge(patch)
            apply(path, doc, range, val)
          }
        })
      )
    })

    if (handle()) {
      let next
      while ((next = queue.shift())) {
        handle().change(next)
      }
    } else {
      queue = []
    }
  })

  return {
    get: () => doc,
    set(fn: ChangeFn<T>) {
      handle().change(fn)
      if (handle().isReady()) {
        handle().change(fn)
      } else {
        queue.push(fn)
      }
    },
    /**
     * Temporary local branch
     * - Before resolution: mutate solid's store directly
     * - After resolution: applies an optimized transformation operation on the automerge document
     **/
    async branch<U>(callback: (update: (fn: ChangeFn<T>) => void) => Promise<U>): Promise<U> {
      const patches = new Array<ProxyPatch>()
      const pathProxy = createPatchProxy((await handle().doc())!)
      const clone = repo.clone(handle())

      const result = await callback(function (fn: ChangeFn<T>) {
        fn(pathProxy.proxy)
        update(produce(doc => applyPatches(doc, pathProxy.patches)))
        patches.push(...pathProxy.patches)
        pathProxy.clearPatches()
      })

      // Apply optimized patches to clone
      clone.change(doc => applyPatches(doc, optimizePatches(patches)))
      // Merge clone into handle
      handle().merge(clone)

      return result!
    },
    async new() {
      setHandle(repo.create<T>(initialValue))
    },
    url() {
      return handle().url
    },
    async openUrl(url: string) {
      if (!isValidAutomergeUrl(url)) {
        throw `Url is not a valid automerge url`
      }
      setHandle(repo.find<T>(url))
    }
  }
}
