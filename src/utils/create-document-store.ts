// Interpolated from https://github.com/chee/automerge-repo-solid-primitives

import type { Patch } from '@automerge/automerge'
import {
  isValidAutomergeUrl,
  type ChangeFn,
  type Doc,
  type DocHandle,
  type DocHandleChangePayload,
  type Repo
} from '@automerge/automerge-repo'
import { apply, fromAutomerge } from 'cabbages'
import { createResource, getOwner, onCleanup, onMount, runWithOwner } from 'solid-js'
import { createStore, produce, type Store } from 'solid-js/store'

export type DocumentStore<T> = [Store<Doc<T>>, (fn: ChangeFn<T>) => void]

export function autoproduce<T>(patches: Patch[]) {
  return produce<T>(doc => {
    for (let patch of patches) {
      const [path, range, val] = fromAutomerge(patch)
      apply(path, doc, range, val)
    }
  })
}

export function createDocumentStore<T extends object>({
  initialValue,
  url,
  repo
}: {
  initialValue: T
  url?: string
  repo: Repo
}) {
  let owner = getOwner()

  const handle: DocHandle<T> = isValidAutomergeUrl(url)
    ? repo.find(url)
    : repo.create<T>(initialValue)

  let [document] = createResource(
    async () => {
      await handle.whenReady()

      let [document, update] = createStore(handle.docSync() as Doc<T>)

      function patch(payload: DocHandleChangePayload<T>) {
        update(autoproduce(payload.patches))
      }

      handle.on('change', patch)
      runWithOwner(owner, () => onCleanup(() => handle.off('change', patch)))

      return document
    },
    {
      initialValue: handle.docSync() ?? initialValue
    }
  )

  let queue: ChangeFn<T>[] = []

  onMount(async () => {
    await handle.whenReady()
    if (handle) {
      let next
      while ((next = queue.shift())) {
        handle.change(next)
      }
    } else {
      queue = []
    }
  })

  return [
    document,
    (fn: ChangeFn<T>) => {
      if (handle.isReady()) {
        handle.change(fn)
      } else {
        queue.push(fn)
      }
    },
    handle.url
  ] as const
}
