true&&(function polyfill() {
  const relList = document.createElement("link").relList;
  if (relList && relList.supports && relList.supports("modulepreload")) {
    return;
  }
  for (const link of document.querySelectorAll('link[rel="modulepreload"]')) {
    processPreload(link);
  }
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== "childList") {
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node.tagName === "LINK" && node.rel === "modulepreload")
          processPreload(node);
      }
    }
  }).observe(document, { childList: true, subtree: true });
  function getFetchOpts(link) {
    const fetchOpts = {};
    if (link.integrity) fetchOpts.integrity = link.integrity;
    if (link.referrerPolicy) fetchOpts.referrerPolicy = link.referrerPolicy;
    if (link.crossOrigin === "use-credentials")
      fetchOpts.credentials = "include";
    else if (link.crossOrigin === "anonymous") fetchOpts.credentials = "omit";
    else fetchOpts.credentials = "same-origin";
    return fetchOpts;
  }
  function processPreload(link) {
    if (link.ep)
      return;
    link.ep = true;
    const fetchOpts = getFetchOpts(link);
    fetch(link.href, fetchOpts);
  }
}());

const equalFn = (a, b) => a === b;
const $PROXY = Symbol("solid-proxy");
const $TRACK = Symbol("solid-track");
const signalOptions = {
  equals: equalFn
};
let runEffects = runQueue;
const STALE = 1;
const PENDING = 2;
const UNOWNED = {
  owned: null,
  cleanups: null,
  context: null,
  owner: null
};
const NO_INIT = {};
var Owner = null;
let Transition = null;
let ExternalSourceConfig = null;
let Listener = null;
let Updates = null;
let Effects = null;
let ExecCount = 0;
function createRoot(fn, detachedOwner) {
  const listener = Listener,
    owner = Owner,
    unowned = fn.length === 0,
    current = detachedOwner === undefined ? owner : detachedOwner,
    root = unowned
      ? UNOWNED
      : {
          owned: null,
          cleanups: null,
          context: current ? current.context : null,
          owner: current
        },
    updateFn = unowned ? fn : () => fn(() => untrack(() => cleanNode(root)));
  Owner = root;
  Listener = null;
  try {
    return runUpdates(updateFn, true);
  } finally {
    Listener = listener;
    Owner = owner;
  }
}
function createSignal(value, options) {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const s = {
    value,
    observers: null,
    observerSlots: null,
    comparator: options.equals || undefined
  };
  const setter = value => {
    if (typeof value === "function") {
      value = value(s.value);
    }
    return writeSignal(s, value);
  };
  return [readSignal.bind(s), setter];
}
function createComputed(fn, value, options) {
  const c = createComputation(fn, value, true, STALE);
  updateComputation(c);
}
function createRenderEffect(fn, value, options) {
  const c = createComputation(fn, value, false, STALE);
  updateComputation(c);
}
function createEffect(fn, value, options) {
  runEffects = runUserEffects;
  const c = createComputation(fn, value, false, STALE);
  c.user = true;
  Effects ? Effects.push(c) : updateComputation(c);
}
function createMemo(fn, value, options) {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const c = createComputation(fn, value, true, 0);
  c.observers = null;
  c.observerSlots = null;
  c.comparator = options.equals || undefined;
  updateComputation(c);
  return readSignal.bind(c);
}
function isPromise(v) {
  return v && typeof v === "object" && "then" in v;
}
function createResource(pSource, pFetcher, pOptions) {
  let source;
  let fetcher;
  let options;
  if ((arguments.length === 2 && typeof pFetcher === "object") || arguments.length === 1) {
    source = true;
    fetcher = pSource;
    options = pFetcher;
  } else {
    source = pSource;
    fetcher = pFetcher;
    options = {};
  }
  let pr = null,
    initP = NO_INIT,
    scheduled = false,
    resolved = "initialValue" in options,
    dynamic = typeof source === "function" && createMemo(source);
  const contexts = new Set(),
    [value, setValue] = (options.storage || createSignal)(options.initialValue),
    [error, setError] = createSignal(undefined),
    [track, trigger] = createSignal(undefined, {
      equals: false
    }),
    [state, setState] = createSignal(resolved ? "ready" : "unresolved");
  function loadEnd(p, v, error, key) {
    if (pr === p) {
      pr = null;
      key !== undefined && (resolved = true);
      if ((p === initP || v === initP) && options.onHydrated)
        queueMicrotask(() =>
          options.onHydrated(key, {
            value: v
          })
        );
      initP = NO_INIT;
      completeLoad(v, error);
    }
    return v;
  }
  function completeLoad(v, err) {
    runUpdates(() => {
      if (err === undefined) setValue(() => v);
      setState(err !== undefined ? "errored" : resolved ? "ready" : "unresolved");
      setError(err);
      for (const c of contexts.keys()) c.decrement();
      contexts.clear();
    }, false);
  }
  function read() {
    const c = SuspenseContext,
      v = value(),
      err = error();
    if (err !== undefined && !pr) throw err;
    if (Listener && !Listener.user && c) ;
    return v;
  }
  function load(refetching = true) {
    if (refetching !== false && scheduled) return;
    scheduled = false;
    const lookup = dynamic ? dynamic() : source;
    if (lookup == null || lookup === false) {
      loadEnd(pr, untrack(value));
      return;
    }
    const p =
      initP !== NO_INIT
        ? initP
        : untrack(() =>
            fetcher(lookup, {
              value: value(),
              refetching
            })
          );
    if (!isPromise(p)) {
      loadEnd(pr, p, undefined, lookup);
      return p;
    }
    pr = p;
    if ("value" in p) {
      if (p.status === "success") loadEnd(pr, p.value, undefined, lookup);
      else loadEnd(pr, undefined, castError(p.value), lookup);
      return p;
    }
    scheduled = true;
    queueMicrotask(() => (scheduled = false));
    runUpdates(() => {
      setState(resolved ? "refreshing" : "pending");
      trigger();
    }, false);
    return p.then(
      v => loadEnd(p, v, undefined, lookup),
      e => loadEnd(p, undefined, castError(e), lookup)
    );
  }
  Object.defineProperties(read, {
    state: {
      get: () => state()
    },
    error: {
      get: () => error()
    },
    loading: {
      get() {
        const s = state();
        return s === "pending" || s === "refreshing";
      }
    },
    latest: {
      get() {
        if (!resolved) return read();
        const err = error();
        if (err && !pr) throw err;
        return value();
      }
    }
  });
  if (dynamic) createComputed(() => load(false));
  else load(false);
  return [
    read,
    {
      refetch: load,
      mutate: setValue
    }
  ];
}
function createSelector(source, fn = equalFn, options) {
  const subs = new Map();
  const node = createComputation(
    p => {
      const v = source();
      for (const [key, val] of subs.entries())
        if (fn(key, v) !== fn(key, p)) {
          for (const c of val.values()) {
            c.state = STALE;
            if (c.pure) Updates.push(c);
            else Effects.push(c);
          }
        }
      return v;
    },
    undefined,
    true,
    STALE
  );
  updateComputation(node);
  return key => {
    const listener = Listener;
    if (listener) {
      let l;
      if ((l = subs.get(key))) l.add(listener);
      else subs.set(key, (l = new Set([listener])));
      onCleanup(() => {
        l.delete(listener);
        !l.size && subs.delete(key);
      });
    }
    return fn(
      key,
      node.value
    );
  };
}
function batch(fn) {
  return runUpdates(fn, false);
}
function untrack(fn) {
  if (Listener === null) return fn();
  const listener = Listener;
  Listener = null;
  try {
    if (ExternalSourceConfig) ;
    return fn();
  } finally {
    Listener = listener;
  }
}
function on(deps, fn, options) {
  const isArray = Array.isArray(deps);
  let prevInput;
  return prevValue => {
    let input;
    if (isArray) {
      input = Array(deps.length);
      for (let i = 0; i < deps.length; i++) input[i] = deps[i]();
    } else input = deps();
    const result = untrack(() => fn(input, prevInput, prevValue));
    prevInput = input;
    return result;
  };
}
function onMount(fn) {
  createEffect(() => untrack(fn));
}
function onCleanup(fn) {
  if (Owner === null);
  else if (Owner.cleanups === null) Owner.cleanups = [fn];
  else Owner.cleanups.push(fn);
  return fn;
}
function getListener() {
  return Listener;
}
function getOwner() {
  return Owner;
}
function runWithOwner(o, fn) {
  const prev = Owner;
  const prevListener = Listener;
  Owner = o;
  Listener = null;
  try {
    return runUpdates(fn, true);
  } catch (err) {
    handleError$1(err);
  } finally {
    Owner = prev;
    Listener = prevListener;
  }
}
function createContext(defaultValue, options) {
  const id = Symbol("context");
  return {
    id,
    Provider: createProvider(id),
    defaultValue
  };
}
function useContext(context) {
  let value;
  return Owner && Owner.context && (value = Owner.context[context.id]) !== undefined
    ? value
    : context.defaultValue;
}
function children(fn) {
  const children = createMemo(fn);
  const memo = createMemo(() => resolveChildren(children()));
  memo.toArray = () => {
    const c = memo();
    return Array.isArray(c) ? c : c != null ? [c] : [];
  };
  return memo;
}
let SuspenseContext;
function readSignal() {
  if (this.sources && (this.state)) {
    if ((this.state) === STALE) updateComputation(this);
    else {
      const updates = Updates;
      Updates = null;
      runUpdates(() => lookUpstream(this), false);
      Updates = updates;
    }
  }
  if (Listener) {
    const sSlot = this.observers ? this.observers.length : 0;
    if (!Listener.sources) {
      Listener.sources = [this];
      Listener.sourceSlots = [sSlot];
    } else {
      Listener.sources.push(this);
      Listener.sourceSlots.push(sSlot);
    }
    if (!this.observers) {
      this.observers = [Listener];
      this.observerSlots = [Listener.sources.length - 1];
    } else {
      this.observers.push(Listener);
      this.observerSlots.push(Listener.sources.length - 1);
    }
  }
  return this.value;
}
function writeSignal(node, value, isComp) {
  let current =
    node.value;
  if (!node.comparator || !node.comparator(current, value)) {
    node.value = value;
    if (node.observers && node.observers.length) {
      runUpdates(() => {
        for (let i = 0; i < node.observers.length; i += 1) {
          const o = node.observers[i];
          const TransitionRunning = Transition && Transition.running;
          if (TransitionRunning && Transition.disposed.has(o)) ;
          if (TransitionRunning ? !o.tState : !o.state) {
            if (o.pure) Updates.push(o);
            else Effects.push(o);
            if (o.observers) markDownstream(o);
          }
          if (!TransitionRunning) o.state = STALE;
        }
        if (Updates.length > 10e5) {
          Updates = [];
          if (false);
          throw new Error();
        }
      }, false);
    }
  }
  return value;
}
function updateComputation(node) {
  if (!node.fn) return;
  cleanNode(node);
  const time = ExecCount;
  runComputation(
    node,
    node.value,
    time
  );
}
function runComputation(node, value, time) {
  let nextValue;
  const owner = Owner,
    listener = Listener;
  Listener = Owner = node;
  try {
    nextValue = node.fn(value);
  } catch (err) {
    if (node.pure) {
      {
        node.state = STALE;
        node.owned && node.owned.forEach(cleanNode);
        node.owned = null;
      }
    }
    node.updatedAt = time + 1;
    return handleError$1(err);
  } finally {
    Listener = listener;
    Owner = owner;
  }
  if (!node.updatedAt || node.updatedAt <= time) {
    if (node.updatedAt != null && "observers" in node) {
      writeSignal(node, nextValue);
    } else node.value = nextValue;
    node.updatedAt = time;
  }
}
function createComputation(fn, init, pure, state = STALE, options) {
  const c = {
    fn,
    state: state,
    updatedAt: null,
    owned: null,
    sources: null,
    sourceSlots: null,
    cleanups: null,
    value: init,
    owner: Owner,
    context: Owner ? Owner.context : null,
    pure
  };
  if (Owner === null);
  else if (Owner !== UNOWNED) {
    {
      if (!Owner.owned) Owner.owned = [c];
      else Owner.owned.push(c);
    }
  }
  return c;
}
function runTop(node) {
  if ((node.state) === 0) return;
  if ((node.state) === PENDING) return lookUpstream(node);
  if (node.suspense && untrack(node.suspense.inFallback)) return node.suspense.effects.push(node);
  const ancestors = [node];
  while ((node = node.owner) && (!node.updatedAt || node.updatedAt < ExecCount)) {
    if (node.state) ancestors.push(node);
  }
  for (let i = ancestors.length - 1; i >= 0; i--) {
    node = ancestors[i];
    if ((node.state) === STALE) {
      updateComputation(node);
    } else if ((node.state) === PENDING) {
      const updates = Updates;
      Updates = null;
      runUpdates(() => lookUpstream(node, ancestors[0]), false);
      Updates = updates;
    }
  }
}
function runUpdates(fn, init) {
  if (Updates) return fn();
  let wait = false;
  if (!init) Updates = [];
  if (Effects) wait = true;
  else Effects = [];
  ExecCount++;
  try {
    const res = fn();
    completeUpdates(wait);
    return res;
  } catch (err) {
    if (!wait) Effects = null;
    Updates = null;
    handleError$1(err);
  }
}
function completeUpdates(wait) {
  if (Updates) {
    runQueue(Updates);
    Updates = null;
  }
  if (wait) return;
  const e = Effects;
  Effects = null;
  if (e.length) runUpdates(() => runEffects(e), false);
}
function runQueue(queue) {
  for (let i = 0; i < queue.length; i++) runTop(queue[i]);
}
function runUserEffects(queue) {
  let i,
    userLength = 0;
  for (i = 0; i < queue.length; i++) {
    const e = queue[i];
    if (!e.user) runTop(e);
    else queue[userLength++] = e;
  }
  for (i = 0; i < userLength; i++) runTop(queue[i]);
}
function lookUpstream(node, ignore) {
  node.state = 0;
  for (let i = 0; i < node.sources.length; i += 1) {
    const source = node.sources[i];
    if (source.sources) {
      const state = source.state;
      if (state === STALE) {
        if (source !== ignore && (!source.updatedAt || source.updatedAt < ExecCount))
          runTop(source);
      } else if (state === PENDING) lookUpstream(source, ignore);
    }
  }
}
function markDownstream(node) {
  for (let i = 0; i < node.observers.length; i += 1) {
    const o = node.observers[i];
    if (!o.state) {
      o.state = PENDING;
      if (o.pure) Updates.push(o);
      else Effects.push(o);
      o.observers && markDownstream(o);
    }
  }
}
function cleanNode(node) {
  let i;
  if (node.sources) {
    while (node.sources.length) {
      const source = node.sources.pop(),
        index = node.sourceSlots.pop(),
        obs = source.observers;
      if (obs && obs.length) {
        const n = obs.pop(),
          s = source.observerSlots.pop();
        if (index < obs.length) {
          n.sourceSlots[s] = index;
          obs[index] = n;
          source.observerSlots[index] = s;
        }
      }
    }
  }
  if (node.tOwned) {
    for (i = node.tOwned.length - 1; i >= 0; i--) cleanNode(node.tOwned[i]);
    delete node.tOwned;
  }
  if (node.owned) {
    for (i = node.owned.length - 1; i >= 0; i--) cleanNode(node.owned[i]);
    node.owned = null;
  }
  if (node.cleanups) {
    for (i = node.cleanups.length - 1; i >= 0; i--) node.cleanups[i]();
    node.cleanups = null;
  }
  node.state = 0;
}
function castError(err) {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : "Unknown error", {
    cause: err
  });
}
function handleError$1(err, owner = Owner) {
  const error = castError(err);
  throw error;
}
function resolveChildren(children) {
  if (typeof children === "function" && !children.length) return resolveChildren(children());
  if (Array.isArray(children)) {
    const results = [];
    for (let i = 0; i < children.length; i++) {
      const result = resolveChildren(children[i]);
      Array.isArray(result) ? results.push.apply(results, result) : results.push(result);
    }
    return results;
  }
  return children;
}
function createProvider(id, options) {
  return function provider(props) {
    let res;
    createRenderEffect(
      () =>
        (res = untrack(() => {
          Owner.context = {
            ...Owner.context,
            [id]: props.value
          };
          return children(() => props.children);
        })),
      undefined
    );
    return res;
  };
}

const FALLBACK = Symbol("fallback");
function dispose(d) {
  for (let i = 0; i < d.length; i++) d[i]();
}
function mapArray(list, mapFn, options = {}) {
  let items = [],
    mapped = [],
    disposers = [],
    len = 0,
    indexes = mapFn.length > 1 ? [] : null;
  onCleanup(() => dispose(disposers));
  return () => {
    let newItems = list() || [],
      newLen = newItems.length,
      i,
      j;
    newItems[$TRACK];
    return untrack(() => {
      let newIndices, newIndicesNext, temp, tempdisposers, tempIndexes, start, end, newEnd, item;
      if (newLen === 0) {
        if (len !== 0) {
          dispose(disposers);
          disposers = [];
          items = [];
          mapped = [];
          len = 0;
          indexes && (indexes = []);
        }
        if (options.fallback) {
          items = [FALLBACK];
          mapped[0] = createRoot(disposer => {
            disposers[0] = disposer;
            return options.fallback();
          });
          len = 1;
        }
      } else if (len === 0) {
        mapped = new Array(newLen);
        for (j = 0; j < newLen; j++) {
          items[j] = newItems[j];
          mapped[j] = createRoot(mapper);
        }
        len = newLen;
      } else {
        temp = new Array(newLen);
        tempdisposers = new Array(newLen);
        indexes && (tempIndexes = new Array(newLen));
        for (
          start = 0, end = Math.min(len, newLen);
          start < end && items[start] === newItems[start];
          start++
        );
        for (
          end = len - 1, newEnd = newLen - 1;
          end >= start && newEnd >= start && items[end] === newItems[newEnd];
          end--, newEnd--
        ) {
          temp[newEnd] = mapped[end];
          tempdisposers[newEnd] = disposers[end];
          indexes && (tempIndexes[newEnd] = indexes[end]);
        }
        newIndices = new Map();
        newIndicesNext = new Array(newEnd + 1);
        for (j = newEnd; j >= start; j--) {
          item = newItems[j];
          i = newIndices.get(item);
          newIndicesNext[j] = i === undefined ? -1 : i;
          newIndices.set(item, j);
        }
        for (i = start; i <= end; i++) {
          item = items[i];
          j = newIndices.get(item);
          if (j !== undefined && j !== -1) {
            temp[j] = mapped[i];
            tempdisposers[j] = disposers[i];
            indexes && (tempIndexes[j] = indexes[i]);
            j = newIndicesNext[j];
            newIndices.set(item, j);
          } else disposers[i]();
        }
        for (j = start; j < newLen; j++) {
          if (j in temp) {
            mapped[j] = temp[j];
            disposers[j] = tempdisposers[j];
            if (indexes) {
              indexes[j] = tempIndexes[j];
              indexes[j](j);
            }
          } else mapped[j] = createRoot(mapper);
        }
        mapped = mapped.slice(0, (len = newLen));
        items = newItems.slice(0);
      }
      return mapped;
    });
    function mapper(disposer) {
      disposers[j] = disposer;
      if (indexes) {
        const [s, set] = createSignal(j);
        indexes[j] = set;
        return mapFn(newItems[j], s);
      }
      return mapFn(newItems[j]);
    }
  };
}
function indexArray(list, mapFn, options = {}) {
  let items = [],
    mapped = [],
    disposers = [],
    signals = [],
    len = 0,
    i;
  onCleanup(() => dispose(disposers));
  return () => {
    const newItems = list() || [],
      newLen = newItems.length;
    newItems[$TRACK];
    return untrack(() => {
      if (newLen === 0) {
        if (len !== 0) {
          dispose(disposers);
          disposers = [];
          items = [];
          mapped = [];
          len = 0;
          signals = [];
        }
        if (options.fallback) {
          items = [FALLBACK];
          mapped[0] = createRoot(disposer => {
            disposers[0] = disposer;
            return options.fallback();
          });
          len = 1;
        }
        return mapped;
      }
      if (items[0] === FALLBACK) {
        disposers[0]();
        disposers = [];
        items = [];
        mapped = [];
        len = 0;
      }
      for (i = 0; i < newLen; i++) {
        if (i < items.length && items[i] !== newItems[i]) {
          signals[i](() => newItems[i]);
        } else if (i >= items.length) {
          mapped[i] = createRoot(mapper);
        }
      }
      for (; i < items.length; i++) {
        disposers[i]();
      }
      len = signals.length = disposers.length = newLen;
      items = newItems.slice(0);
      return (mapped = mapped.slice(0, len));
    });
    function mapper(disposer) {
      disposers[i] = disposer;
      const [s, set] = createSignal(newItems[i]);
      signals[i] = set;
      return mapFn(s, i);
    }
  };
}
function createComponent(Comp, props) {
  return untrack(() => Comp(props || {}));
}

const narrowedError = name => `Stale read from <${name}>.`;
function For(props) {
  const fallback = "fallback" in props && {
    fallback: () => props.fallback
  };
  return createMemo(mapArray(() => props.each, props.children, fallback || undefined));
}
function Index(props) {
  const fallback = "fallback" in props && {
    fallback: () => props.fallback
  };
  return createMemo(indexArray(() => props.each, props.children, fallback || undefined));
}
function Show(props) {
  const keyed = props.keyed;
  const condition = createMemo(() => props.when, undefined, {
    equals: (a, b) => (keyed ? a === b : !a === !b)
  });
  return createMemo(
    () => {
      const c = condition();
      if (c) {
        const child = props.children;
        const fn = typeof child === "function" && child.length > 0;
        return fn
          ? untrack(() =>
              child(
                keyed
                  ? c
                  : () => {
                      if (!untrack(condition)) throw narrowedError("Show");
                      return props.when;
                    }
              )
            )
          : child;
      }
      return props.fallback;
    },
    undefined,
    undefined
  );
}

const ChildProperties = /*#__PURE__*/ new Set([
  "innerHTML",
  "textContent",
  "innerText",
  "children"
]);
const Aliases = /*#__PURE__*/ Object.assign(Object.create(null), {
  className: "class",
  htmlFor: "for"
});
const DelegatedEvents = /*#__PURE__*/ new Set([
  "beforeinput",
  "click",
  "dblclick",
  "contextmenu",
  "focusin",
  "focusout",
  "input",
  "keydown",
  "keyup",
  "mousedown",
  "mousemove",
  "mouseout",
  "mouseover",
  "mouseup",
  "pointerdown",
  "pointermove",
  "pointerout",
  "pointerover",
  "pointerup",
  "touchend",
  "touchmove",
  "touchstart"
]);
const SVGNamespace = {
  xlink: "http://www.w3.org/1999/xlink",
  xml: "http://www.w3.org/XML/1998/namespace"
};

function reconcileArrays(parentNode, a, b) {
  let bLength = b.length,
    aEnd = a.length,
    bEnd = bLength,
    aStart = 0,
    bStart = 0,
    after = a[aEnd - 1].nextSibling,
    map = null;
  while (aStart < aEnd || bStart < bEnd) {
    if (a[aStart] === b[bStart]) {
      aStart++;
      bStart++;
      continue;
    }
    while (a[aEnd - 1] === b[bEnd - 1]) {
      aEnd--;
      bEnd--;
    }
    if (aEnd === aStart) {
      const node = bEnd < bLength ? (bStart ? b[bStart - 1].nextSibling : b[bEnd - bStart]) : after;
      while (bStart < bEnd) parentNode.insertBefore(b[bStart++], node);
    } else if (bEnd === bStart) {
      while (aStart < aEnd) {
        if (!map || !map.has(a[aStart])) a[aStart].remove();
        aStart++;
      }
    } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
      const node = a[--aEnd].nextSibling;
      parentNode.insertBefore(b[bStart++], a[aStart++].nextSibling);
      parentNode.insertBefore(b[--bEnd], node);
      a[aEnd] = b[bEnd];
    } else {
      if (!map) {
        map = new Map();
        let i = bStart;
        while (i < bEnd) map.set(b[i], i++);
      }
      const index = map.get(a[aStart]);
      if (index != null) {
        if (bStart < index && index < bEnd) {
          let i = aStart,
            sequence = 1,
            t;
          while (++i < aEnd && i < bEnd) {
            if ((t = map.get(a[i])) == null || t !== index + sequence) break;
            sequence++;
          }
          if (sequence > index - bStart) {
            const node = a[aStart];
            while (bStart < index) parentNode.insertBefore(b[bStart++], node);
          } else parentNode.replaceChild(b[bStart++], a[aStart++]);
        } else aStart++;
      } else a[aStart++].remove();
    }
  }
}

const $$EVENTS = "_$DX_DELEGATE";
function render(code, element, init, options = {}) {
  let disposer;
  createRoot(dispose => {
    disposer = dispose;
    element === document
      ? code()
      : insert(element, code(), element.firstChild ? null : undefined, init);
  }, options.owner);
  return () => {
    disposer();
    element.textContent = "";
  };
}
function template(html, isImportNode, isSVG) {
  let node;
  const create = () => {
    const t = document.createElement("template");
    t.innerHTML = html;
    return isSVG ? t.content.firstChild.firstChild : t.content.firstChild;
  };
  const fn = isImportNode
    ? () => untrack(() => document.importNode(node || (node = create()), true))
    : () => (node || (node = create())).cloneNode(true);
  fn.cloneNode = fn;
  return fn;
}
function delegateEvents(eventNames, document = window.document) {
  const e = document[$$EVENTS] || (document[$$EVENTS] = new Set());
  for (let i = 0, l = eventNames.length; i < l; i++) {
    const name = eventNames[i];
    if (!e.has(name)) {
      e.add(name);
      document.addEventListener(name, eventHandler);
    }
  }
}
function setAttribute(node, name, value) {
  if (value == null) node.removeAttribute(name);
  else node.setAttribute(name, value);
}
function setAttributeNS(node, namespace, name, value) {
  if (value == null) node.removeAttributeNS(namespace, name);
  else node.setAttributeNS(namespace, name, value);
}
function setBoolAttribute(node, name, value) {
  value ? node.setAttribute(name, "") : node.removeAttribute(name);
}
function className(node, value) {
  if (value == null) node.removeAttribute("class");
  else node.className = value;
}
function addEventListener(node, name, handler, delegate) {
  if (delegate) {
    if (Array.isArray(handler)) {
      node[`$$${name}`] = handler[0];
      node[`$$${name}Data`] = handler[1];
    } else node[`$$${name}`] = handler;
  } else if (Array.isArray(handler)) {
    const handlerFn = handler[0];
    node.addEventListener(name, (handler[0] = e => handlerFn.call(node, handler[1], e)));
  } else node.addEventListener(name, handler, typeof handler !== "function" && handler);
}
function classList(node, value, prev = {}) {
  const classKeys = Object.keys(value || {}),
    prevKeys = Object.keys(prev);
  let i, len;
  for (i = 0, len = prevKeys.length; i < len; i++) {
    const key = prevKeys[i];
    if (!key || key === "undefined" || value[key]) continue;
    toggleClassKey(node, key, false);
    delete prev[key];
  }
  for (i = 0, len = classKeys.length; i < len; i++) {
    const key = classKeys[i],
      classValue = !!value[key];
    if (!key || key === "undefined" || prev[key] === classValue || !classValue) continue;
    toggleClassKey(node, key, true);
    prev[key] = classValue;
  }
  return prev;
}
function style(node, value, prev) {
  if (!value) return prev ? setAttribute(node, "style") : value;
  const nodeStyle = node.style;
  if (typeof value === "string") return (nodeStyle.cssText = value);
  typeof prev === "string" && (nodeStyle.cssText = prev = undefined);
  prev || (prev = {});
  value || (value = {});
  let v, s;
  for (s in prev) {
    value[s] == null && nodeStyle.removeProperty(s);
    delete prev[s];
  }
  for (s in value) {
    v = value[s];
    if (v !== prev[s]) {
      nodeStyle.setProperty(s, v);
      prev[s] = v;
    }
  }
  return prev;
}
function spread(node, props = {}, isSVG, skipChildren) {
  const prevProps = {};
  createRenderEffect(() => typeof props.ref === "function" && use(props.ref, node));
  createRenderEffect(() => assign$1(node, props, isSVG, true, prevProps, true));
  return prevProps;
}
function use(fn, element, arg) {
  return untrack(() => fn(element, arg));
}
function insert(parent, accessor, marker, initial) {
  if (marker !== undefined && !initial) initial = [];
  if (typeof accessor !== "function") return insertExpression(parent, accessor, initial, marker);
  createRenderEffect(current => insertExpression(parent, accessor(), current, marker), initial);
}
function assign$1(node, props, isSVG, skipChildren, prevProps = {}, skipRef = false) {
  props || (props = {});
  for (const prop in prevProps) {
    if (!(prop in props)) {
      if (prop === "children") continue;
      prevProps[prop] = assignProp(node, prop, null, prevProps[prop], isSVG, skipRef, props);
    }
  }
  for (const prop in props) {
    if (prop === "children") {
      continue;
    }
    const value = props[prop];
    prevProps[prop] = assignProp(node, prop, value, prevProps[prop], isSVG, skipRef, props);
  }
}
function toPropertyName(name) {
  return name.toLowerCase().replace(/-([a-z])/g, (_, w) => w.toUpperCase());
}
function toggleClassKey(node, key, value) {
  const classNames = key.trim().split(/\s+/);
  for (let i = 0, nameLen = classNames.length; i < nameLen; i++)
    node.classList.toggle(classNames[i], value);
}
function assignProp(node, prop, value, prev, isSVG, skipRef, props) {
  let isCE, isProp, isChildProp, forceProp;
  if (prop === "style") return style(node, value, prev);
  if (prop === "classList") return classList(node, value, prev);
  if (value === prev) return prev;
  if (prop === "ref") {
    if (!skipRef) value(node);
  } else if (prop.slice(0, 3) === "on:") {
    const e = prop.slice(3);
    prev && node.removeEventListener(e, prev, typeof prev !== "function" && prev);
    value && node.addEventListener(e, value, typeof value !== "function" && value);
  } else if (prop.slice(0, 10) === "oncapture:") {
    const e = prop.slice(10);
    prev && node.removeEventListener(e, prev, true);
    value && node.addEventListener(e, value, true);
  } else if (prop.slice(0, 2) === "on") {
    const name = prop.slice(2).toLowerCase();
    const delegate = DelegatedEvents.has(name);
    if (!delegate && prev) {
      const h = Array.isArray(prev) ? prev[0] : prev;
      node.removeEventListener(name, h);
    }
    if (delegate || value) {
      addEventListener(node, name, value, delegate);
      delegate && delegateEvents([name]);
    }
  } else if (prop.slice(0, 5) === "attr:") {
    setAttribute(node, prop.slice(5), value);
  } else if (prop.slice(0, 5) === "bool:") {
    setBoolAttribute(node, prop.slice(5), value);
  } else if (
    (forceProp = prop.slice(0, 5) === "prop:") ||
    (isChildProp = ChildProperties.has(prop)) ||
    (!isSVG) ||
    (isCE = node.nodeName.includes("-") || "is" in props)
  ) {
    if (forceProp) {
      prop = prop.slice(5);
      isProp = true;
    }
    if (prop === "class" || prop === "className") className(node, value);
    else if (isCE && !isProp && !isChildProp) node[toPropertyName(prop)] = value;
    else node[prop] = value;
  } else {
    const ns = prop.indexOf(":") > -1 && SVGNamespace[prop.split(":")[0]];
    if (ns) setAttributeNS(node, ns, prop, value);
    else setAttribute(node, Aliases[prop] || prop, value);
  }
  return value;
}
function eventHandler(e) {
  let node = e.target;
  const key = `$$${e.type}`;
  const oriTarget = e.target;
  const oriCurrentTarget = e.currentTarget;
  const retarget = value =>
    Object.defineProperty(e, "target", {
      configurable: true,
      value
    });
  const handleNode = () => {
    const handler = node[key];
    if (handler && !node.disabled) {
      const data = node[`${key}Data`];
      data !== undefined ? handler.call(node, data, e) : handler.call(node, e);
      if (e.cancelBubble) return;
    }
    node.host &&
      typeof node.host !== "string" &&
      !node.host._$host &&
      node.contains(e.target) &&
      retarget(node.host);
    return true;
  };
  const walkUpTree = () => {
    while (handleNode() && (node = node._$host || node.parentNode || node.host));
  };
  Object.defineProperty(e, "currentTarget", {
    configurable: true,
    get() {
      return node || document;
    }
  });
  if (e.composedPath) {
    const path = e.composedPath();
    retarget(path[0]);
    for (let i = 0; i < path.length - 2; i++) {
      node = path[i];
      if (!handleNode()) break;
      if (node._$host) {
        node = node._$host;
        walkUpTree();
        break;
      }
      if (node.parentNode === oriCurrentTarget) {
        break;
      }
    }
  } else walkUpTree();
  retarget(oriTarget);
}
function insertExpression(parent, value, current, marker, unwrapArray) {
  while (typeof current === "function") current = current();
  if (value === current) return current;
  const t = typeof value,
    multi = marker !== undefined;
  parent = (multi && current[0] && current[0].parentNode) || parent;
  if (t === "string" || t === "number") {
    if (t === "number") {
      value = value.toString();
      if (value === current) return current;
    }
    if (multi) {
      let node = current[0];
      if (node && node.nodeType === 3) {
        node.data !== value && (node.data = value);
      } else node = document.createTextNode(value);
      current = cleanChildren(parent, current, marker, node);
    } else {
      if (current !== "" && typeof current === "string") {
        current = parent.firstChild.data = value;
      } else current = parent.textContent = value;
    }
  } else if (value == null || t === "boolean") {
    current = cleanChildren(parent, current, marker);
  } else if (t === "function") {
    createRenderEffect(() => {
      let v = value();
      while (typeof v === "function") v = v();
      current = insertExpression(parent, v, current, marker);
    });
    return () => current;
  } else if (Array.isArray(value)) {
    const array = [];
    const currentArray = current && Array.isArray(current);
    if (normalizeIncomingArray(array, value, current, unwrapArray)) {
      createRenderEffect(() => (current = insertExpression(parent, array, current, marker, true)));
      return () => current;
    }
    if (array.length === 0) {
      current = cleanChildren(parent, current, marker);
      if (multi) return current;
    } else if (currentArray) {
      if (current.length === 0) {
        appendNodes(parent, array, marker);
      } else reconcileArrays(parent, current, array);
    } else {
      current && cleanChildren(parent);
      appendNodes(parent, array);
    }
    current = array;
  } else if (value.nodeType) {
    if (Array.isArray(current)) {
      if (multi) return (current = cleanChildren(parent, current, marker, value));
      cleanChildren(parent, current, null, value);
    } else if (current == null || current === "" || !parent.firstChild) {
      parent.appendChild(value);
    } else parent.replaceChild(value, parent.firstChild);
    current = value;
  } else;
  return current;
}
function normalizeIncomingArray(normalized, array, current, unwrap) {
  let dynamic = false;
  for (let i = 0, len = array.length; i < len; i++) {
    let item = array[i],
      prev = current && current[normalized.length],
      t;
    if (item == null || item === true || item === false);
    else if ((t = typeof item) === "object" && item.nodeType) {
      normalized.push(item);
    } else if (Array.isArray(item)) {
      dynamic = normalizeIncomingArray(normalized, item, prev) || dynamic;
    } else if (t === "function") {
      if (unwrap) {
        while (typeof item === "function") item = item();
        dynamic =
          normalizeIncomingArray(
            normalized,
            Array.isArray(item) ? item : [item],
            Array.isArray(prev) ? prev : [prev]
          ) || dynamic;
      } else {
        normalized.push(item);
        dynamic = true;
      }
    } else {
      const value = String(item);
      if (prev && prev.nodeType === 3 && prev.data === value) normalized.push(prev);
      else normalized.push(document.createTextNode(value));
    }
  }
  return dynamic;
}
function appendNodes(parent, array, marker = null) {
  for (let i = 0, len = array.length; i < len; i++) parent.insertBefore(array[i], marker);
}
function cleanChildren(parent, current, marker, replacement) {
  if (marker === undefined) return (parent.textContent = "");
  const node = replacement || document.createTextNode("");
  if (current.length) {
    let inserted = false;
    for (let i = current.length - 1; i >= 0; i--) {
      const el = current[i];
      if (node !== el) {
        const isParent = el.parentNode === parent;
        if (!inserted && !i)
          isParent ? parent.replaceChild(node, el) : parent.insertBefore(node, marker);
        else isParent && el.remove();
      } else inserted = true;
    }
  } else parent.insertBefore(node, marker);
  return [node];
}

function r(e){var t,f,n="";if("string"==typeof e||"number"==typeof e)n+=e;else if("object"==typeof e)if(Array.isArray(e)){var o=e.length;for(t=0;t<o;t++)e[t]&&(f=r(e[t]))&&(n&&(n+=" "),n+=f);}else for(f in e)e[f]&&(n&&(n+=" "),n+=f);return n}function clsx(){for(var e,t,f=0,n="",o=arguments.length;f<o;f++)(e=arguments[f])&&(t=r(e))&&(n&&(n+=" "),n+=t);return n}

function getDefaultExportFromCjs (x) {
	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
}

var build;
var hasRequiredBuild;

function requireBuild () {
	if (hasRequiredBuild) return build;
	hasRequiredBuild = 1;

	/**
	 * MIDI file format constants.
	 * @return {Constants}
	 */
	var Constants = {
	    VERSION: '3.1.1',
	    HEADER_CHUNK_TYPE: [0x4d, 0x54, 0x68, 0x64],
	    HEADER_CHUNK_LENGTH: [0x00, 0x00, 0x00, 0x06],
	    HEADER_CHUNK_FORMAT0: [0x00, 0x00],
	    HEADER_CHUNK_FORMAT1: [0x00, 0x01],
	    HEADER_CHUNK_DIVISION: [0x00, 0x80],
	    TRACK_CHUNK_TYPE: [0x4d, 0x54, 0x72, 0x6b],
	    META_EVENT_ID: 0xFF,
	    META_SMTPE_OFFSET: 0x54
	};

	// src/utils.ts
	var fillStr = (s, n) => Array(Math.abs(n) + 1).join(s);

	// src/named.ts
	function isNamed(src) {
	  return src !== null && typeof src === "object" && typeof src.name === "string" ? true : false;
	}

	// src/pitch.ts
	function isPitch(pitch) {
	  return pitch !== null && typeof pitch === "object" && typeof pitch.step === "number" && typeof pitch.alt === "number" ? true : false;
	}
	var FIFTHS = [0, 2, 4, -1, 1, 3, 5];
	var STEPS_TO_OCTS = FIFTHS.map(
	  (fifths) => Math.floor(fifths * 7 / 12)
	);
	function encode(pitch) {
	  const { step, alt, oct, dir = 1 } = pitch;
	  const f = FIFTHS[step] + 7 * alt;
	  if (oct === void 0) {
	    return [dir * f];
	  }
	  const o = oct - STEPS_TO_OCTS[step] - 4 * alt;
	  return [dir * f, dir * o];
	}

	// src/note.ts
	var NoNote = { empty: true, name: "", pc: "", acc: "" };
	var cache = /* @__PURE__ */ new Map();
	var stepToLetter = (step) => "CDEFGAB".charAt(step);
	var altToAcc = (alt) => alt < 0 ? fillStr("b", -alt) : fillStr("#", alt);
	var accToAlt = (acc) => acc[0] === "b" ? -acc.length : acc.length;
	function note(src) {
	  const stringSrc = JSON.stringify(src);
	  const cached = cache.get(stringSrc);
	  if (cached) {
	    return cached;
	  }
	  const value = typeof src === "string" ? parse(src) : isPitch(src) ? note(pitchName(src)) : isNamed(src) ? note(src.name) : NoNote;
	  cache.set(stringSrc, value);
	  return value;
	}
	var REGEX = /^([a-gA-G]?)(#{1,}|b{1,}|x{1,}|)(-?\d*)\s*(.*)$/;
	function tokenizeNote(str) {
	  const m = REGEX.exec(str);
	  return [m[1].toUpperCase(), m[2].replace(/x/g, "##"), m[3], m[4]];
	}
	var mod = (n, m) => (n % m + m) % m;
	var SEMI = [0, 2, 4, 5, 7, 9, 11];
	function parse(noteName) {
	  const tokens = tokenizeNote(noteName);
	  if (tokens[0] === "" || tokens[3] !== "") {
	    return NoNote;
	  }
	  const letter = tokens[0];
	  const acc = tokens[1];
	  const octStr = tokens[2];
	  const step = (letter.charCodeAt(0) + 3) % 7;
	  const alt = accToAlt(acc);
	  const oct = octStr.length ? +octStr : void 0;
	  const coord = encode({ step, alt, oct });
	  const name = letter + acc + octStr;
	  const pc = letter + acc;
	  const chroma = (SEMI[step] + alt + 120) % 12;
	  const height = oct === void 0 ? mod(SEMI[step] + alt, 12) - 12 * 99 : SEMI[step] + alt + 12 * (oct + 1);
	  const midi = height >= 0 && height <= 127 ? height : null;
	  const freq = oct === void 0 ? null : Math.pow(2, (height - 69) / 12) * 440;
	  return {
	    empty: false,
	    acc,
	    alt,
	    chroma,
	    coord,
	    freq,
	    height,
	    letter,
	    midi,
	    name,
	    oct,
	    pc,
	    step
	  };
	}
	function pitchName(props) {
	  const { step, alt, oct } = props;
	  const letter = stepToLetter(step);
	  if (!letter) {
	    return "";
	  }
	  const pc = letter + altToAcc(alt);
	  return oct || oct === 0 ? pc + oct : pc;
	}

	// index.ts
	function isMidi(arg) {
	  return +arg >= 0 && +arg <= 127;
	}
	function toMidi(note$1) {
	  if (isMidi(note$1)) {
	    return +note$1;
	  }
	  const n = note(note$1);
	  return n.empty ? null : n.midi;
	}

	/**
	 * Static utility functions used throughout the library.
	 */
	var Utils = /** @class */ (function () {
	    function Utils() {
	    }
	    /**
	     * Gets MidiWriterJS version number.
	     * @return {string}
	     */
	    Utils.version = function () {
	        return Constants.VERSION;
	    };
	    /**
	     * Convert a string to an array of bytes
	     * @param {string} string
	     * @return {array}
	     */
	    Utils.stringToBytes = function (string) {
	        return string.split('').map(function (char) { return char.charCodeAt(0); });
	    };
	    /**
	     * Checks if argument is a valid number.
	     * @param {*} n - Value to check
	     * @return {boolean}
	     */
	    // eslint-disable-next-line @typescript-eslint/no-explicit-any
	    Utils.isNumeric = function (n) {
	        return !isNaN(parseFloat(n)) && isFinite(n);
	    };
	    /**
	     * Returns the correct MIDI number for the specified pitch.
	     * Uses Tonal Midi - https://github.com/danigb/tonal/tree/master/packages/midi
	     * @param {(string|number)} pitch - 'C#4' or midi note code
	     * @param {string} middleC
	     * @return {number}
	     */
	    Utils.getPitch = function (pitch, middleC) {
	        if (middleC === void 0) { middleC = 'C4'; }
	        return 60 - toMidi(middleC) + toMidi(pitch);
	    };
	    /**
	     * Translates number of ticks to MIDI timestamp format, returning an array of
	     * hex strings with the time values. Midi has a very particular time to express time,
	     * take a good look at the spec before ever touching this function.
	     * Thanks to https://github.com/sergi/jsmidi
	     *
	     * @param {number} ticks - Number of ticks to be translated
	     * @return {array} - Bytes that form the MIDI time value
	     */
	    Utils.numberToVariableLength = function (ticks) {
	        ticks = Math.round(ticks);
	        var buffer = ticks & 0x7F;
	        // eslint-disable-next-line no-cond-assign
	        while (ticks = ticks >> 7) {
	            buffer <<= 8;
	            buffer |= ((ticks & 0x7F) | 0x80);
	        }
	        var bList = [];
	        // eslint-disable-next-line no-constant-condition
	        while (true) {
	            bList.push(buffer & 0xff);
	            if (buffer & 0x80)
	                buffer >>= 8;
	            else {
	                break;
	            }
	        }
	        return bList;
	    };
	    /**
	     * Counts number of bytes in string
	     * @param {string} s
	     * @return {number}
	     */
	    Utils.stringByteCount = function (s) {
	        return encodeURI(s).split(/%..|./).length - 1;
	    };
	    /**
	     * Get an int from an array of bytes.
	     * @param {array} bytes
	     * @return {number}
	     */
	    Utils.numberFromBytes = function (bytes) {
	        var hex = '';
	        var stringResult;
	        bytes.forEach(function (byte) {
	            stringResult = byte.toString(16);
	            // ensure string is 2 chars
	            if (stringResult.length == 1)
	                stringResult = "0" + stringResult;
	            hex += stringResult;
	        });
	        return parseInt(hex, 16);
	    };
	    /**
	     * Takes a number and splits it up into an array of bytes.  Can be padded by passing a number to bytesNeeded
	     * @param {number} number
	     * @param {number} bytesNeeded
	     * @return {array} - Array of bytes
	     */
	    Utils.numberToBytes = function (number, bytesNeeded) {
	        bytesNeeded = bytesNeeded || 1;
	        var hexString = number.toString(16);
	        if (hexString.length & 1) { // Make sure hex string is even number of chars
	            hexString = '0' + hexString;
	        }
	        // Split hex string into an array of two char elements
	        var hexArray = hexString.match(/.{2}/g);
	        // Now parse them out as integers
	        var intArray = hexArray.map(function (item) { return parseInt(item, 16); });
	        // Prepend empty bytes if we don't have enough
	        if (intArray.length < bytesNeeded) {
	            while (bytesNeeded - intArray.length > 0) {
	                intArray.unshift(0);
	            }
	        }
	        return intArray;
	    };
	    /**
	     * Converts value to array if needed.
	     * @param {any} value
	     * @return {array}
	     */
	    // eslint-disable-next-line @typescript-eslint/no-explicit-any
	    Utils.toArray = function (value) {
	        if (Array.isArray(value))
	            return value;
	        return [value];
	    };
	    /**
	     * Converts velocity to value 0-127
	     * @param {number} velocity - Velocity value 1-100
	     * @return {number}
	     */
	    Utils.convertVelocity = function (velocity) {
	        // Max passed value limited to 100
	        velocity = velocity > 100 ? 100 : velocity;
	        return Math.round(velocity / 100 * 127);
	    };
	    /**
	     * Gets the total number of ticks of a specified duration.
	     * Note: type=='note' defaults to quarter note, type==='rest' defaults to 0
	     * @param {(string|array)} duration
	     * @return {number}
	     */
	    Utils.getTickDuration = function (duration) {
	        if (Array.isArray(duration)) {
	            // Recursively execute this method for each item in the array and return the sum of tick durations.
	            return duration.map(function (value) {
	                return Utils.getTickDuration(value);
	            }).reduce(function (a, b) {
	                return a + b;
	            }, 0);
	        }
	        duration = duration.toString();
	        if (duration.toLowerCase().charAt(0) === 't') {
	            // If duration starts with 't' then the number that follows is an explicit tick count
	            var ticks = parseInt(duration.substring(1));
	            if (isNaN(ticks) || ticks < 0) {
	                throw new Error(duration + ' is not a valid duration.');
	            }
	            return ticks;
	        }
	        // Need to apply duration here.  Quarter note == Constants.HEADER_CHUNK_DIVISION
	        var quarterTicks = Utils.numberFromBytes(Constants.HEADER_CHUNK_DIVISION);
	        var tickDuration = quarterTicks * Utils.getDurationMultiplier(duration);
	        return Utils.getRoundedIfClose(tickDuration);
	    };
	    /**
	     * Due to rounding errors in JavaScript engines,
	     * it's safe to round when we're very close to the actual tick number
	     *
	     * @static
	     * @param {number} tick
	     * @return {number}
	     */
	    Utils.getRoundedIfClose = function (tick) {
	        var roundedTick = Math.round(tick);
	        return Math.abs(roundedTick - tick) < 0.000001 ? roundedTick : tick;
	    };
	    /**
	     * Due to low precision of MIDI,
	     * we need to keep track of rounding errors in deltas.
	     * This function will calculate the rounding error for a given duration.
	     *
	     * @static
	     * @param {number} tick
	     * @return {number}
	     */
	    Utils.getPrecisionLoss = function (tick) {
	        var roundedTick = Math.round(tick);
	        return roundedTick - tick;
	    };
	    /**
	     * Gets what to multiple ticks/quarter note by to get the specified duration.
	     * Note: type=='note' defaults to quarter note, type==='rest' defaults to 0
	     * @param {string} duration
	     * @return {number}
	     */
	    Utils.getDurationMultiplier = function (duration) {
	        // Need to apply duration here.
	        // Quarter note == Constants.HEADER_CHUNK_DIVISION ticks.
	        if (duration === '0')
	            return 0;
	        var match = duration.match(/^(?<dotted>d+)?(?<base>\d+)(?:t(?<tuplet>\d*))?/);
	        if (match) {
	            var base = Number(match.groups.base);
	            // 1 or any power of two:
	            var isValidBase = base === 1 || ((base & (base - 1)) === 0);
	            if (isValidBase) {
	                // how much faster or slower is this note compared to a quarter?
	                var ratio = base / 4;
	                var durationInQuarters = 1 / ratio;
	                var _a = match.groups, dotted = _a.dotted, tuplet = _a.tuplet;
	                if (dotted) {
	                    var thisManyDots = dotted.length;
	                    var divisor = Math.pow(2, thisManyDots);
	                    durationInQuarters = durationInQuarters + (durationInQuarters * ((divisor - 1) / divisor));
	                }
	                if (typeof tuplet === 'string') {
	                    var fitInto = durationInQuarters * 2;
	                    // default to triplet:
	                    var thisManyNotes = Number(tuplet || '3');
	                    durationInQuarters = fitInto / thisManyNotes;
	                }
	                return durationInQuarters;
	            }
	        }
	        throw new Error(duration + ' is not a valid duration.');
	    };
	    return Utils;
	}());

	/**
	 * Holds all data for a "controller change" MIDI event
	 * @param {object} fields {controllerNumber: integer, controllerValue: integer, delta: integer}
	 * @return {ControllerChangeEvent}
	 */
	var ControllerChangeEvent = /** @class */ (function () {
	    function ControllerChangeEvent(fields) {
	        this.channel = fields.channel - 1 || 0;
	        this.controllerValue = fields.controllerValue;
	        this.controllerNumber = fields.controllerNumber;
	        this.delta = fields.delta || 0x00;
	        this.name = 'ControllerChangeEvent';
	        this.status = 0xB0;
	        this.data = Utils.numberToVariableLength(fields.delta).concat(this.status | this.channel, this.controllerNumber, this.controllerValue);
	    }
	    return ControllerChangeEvent;
	}());

	/**
	 * Object representation of a tempo meta event.
	 * @param {object} fields {text: string, delta: integer}
	 * @return {CopyrightEvent}
	 */
	var CopyrightEvent = /** @class */ (function () {
	    function CopyrightEvent(fields) {
	        this.delta = fields.delta || 0x00;
	        this.name = 'CopyrightEvent';
	        this.text = fields.text;
	        this.type = 0x02;
	        var textBytes = Utils.stringToBytes(this.text);
	        // Start with zero time delta
	        this.data = Utils.numberToVariableLength(this.delta).concat(Constants.META_EVENT_ID, this.type, Utils.numberToVariableLength(textBytes.length), // Size
	        textBytes);
	    }
	    return CopyrightEvent;
	}());

	/**
	 * Object representation of a cue point meta event.
	 * @param {object} fields {text: string, delta: integer}
	 * @return {CuePointEvent}
	 */
	var CuePointEvent = /** @class */ (function () {
	    function CuePointEvent(fields) {
	        this.delta = fields.delta || 0x00;
	        this.name = 'CuePointEvent';
	        this.text = fields.text;
	        this.type = 0x07;
	        var textBytes = Utils.stringToBytes(this.text);
	        // Start with zero time delta
	        this.data = Utils.numberToVariableLength(this.delta).concat(Constants.META_EVENT_ID, this.type, Utils.numberToVariableLength(textBytes.length), // Size
	        textBytes);
	    }
	    return CuePointEvent;
	}());

	/**
	 * Object representation of a end track meta event.
	 * @param {object} fields {delta: integer}
	 * @return {EndTrackEvent}
	 */
	var EndTrackEvent = /** @class */ (function () {
	    function EndTrackEvent(fields) {
	        this.delta = (fields === null || fields === void 0 ? void 0 : fields.delta) || 0x00;
	        this.name = 'EndTrackEvent';
	        this.type = [0x2F, 0x00];
	        // Start with zero time delta
	        this.data = Utils.numberToVariableLength(this.delta).concat(Constants.META_EVENT_ID, this.type);
	    }
	    return EndTrackEvent;
	}());

	/**
	 * Object representation of an instrument name meta event.
	 * @param {object} fields {text: string, delta: integer}
	 * @return {InstrumentNameEvent}
	 */
	var InstrumentNameEvent = /** @class */ (function () {
	    function InstrumentNameEvent(fields) {
	        this.delta = fields.delta || 0x00;
	        this.name = 'InstrumentNameEvent';
	        this.text = fields.text;
	        this.type = 0x04;
	        var textBytes = Utils.stringToBytes(this.text);
	        // Start with zero time delta
	        this.data = Utils.numberToVariableLength(this.delta).concat(Constants.META_EVENT_ID, this.type, Utils.numberToVariableLength(textBytes.length), // Size
	        textBytes);
	    }
	    return InstrumentNameEvent;
	}());

	/**
	 * Object representation of a key signature meta event.
	 * @return {KeySignatureEvent}
	 */
	var KeySignatureEvent = /** @class */ (function () {
	    function KeySignatureEvent(sf, mi) {
	        this.name = 'KeySignatureEvent';
	        this.type = 0x59;
	        var mode = mi || 0;
	        sf = sf || 0;
	        //	Function called with string notation
	        if (typeof mi === 'undefined') {
	            var fifths = [
	                ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'],
	                ['ab', 'eb', 'bb', 'f', 'c', 'g', 'd', 'a', 'e', 'b', 'f#', 'c#', 'g#', 'd#', 'a#']
	            ];
	            var _sflen = sf.length;
	            var note = sf || 'C';
	            if (sf[0] === sf[0].toLowerCase())
	                mode = 1;
	            if (_sflen > 1) {
	                switch (sf.charAt(_sflen - 1)) {
	                    case 'm':
	                        mode = 1;
	                        note = sf.charAt(0).toLowerCase();
	                        note = note.concat(sf.substring(1, _sflen - 1));
	                        break;
	                    case '-':
	                        mode = 1;
	                        note = sf.charAt(0).toLowerCase();
	                        note = note.concat(sf.substring(1, _sflen - 1));
	                        break;
	                    case 'M':
	                        mode = 0;
	                        note = sf.charAt(0).toUpperCase();
	                        note = note.concat(sf.substring(1, _sflen - 1));
	                        break;
	                    case '+':
	                        mode = 0;
	                        note = sf.charAt(0).toUpperCase();
	                        note = note.concat(sf.substring(1, _sflen - 1));
	                        break;
	                }
	            }
	            var fifthindex = fifths[mode].indexOf(note);
	            sf = fifthindex === -1 ? 0 : fifthindex - 7;
	        }
	        // Start with zero time delta
	        this.data = Utils.numberToVariableLength(0x00).concat(Constants.META_EVENT_ID, this.type, [0x02], // Size
	        Utils.numberToBytes(sf, 1), // Number of sharp or flats ( < 0 flat; > 0 sharp)
	        Utils.numberToBytes(mode, 1));
	    }
	    return KeySignatureEvent;
	}());

	/**
	 * Object representation of a lyric meta event.
	 * @param {object} fields {text: string, delta: integer}
	 * @return {LyricEvent}
	 */
	var LyricEvent = /** @class */ (function () {
	    function LyricEvent(fields) {
	        this.delta = fields.delta || 0x00;
	        this.name = 'LyricEvent';
	        this.text = fields.text;
	        this.type = 0x05;
	        var textBytes = Utils.stringToBytes(this.text);
	        // Start with zero time delta
	        this.data = Utils.numberToVariableLength(this.delta).concat(Constants.META_EVENT_ID, this.type, Utils.numberToVariableLength(textBytes.length), // Size
	        textBytes);
	    }
	    return LyricEvent;
	}());

	/**
	 * Object representation of a marker meta event.
	 * @param {object} fields {text: string, delta: integer}
	 * @return {MarkerEvent}
	 */
	var MarkerEvent = /** @class */ (function () {
	    function MarkerEvent(fields) {
	        this.delta = fields.delta || 0x00;
	        this.name = 'MarkerEvent';
	        this.text = fields.text;
	        this.type = 0x06;
	        var textBytes = Utils.stringToBytes(this.text);
	        // Start with zero time delta
	        this.data = Utils.numberToVariableLength(this.delta).concat(Constants.META_EVENT_ID, this.type, Utils.numberToVariableLength(textBytes.length), // Size
	        textBytes);
	    }
	    return MarkerEvent;
	}());

	/**
	 * Holds all data for a "note on" MIDI event
	 * @param {object} fields {data: []}
	 * @return {NoteOnEvent}
	 */
	var NoteOnEvent = /** @class */ (function () {
	    function NoteOnEvent(fields) {
	        this.name = 'NoteOnEvent';
	        this.channel = fields.channel || 1;
	        this.pitch = fields.pitch;
	        this.wait = fields.wait || 0;
	        this.velocity = fields.velocity || 50;
	        this.tick = fields.tick || null;
	        this.delta = null;
	        this.data = fields.data;
	        this.status = 0x90;
	    }
	    /**
	     * Builds int array for this event.
	     * @param {Track} track - parent track
	     * @return {NoteOnEvent}
	     */
	    NoteOnEvent.prototype.buildData = function (track, precisionDelta, options) {
	        if (options === void 0) { options = {}; }
	        this.data = [];
	        // Explicitly defined startTick event
	        if (this.tick) {
	            this.tick = Utils.getRoundedIfClose(this.tick);
	            // If this is the first event in the track then use event's starting tick as delta.
	            if (track.tickPointer == 0) {
	                this.delta = this.tick;
	            }
	        }
	        else {
	            this.delta = Utils.getTickDuration(this.wait);
	            this.tick = Utils.getRoundedIfClose(track.tickPointer + this.delta);
	        }
	        this.deltaWithPrecisionCorrection = Utils.getRoundedIfClose(this.delta - precisionDelta);
	        this.data = Utils.numberToVariableLength(this.deltaWithPrecisionCorrection)
	            .concat(this.status | this.channel - 1, Utils.getPitch(this.pitch, options.middleC), Utils.convertVelocity(this.velocity));
	        return this;
	    };
	    return NoteOnEvent;
	}());

	/**
	 * Holds all data for a "note off" MIDI event
	 * @param {object} fields {data: []}
	 * @return {NoteOffEvent}
	 */
	var NoteOffEvent = /** @class */ (function () {
	    function NoteOffEvent(fields) {
	        this.name = 'NoteOffEvent';
	        this.channel = fields.channel || 1;
	        this.pitch = fields.pitch;
	        this.velocity = fields.velocity || 50;
	        this.tick = fields.tick || null;
	        this.data = fields.data;
	        this.delta = fields.delta || Utils.getTickDuration(fields.duration);
	        this.status = 0x80;
	    }
	    /**
	     * Builds int array for this event.
	     * @param {Track} track - parent track
	     * @return {NoteOffEvent}
	     */
	    NoteOffEvent.prototype.buildData = function (track, precisionDelta, options) {
	        if (options === void 0) { options = {}; }
	        if (this.tick === null) {
	            this.tick = Utils.getRoundedIfClose(this.delta + track.tickPointer);
	        }
	        this.deltaWithPrecisionCorrection = Utils.getRoundedIfClose(this.delta - precisionDelta);
	        this.data = Utils.numberToVariableLength(this.deltaWithPrecisionCorrection)
	            .concat(this.status | this.channel - 1, Utils.getPitch(this.pitch, options.middleC), Utils.convertVelocity(this.velocity));
	        return this;
	    };
	    return NoteOffEvent;
	}());

	/**
	 * Wrapper for noteOnEvent/noteOffEvent objects that builds both events.
	 * @param {object} fields - {pitch: '[C4]', duration: '4', wait: '4', velocity: 1-100}
	 * @return {NoteEvent}
	 */
	var NoteEvent = /** @class */ (function () {
	    function NoteEvent(fields) {
	        this.data = [];
	        this.name = 'NoteEvent';
	        this.pitch = Utils.toArray(fields.pitch);
	        this.channel = fields.channel || 1;
	        this.duration = fields.duration || '4';
	        this.grace = fields.grace;
	        this.repeat = fields.repeat || 1;
	        this.sequential = fields.sequential || false;
	        this.tick = fields.startTick || fields.tick || null;
	        this.velocity = fields.velocity || 50;
	        this.wait = fields.wait || 0;
	        this.tickDuration = Utils.getTickDuration(this.duration);
	        this.restDuration = Utils.getTickDuration(this.wait);
	        this.events = []; // Hold actual NoteOn/NoteOff events
	    }
	    /**
	     * Builds int array for this event.
	     * @return {NoteEvent}
	     */
	    NoteEvent.prototype.buildData = function () {
	        var _this = this;
	        // Reset data array
	        this.data = [];
	        // Apply grace note(s) and subtract ticks (currently 1 tick per grace note) from tickDuration so net value is the same
	        if (this.grace) {
	            var graceDuration_1 = 1;
	            this.grace = Utils.toArray(this.grace);
	            this.grace.forEach(function () {
	                var noteEvent = new NoteEvent({ pitch: _this.grace, duration: 'T' + graceDuration_1 });
	                _this.data = _this.data.concat(noteEvent.data);
	            });
	        }
	        // fields.pitch could be an array of pitches.
	        // If so create note events for each and apply the same duration.
	        // By default this is a chord if it's an array of notes that requires one NoteOnEvent.
	        // If this.sequential === true then it's a sequential string of notes that requires separate NoteOnEvents.
	        if (!this.sequential) {
	            // Handle repeat
	            for (var j = 0; j < this.repeat; j++) {
	                // Note on
	                this.pitch.forEach(function (p, i) {
	                    var noteOnNew;
	                    if (i == 0) {
	                        noteOnNew = new NoteOnEvent({
	                            channel: _this.channel,
	                            wait: _this.wait,
	                            delta: Utils.getTickDuration(_this.wait),
	                            velocity: _this.velocity,
	                            pitch: p,
	                            tick: _this.tick,
	                        });
	                    }
	                    else {
	                        // Running status (can ommit the note on status)
	                        //noteOn = new NoteOnEvent({data: [0, Utils.getPitch(p), Utils.convertVelocity(this.velocity)]});
	                        noteOnNew = new NoteOnEvent({
	                            channel: _this.channel,
	                            wait: 0,
	                            delta: 0,
	                            velocity: _this.velocity,
	                            pitch: p,
	                            tick: _this.tick,
	                        });
	                    }
	                    _this.events.push(noteOnNew);
	                });
	                // Note off
	                this.pitch.forEach(function (p, i) {
	                    var noteOffNew;
	                    if (i == 0) {
	                        //noteOff = new NoteOffEvent({data: Utils.numberToVariableLength(tickDuration).concat(this.getNoteOffStatus(), Utils.getPitch(p), Utils.convertVelocity(this.velocity))});
	                        noteOffNew = new NoteOffEvent({
	                            channel: _this.channel,
	                            duration: _this.duration,
	                            velocity: _this.velocity,
	                            pitch: p,
	                            tick: _this.tick !== null ? Utils.getTickDuration(_this.duration) + _this.tick : null,
	                        });
	                    }
	                    else {
	                        // Running status (can omit the note off status)
	                        //noteOff = new NoteOffEvent({data: [0, Utils.getPitch(p), Utils.convertVelocity(this.velocity)]});
	                        noteOffNew = new NoteOffEvent({
	                            channel: _this.channel,
	                            duration: 0,
	                            velocity: _this.velocity,
	                            pitch: p,
	                            tick: _this.tick !== null ? Utils.getTickDuration(_this.duration) + _this.tick : null,
	                        });
	                    }
	                    _this.events.push(noteOffNew);
	                });
	            }
	        }
	        else {
	            // Handle repeat
	            for (var j = 0; j < this.repeat; j++) {
	                this.pitch.forEach(function (p, i) {
	                    var noteOnNew = new NoteOnEvent({
	                        channel: _this.channel,
	                        wait: (i > 0 ? 0 : _this.wait),
	                        delta: (i > 0 ? 0 : Utils.getTickDuration(_this.wait)),
	                        velocity: _this.velocity,
	                        pitch: p,
	                        tick: _this.tick,
	                    });
	                    var noteOffNew = new NoteOffEvent({
	                        channel: _this.channel,
	                        duration: _this.duration,
	                        velocity: _this.velocity,
	                        pitch: p,
	                    });
	                    _this.events.push(noteOnNew, noteOffNew);
	                });
	            }
	        }
	        return this;
	    };
	    return NoteEvent;
	}());

	/**
	 * Holds all data for a "Pitch Bend" MIDI event
	 * [ -1.0, 0, 1.0 ] ->  [ 0, 8192, 16383]
	 * @param {object} fields { bend : float, channel : int, delta: int }
	 * @return {PitchBendEvent}
	 */
	var PitchBendEvent = /** @class */ (function () {
	    function PitchBendEvent(fields) {
	        this.channel = fields.channel || 0;
	        this.delta = fields.delta || 0x00;
	        this.name = 'PitchBendEvent';
	        this.status = 0xE0;
	        var bend14 = this.scale14bits(fields.bend);
	        var lsbValue = bend14 & 0x7f;
	        var msbValue = (bend14 >> 7) & 0x7f;
	        this.data = Utils.numberToVariableLength(this.delta).concat(this.status | this.channel, lsbValue, msbValue);
	    }
	    PitchBendEvent.prototype.scale14bits = function (zeroOne) {
	        if (zeroOne <= 0) {
	            return Math.floor(16384 * (zeroOne + 1) / 2);
	        }
	        return Math.floor(16383 * (zeroOne + 1) / 2);
	    };
	    return PitchBendEvent;
	}());

	/**
	 * Holds all data for a "program change" MIDI event
	 * @param {object} fields {instrument: integer, delta: integer}
	 * @return {ProgramChangeEvent}
	 */
	var ProgramChangeEvent = /** @class */ (function () {
	    function ProgramChangeEvent(fields) {
	        this.channel = fields.channel || 0;
	        this.delta = fields.delta || 0x00;
	        this.instrument = fields.instrument;
	        this.status = 0xC0;
	        this.name = 'ProgramChangeEvent';
	        // delta time defaults to 0.
	        this.data = Utils.numberToVariableLength(this.delta).concat(this.status | this.channel, this.instrument);
	    }
	    return ProgramChangeEvent;
	}());

	/**
	 * Object representation of a tempo meta event.
	 * @param {object} fields {bpm: integer, delta: integer}
	 * @return {TempoEvent}
	 */
	var TempoEvent = /** @class */ (function () {
	    function TempoEvent(fields) {
	        this.bpm = fields.bpm;
	        this.delta = fields.delta || 0x00;
	        this.tick = fields.tick;
	        this.name = 'TempoEvent';
	        this.type = 0x51;
	        var tempo = Math.round(60000000 / this.bpm);
	        // Start with zero time delta
	        this.data = Utils.numberToVariableLength(this.delta).concat(Constants.META_EVENT_ID, this.type, [0x03], // Size
	        Utils.numberToBytes(tempo, 3));
	    }
	    return TempoEvent;
	}());

	/**
	 * Object representation of a tempo meta event.
	 * @param {object} fields {text: string, delta: integer}
	 * @return {TextEvent}
	 */
	var TextEvent = /** @class */ (function () {
	    function TextEvent(fields) {
	        this.delta = fields.delta || 0x00;
	        this.text = fields.text;
	        this.name = 'TextEvent';
	        this.type = 0x01;
	        var textBytes = Utils.stringToBytes(this.text);
	        // Start with zero time delta
	        this.data = Utils.numberToVariableLength(fields.delta).concat(Constants.META_EVENT_ID, this.type, Utils.numberToVariableLength(textBytes.length), // Size
	        textBytes);
	    }
	    return TextEvent;
	}());

	/**
	 * Object representation of a time signature meta event.
	 * @return {TimeSignatureEvent}
	 */
	var TimeSignatureEvent = /** @class */ (function () {
	    function TimeSignatureEvent(numerator, denominator, midiclockspertick, notespermidiclock) {
	        this.name = 'TimeSignatureEvent';
	        this.type = 0x58;
	        // Start with zero time delta
	        this.data = Utils.numberToVariableLength(0x00).concat(Constants.META_EVENT_ID, this.type, [0x04], // Size
	        Utils.numberToBytes(numerator, 1), // Numerator, 1 bytes
	        Utils.numberToBytes(Math.log2(denominator), 1), // Denominator is expressed as pow of 2, 1 bytes
	        Utils.numberToBytes(midiclockspertick || 24, 1), // MIDI Clocks per tick, 1 bytes
	        Utils.numberToBytes(notespermidiclock || 8, 1));
	    }
	    return TimeSignatureEvent;
	}());

	/**
	 * Object representation of a tempo meta event.
	 * @param {object} fields {text: string, delta: integer}
	 * @return {TrackNameEvent}
	 */
	var TrackNameEvent = /** @class */ (function () {
	    function TrackNameEvent(fields) {
	        this.delta = fields.delta || 0x00;
	        this.name = 'TrackNameEvent';
	        this.text = fields.text;
	        this.type = 0x03;
	        var textBytes = Utils.stringToBytes(this.text);
	        // Start with zero time delta
	        this.data = Utils.numberToVariableLength(this.delta).concat(Constants.META_EVENT_ID, this.type, Utils.numberToVariableLength(textBytes.length), // Size
	        textBytes);
	    }
	    return TrackNameEvent;
	}());

	/**
	 * Holds all data for a track.
	 * @param {object} fields {type: number, data: array, size: array, events: array}
	 * @return {Track}
	 */
	var Track = /** @class */ (function () {
	    function Track() {
	        this.type = Constants.TRACK_CHUNK_TYPE;
	        this.data = [];
	        this.size = [];
	        this.events = [];
	        this.explicitTickEvents = [];
	        // If there are any events with an explicit tick defined then we will create a "sub" track for those
	        // and merge them in and the end.
	        this.tickPointer = 0; // Each time an event is added this will increase
	    }
	    /**
	     * Adds any event type to the track.
	     * Events without a specific startTick property are assumed to be added in order of how they should output.
	     * Events with a specific startTick property are set aside for now will be merged in during build process.
	     *
	     * TODO: Don't put startTick events in their own array.  Just lump everything together and sort it out during buildData();
	     * @param {(NoteEvent|ProgramChangeEvent)} events - Event object or array of Event objects.
	     * @param {Function} mapFunction - Callback which can be used to apply specific properties to all events.
	     * @return {Track}
	     */
	    Track.prototype.addEvent = function (events, mapFunction) {
	        var _this = this;
	        Utils.toArray(events).forEach(function (event, i) {
	            if (event instanceof NoteEvent) {
	                // Handle map function if provided
	                if (typeof mapFunction === 'function') {
	                    var properties = mapFunction(i, event);
	                    if (typeof properties === 'object') {
	                        Object.assign(event, properties);
	                    }
	                }
	                // If this note event has an explicit startTick then we need to set aside for now
	                if (event.tick !== null) {
	                    _this.explicitTickEvents.push(event);
	                }
	                else {
	                    // Push each on/off event to track's event stack
	                    event.buildData().events.forEach(function (e) { return _this.events.push(e); });
	                }
	            }
	            else {
	                _this.events.push(event);
	            }
	        });
	        return this;
	    };
	    /**
	     * Builds int array of all events.
	     * @param {object} options
	     * @return {Track}
	     */
	    Track.prototype.buildData = function (options) {
	        var _this = this;
	        if (options === void 0) { options = {}; }
	        // Reset
	        this.data = [];
	        this.size = [];
	        this.tickPointer = 0;
	        var precisionLoss = 0;
	        this.events.forEach(function (event) {
	            // Build event & add to total tick duration
	            if (event instanceof NoteOnEvent || event instanceof NoteOffEvent) {
	                var built = event.buildData(_this, precisionLoss, options);
	                precisionLoss = Utils.getPrecisionLoss(event.deltaWithPrecisionCorrection || 0);
	                _this.data = _this.data.concat(built.data);
	                _this.tickPointer = Utils.getRoundedIfClose(event.tick);
	            }
	            else if (event instanceof TempoEvent) {
	                _this.tickPointer = Utils.getRoundedIfClose(event.tick);
	                _this.data = _this.data.concat(event.data);
	            }
	            else {
	                _this.data = _this.data.concat(event.data);
	            }
	        });
	        this.mergeExplicitTickEvents();
	        // If the last event isn't EndTrackEvent, then tack it onto the data.
	        if (!this.events.length || !(this.events[this.events.length - 1] instanceof EndTrackEvent)) {
	            this.data = this.data.concat((new EndTrackEvent).data);
	        }
	        this.size = Utils.numberToBytes(this.data.length, 4); // 4 bytes long
	        return this;
	    };
	    Track.prototype.mergeExplicitTickEvents = function () {
	        var _this = this;
	        if (!this.explicitTickEvents.length)
	            return;
	        // First sort asc list of events by startTick
	        this.explicitTickEvents.sort(function (a, b) { return a.tick - b.tick; });
	        // Now this.explicitTickEvents is in correct order, and so is this.events naturally.
	        // For each explicit tick event, splice it into the main list of events and
	        // adjust the delta on the following events so they still play normally.
	        this.explicitTickEvents.forEach(function (noteEvent) {
	            // Convert NoteEvent to it's respective NoteOn/NoteOff events
	            // Note that as we splice in events the delta for the NoteOff ones will
	            // Need to change based on what comes before them after the splice.
	            noteEvent.buildData().events.forEach(function (e) { return e.buildData(_this); });
	            // Merge each event individually into this track's event list.
	            noteEvent.events.forEach(function (event) { return _this.mergeSingleEvent(event); });
	        });
	        // Hacky way to rebuild track with newly spliced events.  Need better solution.
	        this.explicitTickEvents = [];
	        this.buildData();
	    };
	    /**
	     * Merges another track's events with this track.
	     * @param {Track} track
	     * @return {Track}
	     */
	    Track.prototype.mergeTrack = function (track) {
	        var _this = this;
	        // First build this track to populate each event's tick property
	        this.buildData();
	        // Then build track to be merged so that tick property is populated on all events & merge each event.
	        track.buildData().events.forEach(function (event) { return _this.mergeSingleEvent(event); });
	        return this;
	    };
	    /**
	     * Merges a single event into this track's list of events based on event.tick property.
	     * @param {AbstractEvent} - event
	     * @return {Track}
	     */
	    Track.prototype.mergeSingleEvent = function (event) {
	        // There are no events yet, so just add it in.
	        if (!this.events.length) {
	            this.addEvent(event);
	            return;
	        }
	        // Find index of existing event we need to follow with
	        var lastEventIndex;
	        for (var i = 0; i < this.events.length; i++) {
	            if (this.events[i].tick > event.tick)
	                break;
	            lastEventIndex = i;
	        }
	        var splicedEventIndex = lastEventIndex + 1;
	        // Need to adjust the delta of this event to ensure it falls on the correct tick.
	        event.delta = event.tick - this.events[lastEventIndex].tick;
	        // Splice this event at lastEventIndex + 1
	        this.events.splice(splicedEventIndex, 0, event);
	        // Now adjust delta of all following events
	        for (var i = splicedEventIndex + 1; i < this.events.length; i++) {
	            // Since each existing event should have a tick value at this point we just need to
	            // adjust delta to that the event still falls on the correct tick.
	            this.events[i].delta = this.events[i].tick - this.events[i - 1].tick;
	        }
	    };
	    /**
	     * Removes all events matching specified type.
	     * @param {string} eventName - Event type
	     * @return {Track}
	     */
	    Track.prototype.removeEventsByName = function (eventName) {
	        var _this = this;
	        this.events.forEach(function (event, index) {
	            if (event.name === eventName) {
	                _this.events.splice(index, 1);
	            }
	        });
	        return this;
	    };
	    /**
	     * Sets tempo of the MIDI file.
	     * @param {number} bpm - Tempo in beats per minute.
	     * @param {number} tick - Start tick.
	     * @return {Track}
	     */
	    Track.prototype.setTempo = function (bpm, tick) {
	        if (tick === void 0) { tick = 0; }
	        return this.addEvent(new TempoEvent({ bpm: bpm, tick: tick }));
	    };
	    /**
	     * Sets time signature.
	     * @param {number} numerator - Top number of the time signature.
	     * @param {number} denominator - Bottom number of the time signature.
	     * @param {number} midiclockspertick - Defaults to 24.
	     * @param {number} notespermidiclock - Defaults to 8.
	     * @return {Track}
	     */
	    Track.prototype.setTimeSignature = function (numerator, denominator, midiclockspertick, notespermidiclock) {
	        return this.addEvent(new TimeSignatureEvent(numerator, denominator, midiclockspertick, notespermidiclock));
	    };
	    /**
	     * Sets key signature.
	     * @param {*} sf -
	     * @param {*} mi -
	     * @return {Track}
	     */
	    Track.prototype.setKeySignature = function (sf, mi) {
	        return this.addEvent(new KeySignatureEvent(sf, mi));
	    };
	    /**
	     * Adds text to MIDI file.
	     * @param {string} text - Text to add.
	     * @return {Track}
	     */
	    Track.prototype.addText = function (text) {
	        return this.addEvent(new TextEvent({ text: text }));
	    };
	    /**
	     * Adds copyright to MIDI file.
	     * @param {string} text - Text of copyright line.
	     * @return {Track}
	     */
	    Track.prototype.addCopyright = function (text) {
	        return this.addEvent(new CopyrightEvent({ text: text }));
	    };
	    /**
	     * Adds Sequence/Track Name.
	     * @param {string} text - Text of track name.
	     * @return {Track}
	     */
	    Track.prototype.addTrackName = function (text) {
	        return this.addEvent(new TrackNameEvent({ text: text }));
	    };
	    /**
	     * Sets instrument name of track.
	     * @param {string} text - Name of instrument.
	     * @return {Track}
	     */
	    Track.prototype.addInstrumentName = function (text) {
	        return this.addEvent(new InstrumentNameEvent({ text: text }));
	    };
	    /**
	     * Adds marker to MIDI file.
	     * @param {string} text - Marker text.
	     * @return {Track}
	     */
	    Track.prototype.addMarker = function (text) {
	        return this.addEvent(new MarkerEvent({ text: text }));
	    };
	    /**
	     * Adds cue point to MIDI file.
	     * @param {string} text - Text of cue point.
	     * @return {Track}
	     */
	    Track.prototype.addCuePoint = function (text) {
	        return this.addEvent(new CuePointEvent({ text: text }));
	    };
	    /**
	     * Adds lyric to MIDI file.
	     * @param {string} text - Lyric text to add.
	     * @return {Track}
	     */
	    Track.prototype.addLyric = function (text) {
	        return this.addEvent(new LyricEvent({ text: text }));
	    };
	    /**
	     * Channel mode messages
	     * @return {Track}
	     */
	    Track.prototype.polyModeOn = function () {
	        var event = new NoteOnEvent({ data: [0x00, 0xB0, 0x7E, 0x00] });
	        return this.addEvent(event);
	    };
	    /**
	     * Sets a pitch bend.
	     * @param {float} bend - Bend value ranging [-1,1], zero meaning no bend.
	     * @return {Track}
	     */
	    Track.prototype.setPitchBend = function (bend) {
	        return this.addEvent(new PitchBendEvent({ bend: bend }));
	    };
	    /**
	     * Adds a controller change event
	     * @param {number} number - Control number.
	     * @param {number} value - Control value.
	     * @param {number} channel - Channel to send controller change event on (1-based).
	     * @param {number} delta - Track tick offset for cc event.
	     * @return {Track}
	     */
	    Track.prototype.controllerChange = function (number, value, channel, delta) {
	        return this.addEvent(new ControllerChangeEvent({ controllerNumber: number, controllerValue: value, channel: channel, delta: delta }));
	    };
	    return Track;
	}());

	var VexFlow = /** @class */ (function () {
	    function VexFlow() {
	    }
	    /**
	     * Support for converting VexFlow voice into MidiWriterJS track
	     * @return MidiWriter.Track object
	     */
	    VexFlow.prototype.trackFromVoice = function (voice, options) {
	        var _this = this;
	        if (options === void 0) { options = { addRenderedAccidentals: false }; }
	        var track = new Track;
	        var wait = [];
	        voice.tickables.forEach(function (tickable) {
	            if (tickable.noteType === 'n') {
	                track.addEvent(new NoteEvent({
	                    pitch: tickable.keys.map(function (pitch, index) { return _this.convertPitch(pitch, index, tickable, options.addRenderedAccidentals); }),
	                    duration: _this.convertDuration(tickable),
	                    wait: wait
	                }));
	                // reset wait
	                wait = [];
	            }
	            else if (tickable.noteType === 'r') {
	                // move on to the next tickable and add this to the stack
	                // of the `wait` property for the next note event
	                wait.push(_this.convertDuration(tickable));
	            }
	        });
	        // There may be outstanding rests at the end of the track,
	        // pad with a ghost note (zero duration and velocity), just to capture the wait.
	        if (wait.length > 0) {
	            track.addEvent(new NoteEvent({ pitch: '[c4]', duration: '0', wait: wait, velocity: '0' }));
	        }
	        return track;
	    };
	    /**
	     * Converts VexFlow pitch syntax to MidiWriterJS syntax
	     * @param pitch string
	     * @param index pitch index
	     * @param note struct from Vexflow
	     * @param addRenderedAccidentals adds Vexflow rendered accidentals
	     */
	    VexFlow.prototype.convertPitch = function (pitch, index, note, addRenderedAccidentals) {
	        var _a;
	        if (addRenderedAccidentals === void 0) { addRenderedAccidentals = false; }
	        // Splits note name from octave
	        var pitchParts = pitch.split('/');
	        // Retrieves accidentals from pitch
	        // Removes natural accidentals since they are not accepted in Tonal Midi
	        var accidentals = pitchParts[0].substring(1).replace('n', '');
	        if (addRenderedAccidentals) {
	            (_a = note.getAccidentals()) === null || _a === void 0 ? void 0 : _a.forEach(function (accidental) {
	                if (accidental.index === index) {
	                    if (accidental.type === 'n') {
	                        accidentals = '';
	                    }
	                    else {
	                        accidentals += accidental.type;
	                    }
	                }
	            });
	        }
	        return pitchParts[0][0] + accidentals + pitchParts[1];
	    };
	    /**
	     * Converts VexFlow duration syntax to MidiWriterJS syntax
	     * @param note struct from VexFlow
	     */
	    VexFlow.prototype.convertDuration = function (note) {
	        return 'd'.repeat(note.dots) + this.convertBaseDuration(note.duration) + (note.tuplet ? 't' + note.tuplet.num_notes : '');
	    };
	    /**
	     * Converts VexFlow base duration syntax to MidiWriterJS syntax
	     * @param duration Vexflow duration
	     * @returns MidiWriterJS duration
	     */
	    VexFlow.prototype.convertBaseDuration = function (duration) {
	        switch (duration) {
	            case 'w':
	                return '1';
	            case 'h':
	                return '2';
	            case 'q':
	                return '4';
	            default:
	                return duration;
	        }
	    };
	    return VexFlow;
	}());

	/**
	 * Object representation of a header chunk section of a MIDI file.
	 * @param {number} numberOfTracks - Number of tracks
	 * @return {Header}
	 */
	var Header = /** @class */ (function () {
	    function Header(numberOfTracks) {
	        this.type = Constants.HEADER_CHUNK_TYPE;
	        var trackType = numberOfTracks > 1 ? Constants.HEADER_CHUNK_FORMAT1 : Constants.HEADER_CHUNK_FORMAT0;
	        this.data = trackType.concat(Utils.numberToBytes(numberOfTracks, 2), // two bytes long,
	        Constants.HEADER_CHUNK_DIVISION);
	        this.size = [0, 0, 0, this.data.length];
	    }
	    return Header;
	}());

	/**
	 * Object that puts together tracks and provides methods for file output.
	 * @param {array|Track} tracks - A single {Track} object or an array of {Track} objects.
	 * @param {object} options - {middleC: 'C4'}
	 * @return {Writer}
	 */
	var Writer = /** @class */ (function () {
	    function Writer(tracks, options) {
	        if (options === void 0) { options = {}; }
	        // Ensure tracks is an array
	        this.tracks = Utils.toArray(tracks);
	        this.options = options;
	    }
	    /**
	     * Builds array of data from chunkschunks.
	     * @return {array}
	     */
	    Writer.prototype.buildData = function () {
	        var _this = this;
	        var data = [];
	        data.push(new Header(this.tracks.length));
	        // For each track add final end of track event and build data
	        this.tracks.forEach(function (track) {
	            data.push(track.buildData(_this.options));
	        });
	        return data;
	    };
	    /**
	     * Builds the file into a Uint8Array
	     * @return {Uint8Array}
	     */
	    Writer.prototype.buildFile = function () {
	        var build = [];
	        // Data consists of chunks which consists of data
	        this.buildData().forEach(function (d) { return build = build.concat(d.type, d.size, d.data); });
	        return new Uint8Array(build);
	    };
	    /**
	     * Convert file buffer to a base64 string.  Different methods depending on if browser or node.
	     * @return {string}
	     */
	    Writer.prototype.base64 = function () {
	        if (typeof btoa === 'function') {
	            var binary = '';
	            var bytes = this.buildFile();
	            var len = bytes.byteLength;
	            for (var i = 0; i < len; i++) {
	                binary += String.fromCharCode(bytes[i]);
	            }
	            return btoa(binary);
	        }
	        return Buffer.from(this.buildFile()).toString('base64');
	    };
	    /**
	     * Get the data URI.
	     * @return {string}
	     */
	    Writer.prototype.dataUri = function () {
	        return 'data:audio/midi;base64,' + this.base64();
	    };
	    /**
	     * Set option on instantiated Writer.
	     * @param {string} key
	     * @param {any} value
	     * @return {Writer}
	     */
	    Writer.prototype.setOption = function (key, value) {
	        this.options[key] = value;
	        return this;
	    };
	    /**
	     * Output to stdout
	     * @return {string}
	     */
	    Writer.prototype.stdout = function () {
	        return process.stdout.write(Buffer.from(this.buildFile()));
	    };
	    return Writer;
	}());

	var main = {
	    Constants: Constants,
	    ControllerChangeEvent: ControllerChangeEvent,
	    CopyrightEvent: CopyrightEvent,
	    CuePointEvent: CuePointEvent,
	    EndTrackEvent: EndTrackEvent,
	    InstrumentNameEvent: InstrumentNameEvent,
	    KeySignatureEvent: KeySignatureEvent,
	    LyricEvent: LyricEvent,
	    MarkerEvent: MarkerEvent,
	    NoteOnEvent: NoteOnEvent,
	    NoteOffEvent: NoteOffEvent,
	    NoteEvent: NoteEvent,
	    PitchBendEvent: PitchBendEvent,
	    ProgramChangeEvent: ProgramChangeEvent,
	    TempoEvent: TempoEvent,
	    TextEvent: TextEvent,
	    TimeSignatureEvent: TimeSignatureEvent,
	    Track: Track,
	    TrackNameEvent: TrackNameEvent,
	    Utils: Utils,
	    VexFlow: VexFlow,
	    Writer: Writer
	};

	build = main;
	return build;
}

requireBuild();

/* IMPORT */
/* MAIN */
const WebCrypto = crypto;

/* IMPORT */
function makeRNG(constructor) {
    let pool;
    let cursor = 0;
    return () => {
        if (!pool || cursor === pool.length) { // Replenishing pool
            pool = new constructor(65536 / (constructor.BYTES_PER_ELEMENT * 8));
            cursor = 0;
            WebCrypto.getRandomValues(pool);
        }
        return pool[cursor++];
    };
}
function makeBitRNG(rng, bits) {
    let pool = 0;
    let cursor = bits;
    return () => {
        if (cursor === bits) { // Replenishing pool
            pool = rng();
            cursor = 0;
        }
        return (pool & (1 << cursor++)) ? 1 : 0;
    };
}
/* MAIN */
const RNG = {
    get1: makeBitRNG(makeRNG(Uint8Array), 8),
    get8: makeRNG(Uint8Array),
    get16: makeRNG(Uint16Array),
    get32: makeRNG(Uint32Array),
    get64: makeRNG(BigUint64Array)
};

/* IMPORT */
/* HELPERS */
const DEC2HEX = Array.from({ length: 256 }, (_, idx) => idx.toString(16).padStart(2, '0'));
/* MAIN */
const get = () => {
    let id = '';
    for (let i = 0; i < 4; i++) {
        const uint32 = RNG.get32();
        id += DEC2HEX[(uint32 >>> 24) & 255];
        id += DEC2HEX[(uint32 >>> 16) & 255];
        id += DEC2HEX[(uint32 >>> 8) & 255];
        id += DEC2HEX[(uint32 & 255)];
    }
    return id;
};

const active = "_active_lyydo_46";
const trigger = "_trigger_lyydo_51";
const numberButton = "_numberButton_lyydo_57";
const topRightHud = "_topRightHud_lyydo_100";
const topLeftHud = "_topLeftHud_lyydo_101";
const bottomLeftHud = "_bottomLeftHud_lyydo_102";
const bottomRightHud = "_bottomRightHud_lyydo_145";
const note = "_note_lyydo_181";
const selected = "_selected_lyydo_183";
const now$1 = "_now_lyydo_188";
const styles = {
	active: active,
	trigger: trigger,
	numberButton: numberButton,
	topRightHud: topRightHud,
	topLeftHud: topLeftHud,
	bottomLeftHud: bottomLeftHud,
	bottomRightHud: bottomRightHud,
	note: note,
	selected: selected,
	now: now$1
};

// Properties of the document root object
const STATE = Symbol.for("_am_meta"); // symbol used to hide application metadata on automerge objects
const TRACE = Symbol.for("_am_trace"); // used for debugging
const OBJECT_ID = Symbol.for("_am_objectId"); // symbol used to hide the object id on automerge objects
const IS_PROXY = Symbol.for("_am_isProxy"); // symbol used to test if the document is a proxy object
const CLEAR_CACHE = Symbol.for("_am_clearCache"); // symbol used to tell a proxy object to clear its cache
const UINT = Symbol.for("_am_uint");
const INT = Symbol.for("_am_int");
const F64 = Symbol.for("_am_f64");
const COUNTER = Symbol.for("_am_counter");
const TEXT = Symbol.for("_am_text");

class Text {
    constructor(text) {
        if (typeof text === "string") {
            this.elems = [...text];
        }
        else if (Array.isArray(text)) {
            this.elems = text;
        }
        else if (text === undefined) {
            this.elems = [];
        }
        else {
            throw new TypeError(`Unsupported initial value for Text: ${text}`);
        }
        Reflect.defineProperty(this, TEXT, { value: true });
    }
    get length() {
        return this.elems.length;
    }
    //eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(index) {
        return this.elems[index];
    }
    /**
     * Iterates over the text elements character by character, including any
     * inline objects.
     */
    [Symbol.iterator]() {
        const elems = this.elems;
        let index = -1;
        return {
            next() {
                index += 1;
                if (index < elems.length) {
                    return { done: false, value: elems[index] };
                }
                else {
                    return { done: true };
                }
            },
        };
    }
    /**
     * Returns the content of the Text object as a simple string, ignoring any
     * non-character elements.
     */
    toString() {
        if (!this.str) {
            // Concatting to a string is faster than creating an array and then
            // .join()ing for small (<100KB) arrays.
            // https://jsperf.com/join-vs-loop-w-type-test
            this.str = "";
            for (const elem of this.elems) {
                if (typeof elem === "string")
                    this.str += elem;
                else
                    this.str += "\uFFFC";
            }
        }
        return this.str;
    }
    /**
     * Returns the content of the Text object as a sequence of strings,
     * interleaved with non-character elements.
     *
     * For example, the value `['a', 'b', {x: 3}, 'c', 'd']` has spans:
     * `=> ['ab', {x: 3}, 'cd']`
     */
    toSpans() {
        if (!this.spans) {
            this.spans = [];
            let chars = "";
            for (const elem of this.elems) {
                if (typeof elem === "string") {
                    chars += elem;
                }
                else {
                    if (chars.length > 0) {
                        this.spans.push(chars);
                        chars = "";
                    }
                    this.spans.push(elem);
                }
            }
            if (chars.length > 0) {
                this.spans.push(chars);
            }
        }
        return this.spans;
    }
    /**
     * Returns the content of the Text object as a simple string, so that the
     * JSON serialization of an Automerge document represents text nicely.
     */
    toJSON() {
        return this.toString();
    }
    /**
     * Updates the list item at position `index` to a new value `value`.
     */
    set(index, value) {
        if (this[STATE]) {
            throw new RangeError("object cannot be modified outside of a change block");
        }
        this.elems[index] = value;
    }
    /**
     * Inserts new list items `values` starting at position `index`.
     */
    insertAt(index, ...values) {
        if (this[STATE]) {
            throw new RangeError("object cannot be modified outside of a change block");
        }
        if (values.every(v => typeof v === "string")) {
            this.elems.splice(index, 0, ...values.join(""));
        }
        else {
            this.elems.splice(index, 0, ...values);
        }
    }
    /**
     * Deletes `numDelete` list items starting at position `index`.
     * if `numDelete` is not given, one item is deleted.
     */
    deleteAt(index, numDelete = 1) {
        if (this[STATE]) {
            throw new RangeError("object cannot be modified outside of a change block");
        }
        this.elems.splice(index, numDelete);
    }
    map(callback) {
        this.elems.map(callback);
    }
    lastIndexOf(searchElement, fromIndex) {
        this.elems.lastIndexOf(searchElement, fromIndex);
    }
    concat(other) {
        return new Text(this.elems.concat(other.elems));
    }
    every(test) {
        return this.elems.every(test);
    }
    filter(test) {
        return new Text(this.elems.filter(test));
    }
    find(test) {
        return this.elems.find(test);
    }
    findIndex(test) {
        return this.elems.findIndex(test);
    }
    forEach(f) {
        this.elems.forEach(f);
    }
    includes(elem) {
        return this.elems.includes(elem);
    }
    indexOf(elem) {
        return this.elems.indexOf(elem);
    }
    join(sep) {
        return this.elems.join(sep);
    }
    reduce(f) {
        this.elems.reduce(f);
    }
    reduceRight(f) {
        this.elems.reduceRight(f);
    }
    slice(start, end) {
        return new Text(this.elems.slice(start, end));
    }
    some(test) {
        return this.elems.some(test);
    }
    toLocaleString() {
        this.toString();
    }
}

/**
 * The most basic CRDT: an integer value that can be changed only by
 * incrementing and decrementing. Since addition of integers is commutative,
 * the value trivially converges.
 */
class Counter {
    constructor(value) {
        this.value = value || 0;
        Reflect.defineProperty(this, COUNTER, { value: true });
    }
    /**
     * A peculiar JavaScript language feature from its early days: if the object
     * `x` has a `valueOf()` method that returns a number, you can use numerical
     * operators on the object `x` directly, such as `x + 1` or `x < 4`.
     * This method is also called when coercing a value to a string by
     * concatenating it with another string, as in `x + ''`.
     * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/valueOf
     */
    valueOf() {
        return this.value;
    }
    /**
     * Returns the counter value as a decimal string. If `x` is a counter object,
     * this method is called e.g. when you do `['value: ', x].join('')` or when
     * you use string interpolation: `value: ${x}`.
     */
    toString() {
        return this.valueOf().toString();
    }
    /**
     * Returns the counter value, so that a JSON serialization of an Automerge
     * document represents the counter simply as an integer.
     */
    toJSON() {
        return this.value;
    }
    /**
     * Increases the value of the counter by `delta`. If `delta` is not given,
     * increases the value of the counter by 1.
     *
     * Will throw an error if used outside of a change callback.
     */
    increment(_delta) {
        throw new Error("Counters should not be incremented outside of a change callback");
    }
    /**
     * Decreases the value of the counter by `delta`. If `delta` is not given,
     * decreases the value of the counter by 1.
     *
     * Will throw an error if used outside of a change callback.
     */
    decrement(_delta) {
        throw new Error("Counters should not be decremented outside of a change callback");
    }
}
/**
 * An instance of this class is used when a counter is accessed within a change
 * callback.
 */
class WriteableCounter extends Counter {
    constructor(value, context, path, objectId, key) {
        super(value);
        this.context = context;
        this.path = path;
        this.objectId = objectId;
        this.key = key;
    }
    /**
     * Increases the value of the counter by `delta`. If `delta` is not given,
     * increases the value of the counter by 1.
     */
    increment(delta) {
        delta = typeof delta === "number" ? delta : 1;
        this.context.increment(this.objectId, this.key, delta);
        this.value += delta;
        return this.value;
    }
    /**
     * Decreases the value of the counter by `delta`. If `delta` is not given,
     * decreases the value of the counter by 1.
     */
    decrement(delta) {
        return this.increment(typeof delta === "number" ? -delta : -1);
    }
}
/**
 * Returns an instance of `WriteableCounter` for use in a change callback.
 * `context` is the proxy context that keeps track of the mutations.
 * `objectId` is the ID of the object containing the counter, and `key` is
 * the property name (key in map, or index in list) where the counter is
 * located.
 */
function getWriteableCounter(value, context, path, objectId, key) {
    return new WriteableCounter(value, context, path, objectId, key);
}
//module.exports = { Counter, getWriteableCounter }

class RawString {
    constructor(val) {
        this.val = val;
    }
    /**
     * Returns the content of the RawString object as a simple string
     */
    toString() {
        return this.val;
    }
    toJSON() {
        return this.val;
    }
}

/* eslint-disable  @typescript-eslint/no-explicit-any */
function parseListIndex(key) {
    if (typeof key === "string" && /^[0-9]+$/.test(key))
        key = parseInt(key, 10);
    if (typeof key !== "number") {
        return key;
    }
    if (key < 0 || isNaN(key) || key === Infinity || key === -Infinity) {
        throw new RangeError("A list index must be positive, but you passed " + key);
    }
    return key;
}
function valueAt(target, prop) {
    const { context, objectId, path, textV2 } = target;
    const value = context.getWithType(objectId, prop);
    if (value === null) {
        return;
    }
    const datatype = value[0];
    const val = value[1];
    switch (datatype) {
        case undefined:
            return;
        case "map":
            return mapProxy(context, val, textV2, [...path, prop]);
        case "list":
            return listProxy(context, val, textV2, [...path, prop]);
        case "text":
            if (textV2) {
                return context.text(val);
            }
            else {
                return textProxy(context, val, [
                    ...path,
                    prop,
                ]);
            }
        case "str":
            return val;
        case "uint":
            return val;
        case "int":
            return val;
        case "f64":
            return val;
        case "boolean":
            return val;
        case "null":
            return null;
        case "bytes":
            return val;
        case "timestamp":
            return val;
        case "counter": {
            const counter = getWriteableCounter(val, context, path, objectId, prop);
            return counter;
        }
        default:
            throw RangeError(`datatype ${datatype} unimplemented`);
    }
}
function import_value(value, textV2, path, context) {
    const type = typeof value;
    switch (type) {
        case "object":
            if (value == null) {
                return [null, "null"];
            }
            else if (value[UINT]) {
                return [value.value, "uint"];
            }
            else if (value[INT]) {
                return [value.value, "int"];
            }
            else if (value[F64]) {
                return [value.value, "f64"];
            }
            else if (value[COUNTER]) {
                return [value.value, "counter"];
            }
            else if (value instanceof Date) {
                return [value.getTime(), "timestamp"];
            }
            else if (value instanceof RawString) {
                return [value.toString(), "str"];
            }
            else if (value instanceof Text) {
                return [value, "text"];
            }
            else if (value instanceof Uint8Array) {
                return [value, "bytes"];
            }
            else if (value instanceof Array) {
                return [value, "list"];
            }
            else if (Object.prototype.toString.call(value) === "[object Object]") {
                return [value, "map"];
            }
            else if (isSameDocument(value, context)) {
                throw new RangeError("Cannot create a reference to an existing document object");
            }
            else {
                throw new RangeError(`Cannot assign unknown object: ${value}`);
            }
        case "boolean":
            return [value, "boolean"];
        case "number":
            if (Number.isInteger(value)) {
                return [value, "int"];
            }
            else {
                return [value, "f64"];
            }
        case "string":
            if (textV2) {
                return [value, "text"];
            }
            else {
                return [value, "str"];
            }
        case "undefined":
            throw new RangeError([
                `Cannot assign undefined value at ${printPath(path)}, `,
                "because `undefined` is not a valid JSON data type. ",
                "You might consider setting the property's value to `null`, ",
                "or using `delete` to remove it altogether.",
            ].join(""));
        default:
            throw new RangeError([
                `Cannot assign ${type} value at ${printPath(path)}. `,
                `All JSON primitive datatypes (object, array, string, number, boolean, null) `,
                `are supported in an Automerge document; ${type} values are not. `,
            ].join(""));
    }
}
// When we assign a value to a property in a proxy we recursively walk through
// the value we are assigning and copy it into the document. This is generally
// desirable behaviour. However, a very common bug is to accidentally assign a
// value which is already in the document to another key within the same
// document, this often leads to surprising behaviour where users expected to
// _move_ the object, but it is instead copied. To avoid this we check if the
// value is from the same document and if it is we throw an error, this means
// we require an explicit Object.assign call to copy the object, thus avoiding
// the footgun
function isSameDocument(val, context) {
    var _b, _c;
    // Date is technically an object, but immutable, so allowing people to assign
    // a date from one place in the document to another place in the document is
    // not likely to be a bug
    if (val instanceof Date) {
        return false;
    }
    // this depends on __wbg_ptr being the wasm pointer
    // a new version of wasm-bindgen will break this
    // but the tests should expose the break
    if (val && ((_c = (_b = val[STATE]) === null || _b === void 0 ? void 0 : _b.handle) === null || _c === void 0 ? void 0 : _c.__wbg_ptr) === context.__wbg_ptr) {
        return true;
    }
    return false;
}
const MapHandler = {
    get(target, key) {
        const { context, objectId, cache } = target;
        if (key === Symbol.toStringTag) {
            return target[Symbol.toStringTag];
        }
        if (key === OBJECT_ID)
            return objectId;
        if (key === IS_PROXY)
            return true;
        if (key === TRACE)
            return target.trace;
        if (key === STATE)
            return { handle: context, textV2: target.textV2 };
        if (!cache[key]) {
            cache[key] = valueAt(target, key);
        }
        return cache[key];
    },
    set(target, key, val) {
        const { context, objectId, path, textV2 } = target;
        target.cache = {}; // reset cache on set
        if (isSameDocument(val, context)) {
            throw new RangeError("Cannot create a reference to an existing document object");
        }
        if (key === TRACE) {
            target.trace = val;
            return true;
        }
        if (key === CLEAR_CACHE) {
            return true;
        }
        const [value, datatype] = import_value(val, textV2, [...path, key], context);
        switch (datatype) {
            case "list": {
                const list = context.putObject(objectId, key, []);
                const proxyList = listProxy(context, list, textV2, [...path, key]);
                for (let i = 0; i < value.length; i++) {
                    proxyList[i] = value[i];
                }
                break;
            }
            case "text": {
                if (textV2) {
                    assertString(value);
                    context.putObject(objectId, key, value);
                }
                else {
                    assertText(value);
                    const text = context.putObject(objectId, key, "");
                    const proxyText = textProxy(context, text, [...path, key]);
                    proxyText.splice(0, 0, ...value);
                }
                break;
            }
            case "map": {
                const map = context.putObject(objectId, key, {});
                const proxyMap = mapProxy(context, map, textV2, [...path, key]);
                for (const key in value) {
                    proxyMap[key] = value[key];
                }
                break;
            }
            default:
                context.put(objectId, key, value, datatype);
        }
        return true;
    },
    deleteProperty(target, key) {
        const { context, objectId } = target;
        target.cache = {}; // reset cache on delete
        context.delete(objectId, key);
        return true;
    },
    has(target, key) {
        const value = this.get(target, key);
        return value !== undefined;
    },
    getOwnPropertyDescriptor(target, key) {
        // const { context, objectId } = target
        const value = this.get(target, key);
        if (typeof value !== "undefined") {
            return {
                configurable: true,
                enumerable: true,
                value,
            };
        }
    },
    ownKeys(target) {
        const { context, objectId } = target;
        // FIXME - this is a tmp workaround until fix the dupe key bug in keys()
        const keys = context.keys(objectId);
        return [...new Set(keys)];
    },
};
const ListHandler = {
    get(target, index) {
        const { context, objectId } = target;
        index = parseListIndex(index);
        if (index === Symbol.hasInstance) {
            return (instance) => {
                return Array.isArray(instance);
            };
        }
        if (index === Symbol.toStringTag) {
            return target[Symbol.toStringTag];
        }
        if (index === OBJECT_ID)
            return objectId;
        if (index === IS_PROXY)
            return true;
        if (index === TRACE)
            return target.trace;
        if (index === STATE)
            return { handle: context };
        if (index === "length")
            return context.length(objectId);
        if (typeof index === "number") {
            return valueAt(target, index);
        }
        else {
            return listMethods(target)[index];
        }
    },
    set(target, index, val) {
        const { context, objectId, path, textV2 } = target;
        index = parseListIndex(index);
        if (isSameDocument(val, context)) {
            throw new RangeError("Cannot create a reference to an existing document object");
        }
        if (index === CLEAR_CACHE) {
            return true;
        }
        if (index === TRACE) {
            target.trace = val;
            return true;
        }
        if (typeof index == "string") {
            throw new RangeError("list index must be a number");
        }
        const [value, datatype] = import_value(val, textV2, [...path, index], context);
        switch (datatype) {
            case "list": {
                let list;
                if (index >= context.length(objectId)) {
                    list = context.insertObject(objectId, index, []);
                }
                else {
                    list = context.putObject(objectId, index, []);
                }
                const proxyList = listProxy(context, list, textV2, [...path, index]);
                proxyList.splice(0, 0, ...value);
                break;
            }
            case "text": {
                if (textV2) {
                    assertString(value);
                    if (index >= context.length(objectId)) {
                        context.insertObject(objectId, index, value);
                    }
                    else {
                        context.putObject(objectId, index, value);
                    }
                }
                else {
                    let text;
                    assertText(value);
                    if (index >= context.length(objectId)) {
                        text = context.insertObject(objectId, index, "");
                    }
                    else {
                        text = context.putObject(objectId, index, "");
                    }
                    const proxyText = textProxy(context, text, [...path, index]);
                    proxyText.splice(0, 0, ...value);
                }
                break;
            }
            case "map": {
                let map;
                if (index >= context.length(objectId)) {
                    map = context.insertObject(objectId, index, {});
                }
                else {
                    map = context.putObject(objectId, index, {});
                }
                const proxyMap = mapProxy(context, map, textV2, [...path, index]);
                for (const key in value) {
                    proxyMap[key] = value[key];
                }
                break;
            }
            default:
                if (index >= context.length(objectId)) {
                    context.insert(objectId, index, value, datatype);
                }
                else {
                    context.put(objectId, index, value, datatype);
                }
        }
        return true;
    },
    deleteProperty(target, index) {
        const { context, objectId } = target;
        index = parseListIndex(index);
        const elem = context.get(objectId, index);
        if (elem != null && elem[0] == "counter") {
            throw new TypeError("Unsupported operation: deleting a counter from a list");
        }
        context.delete(objectId, index);
        return true;
    },
    has(target, index) {
        const { context, objectId } = target;
        index = parseListIndex(index);
        if (typeof index === "number") {
            return index < context.length(objectId);
        }
        return index === "length";
    },
    getOwnPropertyDescriptor(target, index) {
        const { context, objectId } = target;
        if (index === "length")
            return { writable: true, value: context.length(objectId) };
        if (index === OBJECT_ID)
            return { configurable: false, enumerable: false, value: objectId };
        index = parseListIndex(index);
        const value = valueAt(target, index);
        return { configurable: true, enumerable: true, value };
    },
    getPrototypeOf(target) {
        return Object.getPrototypeOf(target);
    },
    ownKeys( /*target*/) {
        const keys = [];
        // uncommenting this causes assert.deepEqual() to fail when comparing to a pojo array
        // but not uncommenting it causes for (i in list) {} to not enumerate values properly
        //const {context, objectId } = target
        //for (let i = 0; i < target.context.length(objectId); i++) { keys.push(i.toString()) }
        keys.push("length");
        return keys;
    },
};
const TextHandler = Object.assign({}, ListHandler, {
    get(target, index) {
        const { context, objectId } = target;
        index = parseListIndex(index);
        if (index === Symbol.hasInstance) {
            return (instance) => {
                return Array.isArray(instance);
            };
        }
        if (index === Symbol.toStringTag) {
            return target[Symbol.toStringTag];
        }
        if (index === OBJECT_ID)
            return objectId;
        if (index === IS_PROXY)
            return true;
        if (index === TRACE)
            return target.trace;
        if (index === STATE)
            return { handle: context };
        if (index === "length")
            return context.length(objectId);
        if (typeof index === "number") {
            return valueAt(target, index);
        }
        else {
            return textMethods(target)[index] || listMethods(target)[index];
        }
    },
    getPrototypeOf( /*target*/) {
        return Object.getPrototypeOf(new Text());
    },
});
function mapProxy(context, objectId, textV2, path) {
    const target = {
        context,
        objectId,
        path: path || [],
        cache: {},
        textV2,
    };
    const proxied = {};
    Object.assign(proxied, target);
    const result = new Proxy(proxied, MapHandler);
    // conversion through unknown is necessary because the types are so different
    return result;
}
function listProxy(context, objectId, textV2, path) {
    const target = {
        context,
        objectId,
        path: path || [],
        cache: {},
        textV2,
    };
    const proxied = [];
    Object.assign(proxied, target);
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return new Proxy(proxied, ListHandler);
}
function textProxy(context, objectId, path) {
    const target = {
        context,
        objectId,
        path: path || [],
        cache: {},
        textV2: false,
    };
    const proxied = {};
    Object.assign(proxied, target);
    return new Proxy(proxied, TextHandler);
}
function rootProxy(context, textV2) {
    /* eslint-disable-next-line */
    return mapProxy(context, "_root", textV2, []);
}
function listMethods(target) {
    const { context, objectId, path, textV2 } = target;
    const methods = {
        deleteAt(index, numDelete) {
            if (typeof numDelete === "number") {
                context.splice(objectId, index, numDelete);
            }
            else {
                context.delete(objectId, index);
            }
            return this;
        },
        fill(val, start, end) {
            const [value, datatype] = import_value(val, textV2, [...path, start], context);
            const length = context.length(objectId);
            start = parseListIndex(start || 0);
            end = parseListIndex(end || length);
            for (let i = start; i < Math.min(end, length); i++) {
                if (datatype === "list" || datatype === "map") {
                    context.putObject(objectId, i, value);
                }
                else if (datatype === "text") {
                    if (textV2) {
                        assertString(value);
                        context.putObject(objectId, i, value);
                    }
                    else {
                        assertText(value);
                        const text = context.putObject(objectId, i, "");
                        const proxyText = textProxy(context, text, [...path, i]);
                        for (let i = 0; i < value.length; i++) {
                            proxyText[i] = value.get(i);
                        }
                    }
                }
                else {
                    context.put(objectId, i, value, datatype);
                }
            }
            return this;
        },
        indexOf(o, start = 0) {
            const length = context.length(objectId);
            for (let i = start; i < length; i++) {
                const value = context.getWithType(objectId, i);
                if (value && (value[1] === o[OBJECT_ID] || value[1] === o)) {
                    return i;
                }
            }
            return -1;
        },
        insertAt(index, ...values) {
            this.splice(index, 0, ...values);
            return this;
        },
        pop() {
            const length = context.length(objectId);
            if (length == 0) {
                return undefined;
            }
            const last = valueAt(target, length - 1);
            context.delete(objectId, length - 1);
            return last;
        },
        push(...values) {
            const len = context.length(objectId);
            this.splice(len, 0, ...values);
            return context.length(objectId);
        },
        shift() {
            if (context.length(objectId) == 0)
                return;
            const first = valueAt(target, 0);
            context.delete(objectId, 0);
            return first;
        },
        splice(index, del, ...vals) {
            index = parseListIndex(index);
            // if del is undefined, delete until the end of the list
            if (typeof del !== "number") {
                del = context.length(objectId) - index;
            }
            del = parseListIndex(del);
            for (const val of vals) {
                if (isSameDocument(val, context)) {
                    throw new RangeError("Cannot create a reference to an existing document object");
                }
            }
            const result = [];
            for (let i = 0; i < del; i++) {
                const value = valueAt(target, index);
                if (value !== undefined) {
                    result.push(value);
                }
                context.delete(objectId, index);
            }
            const values = vals.map((val, index) => {
                try {
                    return import_value(val, textV2, [...path], context);
                }
                catch (e) {
                    if (e instanceof RangeError) {
                        throw new RangeError(`${e.message} (at index ${index} in the input)`);
                    }
                    else {
                        throw e;
                    }
                }
            });
            for (const [value, datatype] of values) {
                switch (datatype) {
                    case "list": {
                        const list = context.insertObject(objectId, index, []);
                        const proxyList = listProxy(context, list, textV2, [...path, index]);
                        proxyList.splice(0, 0, ...value);
                        break;
                    }
                    case "text": {
                        if (textV2) {
                            assertString(value);
                            context.insertObject(objectId, index, value);
                        }
                        else {
                            const text = context.insertObject(objectId, index, "");
                            const proxyText = textProxy(context, text, [...path, index]);
                            proxyText.splice(0, 0, ...value);
                        }
                        break;
                    }
                    case "map": {
                        const map = context.insertObject(objectId, index, {});
                        const proxyMap = mapProxy(context, map, textV2, [...path, index]);
                        for (const key in value) {
                            proxyMap[key] = value[key];
                        }
                        break;
                    }
                    default:
                        context.insert(objectId, index, value, datatype);
                }
                index += 1;
            }
            return result;
        },
        unshift(...values) {
            this.splice(0, 0, ...values);
            return context.length(objectId);
        },
        entries() {
            let i = 0;
            const iterator = {
                next: () => {
                    const value = valueAt(target, i);
                    if (value === undefined) {
                        return { value: undefined, done: true };
                    }
                    else {
                        return { value: [i++, value], done: false };
                    }
                },
                [Symbol.iterator]() {
                    return this;
                },
            };
            return iterator;
        },
        keys() {
            let i = 0;
            const len = context.length(objectId);
            const iterator = {
                next: () => {
                    if (i < len) {
                        return { value: i++, done: false };
                    }
                    return { value: undefined, done: true };
                },
                [Symbol.iterator]() {
                    return this;
                },
            };
            return iterator;
        },
        values() {
            let i = 0;
            const iterator = {
                next: () => {
                    const value = valueAt(target, i++);
                    if (value === undefined) {
                        return { value: undefined, done: true };
                    }
                    else {
                        return { value, done: false };
                    }
                },
                [Symbol.iterator]() {
                    return this;
                },
            };
            return iterator;
        },
        toArray() {
            const list = [];
            let value;
            do {
                value = valueAt(target, list.length);
                if (value !== undefined) {
                    list.push(value);
                }
            } while (value !== undefined);
            return list;
        },
        map(f) {
            return this.toArray().map(f);
        },
        toString() {
            return this.toArray().toString();
        },
        toLocaleString() {
            return this.toArray().toLocaleString();
        },
        forEach(f) {
            return this.toArray().forEach(f);
        },
        // todo: real concat function is different
        concat(other) {
            return this.toArray().concat(other);
        },
        every(f) {
            return this.toArray().every(f);
        },
        filter(f) {
            return this.toArray().filter(f);
        },
        find(f) {
            let index = 0;
            for (const v of this) {
                if (f(v, index)) {
                    return v;
                }
                index += 1;
            }
        },
        findIndex(f) {
            let index = 0;
            for (const v of this) {
                if (f(v, index)) {
                    return index;
                }
                index += 1;
            }
            return -1;
        },
        includes(elem) {
            return this.find(e => e === elem) !== undefined;
        },
        join(sep) {
            return this.toArray().join(sep);
        },
        reduce(f, initialValue) {
            return this.toArray().reduce(f, initialValue);
        },
        reduceRight(f, initialValue) {
            return this.toArray().reduceRight(f, initialValue);
        },
        lastIndexOf(search, fromIndex = +Infinity) {
            // this can be faster
            return this.toArray().lastIndexOf(search, fromIndex);
        },
        slice(index, num) {
            return this.toArray().slice(index, num);
        },
        some(f) {
            let index = 0;
            for (const v of this) {
                if (f(v, index)) {
                    return true;
                }
                index += 1;
            }
            return false;
        },
        [Symbol.iterator]: function* () {
            let i = 0;
            let value = valueAt(target, i);
            while (value !== undefined) {
                yield value;
                i += 1;
                value = valueAt(target, i);
            }
        },
    };
    return methods;
}
function textMethods(target) {
    const { context, objectId } = target;
    const methods = {
        set(index, value) {
            return (this[index] = value);
        },
        get(index) {
            return this[index];
        },
        toString() {
            return context.text(objectId).replace(/￼/g, "");
        },
        toSpans() {
            const spans = [];
            let chars = "";
            const length = context.length(objectId);
            for (let i = 0; i < length; i++) {
                const value = this[i];
                if (typeof value === "string") {
                    chars += value;
                }
                else {
                    if (chars.length > 0) {
                        spans.push(chars);
                        chars = "";
                    }
                    spans.push(value);
                }
            }
            if (chars.length > 0) {
                spans.push(chars);
            }
            return spans;
        },
        toJSON() {
            return this.toString();
        },
        indexOf(o, start = 0) {
            const text = context.text(objectId);
            return text.indexOf(o, start);
        },
        insertAt(index, ...values) {
            if (values.every(v => typeof v === "string")) {
                context.splice(objectId, index, 0, values.join(""));
            }
            else {
                listMethods(target).insertAt(index, ...values);
            }
        },
    };
    return methods;
}
function assertText(value) {
    if (!(value instanceof Text)) {
        throw new Error("value was not a Text instance");
    }
}
function assertString(value) {
    if (typeof value !== "string") {
        throw new Error("value was not a string");
    }
}
function printPath(path) {
    // print the path as a json pointer
    const jsonPointerComponents = path.map(component => {
        // if its a number just turn it into a string
        if (typeof component === "number") {
            return component.toString();
        }
        else if (typeof component === "string") {
            // otherwise we have to escape `/` and `~` characters
            return component.replace(/~/g, "~0").replace(/\//g, "~1");
        }
    });
    if (path.length === 0) {
        return "";
    }
    else {
        return "/" + jsonPointerComponents.join("/");
    }
}

// Unique ID creation requires a high quality random # generator. In the browser we therefore
// require the crypto API and do not support built-in fallback to lower quality random number
// generators (like Math.random()).
let getRandomValues;
const rnds8 = new Uint8Array(16);
function rng() {
  // lazy load so that environments that need to polyfill have a chance to do so
  if (!getRandomValues) {
    // getRandomValues needs to be invoked in a context where "this" is a Crypto implementation.
    getRandomValues = typeof crypto !== 'undefined' && crypto.getRandomValues && crypto.getRandomValues.bind(crypto);

    if (!getRandomValues) {
      throw new Error('crypto.getRandomValues() not supported. See https://github.com/uuidjs/uuid#getrandomvalues-not-supported');
    }
  }

  return getRandomValues(rnds8);
}

const REGEX = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;

function validate(uuid) {
  return typeof uuid === 'string' && REGEX.test(uuid);
}

/**
 * Convert array of 16 byte values to UUID string format of the form:
 * XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
 */

const byteToHex = [];

for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 0x100).toString(16).slice(1));
}

function unsafeStringify(arr, offset = 0) {
  // Note: Be careful editing this code!  It's been tuned for performance
  // and works in ways you may not expect. See https://github.com/uuidjs/uuid/pull/434
  return byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + '-' + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + '-' + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + '-' + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + '-' + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]];
}

function stringify(arr, offset = 0) {
  const uuid = unsafeStringify(arr, offset); // Consistency check for valid UUID.  If this throws, it's likely due to one
  // of the following:
  // - One or more input array values don't map to a hex octet (leading to
  // "undefined" in the uuid)
  // - Invalid input values for the RFC `version` or `variant` fields

  if (!validate(uuid)) {
    throw TypeError('Stringified UUID is invalid');
  }

  return uuid;
}

function parse(uuid) {
  if (!validate(uuid)) {
    throw TypeError('Invalid UUID');
  }

  let v;
  const arr = new Uint8Array(16); // Parse ########-....-....-....-............

  arr[0] = (v = parseInt(uuid.slice(0, 8), 16)) >>> 24;
  arr[1] = v >>> 16 & 0xff;
  arr[2] = v >>> 8 & 0xff;
  arr[3] = v & 0xff; // Parse ........-####-....-....-............

  arr[4] = (v = parseInt(uuid.slice(9, 13), 16)) >>> 8;
  arr[5] = v & 0xff; // Parse ........-....-####-....-............

  arr[6] = (v = parseInt(uuid.slice(14, 18), 16)) >>> 8;
  arr[7] = v & 0xff; // Parse ........-....-....-####-............

  arr[8] = (v = parseInt(uuid.slice(19, 23), 16)) >>> 8;
  arr[9] = v & 0xff; // Parse ........-....-....-....-############
  // (Use "/" to avoid 32-bit truncation when bit-shifting high-order bytes)

  arr[10] = (v = parseInt(uuid.slice(24, 36), 16)) / 0x10000000000 & 0xff;
  arr[11] = v / 0x100000000 & 0xff;
  arr[12] = v >>> 24 & 0xff;
  arr[13] = v >>> 16 & 0xff;
  arr[14] = v >>> 8 & 0xff;
  arr[15] = v & 0xff;
  return arr;
}

const randomUUID = typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID.bind(crypto);
const native = {
  randomUUID
};

function v4(options, buf, offset) {
  if (native.randomUUID && !buf && !options) {
    return native.randomUUID();
  }

  options = options || {};
  const rnds = options.random || (options.rng || rng)(); // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`

  rnds[6] = rnds[6] & 0x0f | 0x40;
  rnds[8] = rnds[8] & 0x3f | 0x80; // Copy bytes to buffer, if provided

  if (buf) {
    offset = offset || 0;

    for (let i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }

    return buf;
  }

  return unsafeStringify(rnds);
}

let wasm$2;

const heap$1 = new Array(128).fill(undefined);

heap$1.push(undefined, null, true, false);

heap$1.length;

const cachedTextEncoder$1 = (typeof TextEncoder !== 'undefined' ? new TextEncoder('utf-8') : { encode: () => { throw Error('TextEncoder not available') } } );

(typeof cachedTextEncoder$1.encodeInto === 'function'
    ? function (arg, view) {
    return cachedTextEncoder$1.encodeInto(arg, view);
}
    : function (arg, view) {
    const buf = cachedTextEncoder$1.encode(arg);
    view.set(buf);
    return {
        read: arg.length,
        written: buf.length
    };
});

const cachedTextDecoder$1 = (typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }) : { decode: () => { throw Error('TextDecoder not available') } } );

if (typeof TextDecoder !== 'undefined') { cachedTextDecoder$1.decode(); }
(typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm$2.__wbg_automerge_free(ptr >>> 0));

(typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm$2.__wbg_syncstate_free(ptr >>> 0));

let _initializeListeners = [];
function UseApi(api) {
    for (const k in api) {
        ApiHandler[k] = api[k];
    }
    for (const listener of _initializeListeners) {
        listener();
    }
}
/* eslint-disable */
const ApiHandler = {
    create(options) {
        throw new RangeError("Automerge.use() not called");
    },
    load(data, options) {
        throw new RangeError("Automerge.use() not called (load)");
    },
    encodeChange(change) {
        throw new RangeError("Automerge.use() not called (encodeChange)");
    },
    decodeChange(change) {
        throw new RangeError("Automerge.use() not called (decodeChange)");
    },
    initSyncState() {
        throw new RangeError("Automerge.use() not called (initSyncState)");
    },
    encodeSyncMessage(message) {
        throw new RangeError("Automerge.use() not called (encodeSyncMessage)");
    },
    decodeSyncMessage(msg) {
        throw new RangeError("Automerge.use() not called (decodeSyncMessage)");
    },
    encodeSyncState(state) {
        throw new RangeError("Automerge.use() not called (encodeSyncState)");
    },
    decodeSyncState(data) {
        throw new RangeError("Automerge.use() not called (decodeSyncState)");
    },
    exportSyncState(state) {
        throw new RangeError("Automerge.use() not called (exportSyncState)");
    },
    importSyncState(state) {
        throw new RangeError("Automerge.use() not called (importSyncState)");
    },
};

function _state(doc, checkroot = true) {
    if (typeof doc !== "object") {
        throw new RangeError("must be the document root");
    }
    const state = Reflect.get(doc, STATE);
    if (state === undefined ||
        state == null ||
        (checkroot && _obj(doc) !== "_root")) {
        throw new RangeError("must be the document root");
    }
    return state;
}
function _trace(doc) {
    return Reflect.get(doc, TRACE);
}
function _obj(doc) {
    if (!(typeof doc === "object") || doc === null) {
        return null;
    }
    return Reflect.get(doc, OBJECT_ID);
}
function _is_proxy(doc) {
    return !!Reflect.get(doc, IS_PROXY);
}

var __rest = (undefined && undefined.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
function importOpts$1(_actor) {
    if (typeof _actor === "object") {
        return _actor;
    }
    else {
        return { actor: _actor };
    }
}
/**
 * Create a new automerge document
 *
 * @typeParam T - The type of value contained in the document. This will be the
 *     type that is passed to the change closure in {@link change}
 * @param _opts - Either an actorId or an {@link InitOptions} (which may
 *     contain an actorId). If this is null the document will be initialised with a
 *     random actor ID
 */
function init$1(_opts) {
    const opts = importOpts$1(_opts);
    const freeze = !!opts.freeze;
    const patchCallback = opts.patchCallback;
    const text_v1 = !(opts.enableTextV2 || false);
    const actor = opts.actor;
    const handle = ApiHandler.create({ actor, text_v1 });
    handle.enableFreeze(!!opts.freeze);
    const textV2 = opts.enableTextV2 || false;
    registerDatatypes(handle, textV2);
    const doc = handle.materialize("/", undefined, {
        handle,
        heads: undefined,
        freeze,
        patchCallback,
        textV2,
    });
    return doc;
}
/**
 * Make a full writable copy of an automerge document
 *
 * @remarks
 * Unlike {@link view} this function makes a full copy of the memory backing
 * the document and can thus be passed to {@link change}. It also generates a
 * new actor ID so that changes made in the new document do not create duplicate
 * sequence numbers with respect to the old document. If you need control over
 * the actor ID which is generated you can pass the actor ID as the second
 * argument
 *
 * @typeParam T - The type of the value contained in the document
 * @param doc - The document to clone
 * @param _opts - Either an actor ID to use for the new doc or an {@link InitOptions}
 */
function clone$1(doc, _opts) {
    const state = _state(doc);
    const heads = state.heads;
    const opts = importOpts$1(_opts);
    const handle = state.handle.fork(opts.actor, heads);
    handle.updateDiffCursor();
    // `change` uses the presence of state.heads to determine if we are in a view
    // set it to undefined to indicate that this is a full fat document
    const stateSansHeads = __rest(state, ["heads"]);
    stateSansHeads.patchCallback = opts.patchCallback;
    return handle.applyPatches(doc, Object.assign(Object.assign({}, stateSansHeads), { handle }));
}
/**
 * Create an automerge document from a POJO
 *
 * @param initialState - The initial state which will be copied into the document
 * @typeParam T - The type of the value passed to `from` _and_ the type the resulting document will contain
 * @typeParam actor - The actor ID of the resulting document, if this is null a random actor ID will be used
 *
 * @example
 * ```
 * const doc = automerge.from({
 *     tasks: [
 *         {description: "feed dogs", done: false}
 *     ]
 * })
 * ```
 */
function from$1(initialState, _opts) {
    return _change(init$1(_opts), "from", {}, d => Object.assign(d, initialState))
        .newDoc;
}
/**
 * Update the contents of an automerge document
 * @typeParam T - The type of the value contained in the document
 * @param doc - The document to update
 * @param options - Either a message, an {@link ChangeOptions}, or a {@link ChangeFn}
 * @param callback - A `ChangeFn` to be used if `options` was a `string`
 *
 * Note that if the second argument is a function it will be used as the `ChangeFn` regardless of what the third argument is.
 *
 * @example A simple change
 * ```
 * let doc1 = automerge.init()
 * doc1 = automerge.change(doc1, d => {
 *     d.key = "value"
 * })
 * assert.equal(doc1.key, "value")
 * ```
 *
 * @example A change with a message
 *
 * ```
 * doc1 = automerge.change(doc1, "add another value", d => {
 *     d.key2 = "value2"
 * })
 * ```
 *
 * @example A change with a message and a timestamp
 *
 * ```
 * doc1 = automerge.change(doc1, {message: "add another value", time: 1640995200}, d => {
 *     d.key2 = "value2"
 * })
 * ```
 *
 * @example responding to a patch callback
 * ```
 * let patchedPath
 * let patchCallback = patch => {
 *    patchedPath = patch.path
 * }
 * doc1 = automerge.change(doc1, {message: "add another value", time: 1640995200, patchCallback}, d => {
 *     d.key2 = "value2"
 * })
 * assert.equal(patchedPath, ["key2"])
 * ```
 */
function change(doc, options, callback) {
    if (typeof options === "function") {
        return _change(doc, "change", {}, options).newDoc;
    }
    else if (typeof callback === "function") {
        if (typeof options === "string") {
            options = { message: options };
        }
        return _change(doc, "change", options, callback).newDoc;
    }
    else {
        throw RangeError("Invalid args for change");
    }
}
/**
 * Make a change to the document as it was at a particular point in history
 * @typeParam T - The type of the value contained in the document
 * @param doc - The document to update
 * @param scope - The heads representing the point in history to make the change
 * @param options - Either a message or a {@link ChangeOptions} for the new change
 * @param callback - A `ChangeFn` to be used if `options` was a `string`
 *
 * @remarks
 * This function is similar to {@link change} but allows you to make changes to
 * the document as if it were at a particular point in time. To understand this
 * imagine a document created with the following history:
 *
 * ```ts
 * let doc = automerge.from({..})
 * doc = automerge.change(doc, () => {...})
 *
 * const heads = automerge.getHeads(doc)
 *
 * // fork the document make a change
 * let fork = automerge.fork(doc)
 * fork = automerge.change(fork, () => {...})
 * const headsOnFork = automerge.getHeads(fork)
 *
 * // make a change on the original doc
 * doc = automerge.change(doc, () => {...})
 * const headsOnOriginal = automerge.getHeads(doc)
 *
 * // now merge the changes back to the original document
 * doc = automerge.merge(doc, fork)
 *
 * // The heads of the document will now be (headsOnFork, headsOnOriginal)
 * ```
 *
 * {@link ChangeAt} produces an equivalent history, but without having to
 * create a fork of the document. In particular the `newHeads` field of the
 * returned {@link ChangeAtResult} will be the same as `headsOnFork`.
 *
 * Why would you want this? It's typically used in conjunction with {@link diff}
 * to reconcile state which is managed concurrently with the document. For
 * example, if you have a text editor component which the user is modifying
 * and you can't send the changes to the document synchronously you might follow
 * a workflow like this:
 *
 * * On initialization save the current heads of the document in the text editor state
 * * Every time the user makes a change record the change in the text editor state
 *
 * Now from time to time reconcile the editor state and the document
 * * Load the last saved heads from the text editor state, call them `oldHeads`
 * * Apply all the unreconciled changes to the document using `changeAt(doc, oldHeads, ...)`
 * * Get the diff from the resulting document to the current document using {@link diff}
 *   passing the {@link ChangeAtResult.newHeads} as the `before` argument and the
 *   heads of the entire document as the `after` argument.
 * * Apply the diff to the text editor state
 * * Save the current heads of the document in the text editor state
 */
function changeAt(doc, scope, options, callback) {
    if (typeof options === "function") {
        return _change(doc, "changeAt", {}, options, scope);
    }
    else if (typeof callback === "function") {
        if (typeof options === "string") {
            options = { message: options };
        }
        return _change(doc, "changeAt", options, callback, scope);
    }
    else {
        throw RangeError("Invalid args for changeAt");
    }
}
function progressDocument(doc, source, heads, callback) {
    if (heads == null) {
        return doc;
    }
    const state = _state(doc);
    const nextState = Object.assign(Object.assign({}, state), { heads: undefined });
    const { value: nextDoc, patches } = state.handle.applyAndReturnPatches(doc, nextState);
    if (patches.length > 0) {
        if (callback != null) {
            callback(patches, { before: doc, after: nextDoc, source });
        }
        const newState = _state(nextDoc);
        newState.mostRecentPatch = {
            before: _state(doc).heads,
            after: newState.handle.getHeads(),
            patches,
        };
    }
    state.heads = heads;
    return nextDoc;
}
function _change(doc, source, options, callback, scope) {
    if (typeof callback !== "function") {
        throw new RangeError("invalid change function");
    }
    const state = _state(doc);
    if (doc === undefined || state === undefined) {
        throw new RangeError("must be the document root");
    }
    if (state.heads) {
        throw new RangeError("Attempting to change an outdated document.  Use Automerge.clone() if you wish to make a writable copy.");
    }
    if (_is_proxy(doc)) {
        throw new RangeError("Calls to Automerge.change cannot be nested");
    }
    let heads = state.handle.getHeads();
    if (scope && headsEqual(scope, heads)) {
        scope = undefined;
    }
    if (scope) {
        state.handle.isolate(scope);
        heads = scope;
    }
    if (!("time" in options)) {
        options.time = Math.floor(Date.now() / 1000);
    }
    try {
        state.heads = heads;
        const root = rootProxy(state.handle, state.textV2);
        callback(root);
        if (state.handle.pendingOps() === 0) {
            state.heads = undefined;
            if (scope) {
                state.handle.integrate();
            }
            return {
                newDoc: doc,
                newHeads: null,
            };
        }
        else {
            const newHead = state.handle.commit(options.message, options.time);
            state.handle.integrate();
            return {
                newDoc: progressDocument(doc, source, heads, options.patchCallback || state.patchCallback),
                newHeads: newHead != null ? [newHead] : null,
            };
        }
    }
    catch (e) {
        state.heads = undefined;
        state.handle.rollback();
        throw e;
    }
}
/**
 * Make a change to a document which does not modify the document
 *
 * @param doc - The doc to add the empty change to
 * @param options - Either a message or a {@link ChangeOptions} for the new change
 *
 * Why would you want to do this? One reason might be that you have merged
 * changes from some other peers and you want to generate a change which
 * depends on those merged changes so that you can sign the new change with all
 * of the merged changes as part of the new change.
 */
function emptyChange(doc, options) {
    if (options === undefined) {
        options = {};
    }
    if (typeof options === "string") {
        options = { message: options };
    }
    if (!("time" in options)) {
        options.time = Math.floor(Date.now() / 1000);
    }
    const state = _state(doc);
    if (state.heads) {
        throw new RangeError("Attempting to change an outdated document.  Use Automerge.clone() if you wish to make a writable copy.");
    }
    if (_is_proxy(doc)) {
        throw new RangeError("Calls to Automerge.change cannot be nested");
    }
    const heads = state.handle.getHeads();
    state.handle.emptyChange(options.message, options.time);
    return progressDocument(doc, "emptyChange", heads);
}
/**
 * Load an automerge document from a compressed document produce by {@link save}
 *
 * @typeParam T - The type of the value which is contained in the document.
 *                Note that no validation is done to make sure this type is in
 *                fact the type of the contained value so be a bit careful
 * @param data  - The compressed document
 * @param _opts - Either an actor ID or some {@link InitOptions}, if the actor
 *                ID is null a random actor ID will be created
 *
 * Note that `load` will throw an error if passed incomplete content (for
 * example if you are receiving content over the network and don't know if you
 * have the complete document yet). If you need to handle incomplete content use
 * {@link init} followed by {@link loadIncremental}.
 */
function load$3(data, _opts) {
    const opts = importOpts$1(_opts);
    const actor = opts.actor;
    const patchCallback = opts.patchCallback;
    const text_v1 = !(opts.enableTextV2 || false);
    const unchecked = opts.unchecked || false;
    const allowMissingDeps = opts.allowMissingChanges || false;
    const convertRawStringsToText = opts.convertRawStringsToText || false;
    const handle = ApiHandler.load(data, {
        text_v1,
        actor,
        unchecked,
        allowMissingDeps,
        convertRawStringsToText,
    });
    handle.enableFreeze(!!opts.freeze);
    const textV2 = opts.enableTextV2 || false;
    registerDatatypes(handle, textV2);
    const doc = handle.materialize("/", undefined, {
        handle,
        heads: undefined,
        patchCallback,
        textV2,
    });
    return doc;
}
/**
 * Load changes produced by {@link saveIncremental}, or partial changes
 *
 * @typeParam T - The type of the value which is contained in the document.
 *                Note that no validation is done to make sure this type is in
 *                fact the type of the contained value so be a bit careful
 * @param data  - The compressedchanges
 * @param opts  - an {@link ApplyOptions}
 *
 * This function is useful when staying up to date with a connected peer.
 * Perhaps the other end sent you a full compresed document which you loaded
 * with {@link load} and they're sending you the result of
 * {@link getLastLocalChange} every time they make a change.
 *
 * Note that this function will succesfully load the results of {@link save} as
 * well as {@link getLastLocalChange} or any other incremental change.
 */
function loadIncremental(doc, data, opts) {
    if (!opts) {
        opts = {};
    }
    const state = _state(doc);
    if (state.heads) {
        throw new RangeError("Attempting to change an out of date document - set at: " + _trace(doc));
    }
    if (_is_proxy(doc)) {
        throw new RangeError("Calls to Automerge.change cannot be nested");
    }
    const heads = state.handle.getHeads();
    state.handle.loadIncremental(data);
    return progressDocument(doc, "loadIncremental", heads, opts.patchCallback || state.patchCallback);
}
/**
 * Export the contents of a document to a compressed format
 *
 * @param doc - The doc to save
 *
 * The returned bytes can be passed to {@link load} or {@link loadIncremental}
 */
function save(doc) {
    return _state(doc).handle.save();
}
/**
 * Merge `remote` into `local`
 * @typeParam T - The type of values contained in each document
 * @param local - The document to merge changes into
 * @param remote - The document to merge changes from
 *
 * @returns - The merged document
 *
 * Often when you are merging documents you will also need to clone them. Both
 * arguments to `merge` are frozen after the call so you can no longer call
 * mutating methods (such as {@link change}) on them. The symtom of this will be
 * an error which says "Attempting to change an out of date document". To
 * overcome this call {@link clone} on the argument before passing it to {@link
 * merge}.
 */
function merge(local, remote) {
    const localState = _state(local);
    if (localState.heads) {
        throw new RangeError("Attempting to change an out of date document - set at: " + _trace(local));
    }
    const heads = localState.handle.getHeads();
    const remoteState = _state(remote);
    const changes = localState.handle.getChangesAdded(remoteState.handle);
    localState.handle.applyChanges(changes);
    return progressDocument(local, "merge", heads, localState.patchCallback);
}
/**
 * Create a set of patches representing the change from one set of heads to another
 *
 * If either of the heads are missing from the document the returned set of patches will be empty
 */
function diff(doc, before, after) {
    checkHeads(before, "before");
    checkHeads(after, "after");
    const state = _state(doc);
    if (state.mostRecentPatch &&
        equals(state.mostRecentPatch.before, before) &&
        equals(state.mostRecentPatch.after, after)) {
        return state.mostRecentPatch.patches;
    }
    return state.handle.diff(before, after);
}
function headsEqual(heads1, heads2) {
    if (heads1.length !== heads2.length) {
        return false;
    }
    for (let i = 0; i < heads1.length; i++) {
        if (heads1[i] !== heads2[i]) {
            return false;
        }
    }
    return true;
}
function checkHeads(heads, fieldname) {
    if (!Array.isArray(heads)) {
        throw new Error(`${fieldname} must be an array`);
    }
}
/** @hidden */
// FIXME : no tests
// FIXME can we just use deep equals now?
function equals(val1, val2) {
    if (!isObject(val1) || !isObject(val2))
        return val1 === val2;
    const keys1 = Object.keys(val1).sort(), keys2 = Object.keys(val2).sort();
    if (keys1.length !== keys2.length)
        return false;
    for (let i = 0; i < keys1.length; i++) {
        if (keys1[i] !== keys2[i])
            return false;
        if (!equals(val1[keys1[i]], val2[keys2[i]]))
            return false;
    }
    return true;
}
/**
 * encode a {@link SyncState} into binary to send over the network
 *
 * @group sync
 * */
function encodeSyncState$2(state) {
    const sync = ApiHandler.importSyncState(state);
    const result = ApiHandler.encodeSyncState(sync);
    sync.free();
    return result;
}
/**
 * Decode some binary data into a {@link SyncState}
 *
 * @group sync
 */
function decodeSyncState$2(state) {
    const sync = ApiHandler.decodeSyncState(state);
    const result = ApiHandler.exportSyncState(sync);
    sync.free();
    return result;
}
/**
 * Generate a sync message to send to the peer represented by `inState`
 * @param doc - The doc to generate messages about
 * @param inState - The {@link SyncState} representing the peer we are talking to
 *
 * @group sync
 *
 * @returns An array of `[newSyncState, syncMessage | null]` where
 * `newSyncState` should replace `inState` and `syncMessage` should be sent to
 * the peer if it is not null. If `syncMessage` is null then we are up to date.
 */
function generateSyncMessage(doc, inState) {
    const state = _state(doc);
    const syncState = ApiHandler.importSyncState(inState);
    const message = state.handle.generateSyncMessage(syncState);
    const outState = ApiHandler.exportSyncState(syncState);
    return [outState, message];
}
/**
 * Update a document and our sync state on receiving a sync message
 *
 * @group sync
 *
 * @param doc     - The doc the sync message is about
 * @param inState - The {@link SyncState} for the peer we are communicating with
 * @param message - The message which was received
 * @param opts    - Any {@link ApplyOption}s, used for passing a
 *                  {@link PatchCallback} which will be informed of any changes
 *                  in `doc` which occur because of the received sync message.
 *
 * @returns An array of `[newDoc, newSyncState, syncMessage | null]` where
 * `newDoc` is the updated state of `doc`, `newSyncState` should replace
 * `inState` and `syncMessage` should be sent to the peer if it is not null. If
 * `syncMessage` is null then we are up to date.
 */
function receiveSyncMessage(doc, inState, message, opts) {
    const syncState = ApiHandler.importSyncState(inState);
    if (!opts) {
        opts = {};
    }
    const state = _state(doc);
    if (state.heads) {
        throw new RangeError("Attempting to change an outdated document.  Use Automerge.clone() if you wish to make a writable copy.");
    }
    if (_is_proxy(doc)) {
        throw new RangeError("Calls to Automerge.change cannot be nested");
    }
    const heads = state.handle.getHeads();
    state.handle.receiveSyncMessage(syncState, message);
    const outSyncState = ApiHandler.exportSyncState(syncState);
    return [
        progressDocument(doc, "receiveSyncMessage", heads, opts.patchCallback || state.patchCallback),
        outSyncState,
        null,
    ];
}
/**
 * Create a new, blank {@link SyncState}
 *
 * When communicating with a peer for the first time use this to generate a new
 * {@link SyncState} for them
 *
 * @group sync
 */
function initSyncState$2() {
    return ApiHandler.exportSyncState(ApiHandler.initSyncState());
}
/** @hidden */
function decodeSyncMessage$2(message) {
    return ApiHandler.decodeSyncMessage(message);
}
/**
 * Get the hashes of the heads of this document
 */
function getHeads(doc) {
    const state = _state(doc);
    return state.heads || state.handle.getHeads();
}
function isObject(obj) {
    return typeof obj === "object" && obj !== null;
}
function saveSince(doc, heads) {
    const state = _state(doc);
    const result = state.handle.saveSince(heads);
    return result;
}
function registerDatatypes(handle, textV2) {
    handle.registerDatatype("counter", (n) => new Counter(n), n => {
        if (n instanceof Counter) {
            return n.value;
        }
    });
    if (textV2) {
        handle.registerDatatype("str", (n) => {
            return new RawString(n);
        }, s => {
            if (s instanceof RawString) {
                return s.val;
            }
        });
    }
    else {
        handle.registerDatatype("text", (n) => new Text(n), t => {
            if (t instanceof Text) {
                return t.join("");
            }
        });
    }
}

/**
 * # The next API
 *
 * This module contains new features we are working on which are backwards
 * incompatible with the current API of Automerge. This module will become the
 * API of the next major version of Automerge
 *
 * ## Differences from stable
 *
 * In the stable API text objects are represented using the {@link Text} class.
 * This means you must decide up front whether your string data might need
 * concurrent merges in the future and if you change your mind you have to
 * figure out how to migrate your data. In the unstable API the `Text` class is
 * gone and all `string`s are represented using the text CRDT, allowing for
 * concurrent changes. Modifying a string is done using the {@link splice}
 * function. You can still access the old behaviour of strings which do not
 * support merging behaviour via the {@link RawString} class.
 *
 * This leads to the following differences from `stable`:
 *
 * * There is no `unstable.Text` class, all strings are text objects
 * * Reading strings in an `unstable` document is the same as reading any other
 *   javascript string
 * * To modify strings in an `unstable` document use {@link splice}
 * * The {@link AutomergeValue} type does not include the {@link Text}
 *   class but the  {@link RawString} class is included in the {@link ScalarValue}
 *   type
 *
 * ## CHANGELOG
 * * Rename this module to `next` to reflect our increased confidence in it
 *   and stability commitment to it
 * * Introduce this module to expose the new API which has no `Text` class
 *
 *
 * @module
 */
/**
 * Create a new automerge document
 *
 * @typeParam T - The type of value contained in the document. This will be the
 *     type that is passed to the change closure in {@link change}
 * @param _opts - Either an actorId or an {@link InitOptions} (which may
 *     contain an actorId). If this is null the document will be initialised with a
 *     random actor ID
 */
function init(_opts) {
    const opts = importOpts(_opts);
    opts.enableTextV2 = true;
    return init$1(opts);
}
/**
 * Make a full writable copy of an automerge document
 *
 * @remarks
 * Unlike {@link view} this function makes a full copy of the memory backing
 * the document and can thus be passed to {@link change}. It also generates a
 * new actor ID so that changes made in the new document do not create duplicate
 * sequence numbers with respect to the old document. If you need control over
 * the actor ID which is generated you can pass the actor ID as the second
 * argument
 *
 * @typeParam T - The type of the value contained in the document
 * @param doc - The document to clone
 * @param _opts - Either an actor ID to use for the new doc or an {@link InitOptions}
 */
function clone(doc, _opts) {
    const opts = importOpts(_opts);
    opts.enableTextV2 = true;
    return clone$1(doc, opts);
}
/**
 * Create an automerge document from a POJO
 *
 * @param initialState - The initial state which will be copied into the document
 * @typeParam T - The type of the value passed to `from` _and_ the type the resulting document will contain
 * @typeParam actor - The actor ID of the resulting document, if this is null a random actor ID will be used
 *
 * @example
 * ```
 * const doc = automerge.from({
 *     tasks: [
 *         {description: "feed dogs", done: false}
 *     ]
 * })
 * ```
 */
function from(initialState, _opts) {
    const opts = importOpts(_opts);
    opts.enableTextV2 = true;
    return from$1(initialState, opts);
}
/**
 * Load an automerge document from a compressed document produce by {@link save}
 *
 * @typeParam T - The type of the value which is contained in the document.
 *                Note that no validation is done to make sure this type is in
 *                fact the type of the contained value so be a bit careful
 * @param data  - The compressed document
 * @param _opts - Either an actor ID or some {@link InitOptions}, if the actor
 *                ID is null a random actor ID will be created
 *
 * Note that `load` will throw an error if passed incomplete content (for
 * example if you are receiving content over the network and don't know if you
 * have the complete document yet). If you need to handle incomplete content use
 * {@link init} followed by {@link loadIncremental}.
 */
function load$2(data, _opts) {
    const opts = importOpts(_opts);
    opts.enableTextV2 = true;
    if (opts.patchCallback) {
        return loadIncremental(init$1(opts), data);
    }
    else {
        return load$3(data, opts);
    }
}
function importOpts(_actor) {
    {
        return { actor: _actor };
    }
}

var browser = {exports: {}};

/**
 * Helpers.
 */

var ms;
var hasRequiredMs;

function requireMs () {
	if (hasRequiredMs) return ms;
	hasRequiredMs = 1;
	var s = 1000;
	var m = s * 60;
	var h = m * 60;
	var d = h * 24;
	var w = d * 7;
	var y = d * 365.25;

	/**
	 * Parse or format the given `val`.
	 *
	 * Options:
	 *
	 *  - `long` verbose formatting [false]
	 *
	 * @param {String|Number} val
	 * @param {Object} [options]
	 * @throws {Error} throw an error if val is not a non-empty string or a number
	 * @return {String|Number}
	 * @api public
	 */

	ms = function (val, options) {
	  options = options || {};
	  var type = typeof val;
	  if (type === 'string' && val.length > 0) {
	    return parse(val);
	  } else if (type === 'number' && isFinite(val)) {
	    return options.long ? fmtLong(val) : fmtShort(val);
	  }
	  throw new Error(
	    'val is not a non-empty string or a valid number. val=' +
	      JSON.stringify(val)
	  );
	};

	/**
	 * Parse the given `str` and return milliseconds.
	 *
	 * @param {String} str
	 * @return {Number}
	 * @api private
	 */

	function parse(str) {
	  str = String(str);
	  if (str.length > 100) {
	    return;
	  }
	  var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
	    str
	  );
	  if (!match) {
	    return;
	  }
	  var n = parseFloat(match[1]);
	  var type = (match[2] || 'ms').toLowerCase();
	  switch (type) {
	    case 'years':
	    case 'year':
	    case 'yrs':
	    case 'yr':
	    case 'y':
	      return n * y;
	    case 'weeks':
	    case 'week':
	    case 'w':
	      return n * w;
	    case 'days':
	    case 'day':
	    case 'd':
	      return n * d;
	    case 'hours':
	    case 'hour':
	    case 'hrs':
	    case 'hr':
	    case 'h':
	      return n * h;
	    case 'minutes':
	    case 'minute':
	    case 'mins':
	    case 'min':
	    case 'm':
	      return n * m;
	    case 'seconds':
	    case 'second':
	    case 'secs':
	    case 'sec':
	    case 's':
	      return n * s;
	    case 'milliseconds':
	    case 'millisecond':
	    case 'msecs':
	    case 'msec':
	    case 'ms':
	      return n;
	    default:
	      return undefined;
	  }
	}

	/**
	 * Short format for `ms`.
	 *
	 * @param {Number} ms
	 * @return {String}
	 * @api private
	 */

	function fmtShort(ms) {
	  var msAbs = Math.abs(ms);
	  if (msAbs >= d) {
	    return Math.round(ms / d) + 'd';
	  }
	  if (msAbs >= h) {
	    return Math.round(ms / h) + 'h';
	  }
	  if (msAbs >= m) {
	    return Math.round(ms / m) + 'm';
	  }
	  if (msAbs >= s) {
	    return Math.round(ms / s) + 's';
	  }
	  return ms + 'ms';
	}

	/**
	 * Long format for `ms`.
	 *
	 * @param {Number} ms
	 * @return {String}
	 * @api private
	 */

	function fmtLong(ms) {
	  var msAbs = Math.abs(ms);
	  if (msAbs >= d) {
	    return plural(ms, msAbs, d, 'day');
	  }
	  if (msAbs >= h) {
	    return plural(ms, msAbs, h, 'hour');
	  }
	  if (msAbs >= m) {
	    return plural(ms, msAbs, m, 'minute');
	  }
	  if (msAbs >= s) {
	    return plural(ms, msAbs, s, 'second');
	  }
	  return ms + ' ms';
	}

	/**
	 * Pluralization helper.
	 */

	function plural(ms, msAbs, n, name) {
	  var isPlural = msAbs >= n * 1.5;
	  return Math.round(ms / n) + ' ' + name + (isPlural ? 's' : '');
	}
	return ms;
}

var common;
var hasRequiredCommon;

function requireCommon () {
	if (hasRequiredCommon) return common;
	hasRequiredCommon = 1;
	/**
	 * This is the common logic for both the Node.js and web browser
	 * implementations of `debug()`.
	 */

	function setup(env) {
		createDebug.debug = createDebug;
		createDebug.default = createDebug;
		createDebug.coerce = coerce;
		createDebug.disable = disable;
		createDebug.enable = enable;
		createDebug.enabled = enabled;
		createDebug.humanize = requireMs();
		createDebug.destroy = destroy;

		Object.keys(env).forEach(key => {
			createDebug[key] = env[key];
		});

		/**
		* The currently active debug mode names, and names to skip.
		*/

		createDebug.names = [];
		createDebug.skips = [];

		/**
		* Map of special "%n" handling functions, for the debug "format" argument.
		*
		* Valid key names are a single, lower or upper-case letter, i.e. "n" and "N".
		*/
		createDebug.formatters = {};

		/**
		* Selects a color for a debug namespace
		* @param {String} namespace The namespace string for the debug instance to be colored
		* @return {Number|String} An ANSI color code for the given namespace
		* @api private
		*/
		function selectColor(namespace) {
			let hash = 0;

			for (let i = 0; i < namespace.length; i++) {
				hash = ((hash << 5) - hash) + namespace.charCodeAt(i);
				hash |= 0; // Convert to 32bit integer
			}

			return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
		}
		createDebug.selectColor = selectColor;

		/**
		* Create a debugger with the given `namespace`.
		*
		* @param {String} namespace
		* @return {Function}
		* @api public
		*/
		function createDebug(namespace) {
			let prevTime;
			let enableOverride = null;
			let namespacesCache;
			let enabledCache;

			function debug(...args) {
				// Disabled?
				if (!debug.enabled) {
					return;
				}

				const self = debug;

				// Set `diff` timestamp
				const curr = Number(new Date());
				const ms = curr - (prevTime || curr);
				self.diff = ms;
				self.prev = prevTime;
				self.curr = curr;
				prevTime = curr;

				args[0] = createDebug.coerce(args[0]);

				if (typeof args[0] !== 'string') {
					// Anything else let's inspect with %O
					args.unshift('%O');
				}

				// Apply any `formatters` transformations
				let index = 0;
				args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
					// If we encounter an escaped % then don't increase the array index
					if (match === '%%') {
						return '%';
					}
					index++;
					const formatter = createDebug.formatters[format];
					if (typeof formatter === 'function') {
						const val = args[index];
						match = formatter.call(self, val);

						// Now we need to remove `args[index]` since it's inlined in the `format`
						args.splice(index, 1);
						index--;
					}
					return match;
				});

				// Apply env-specific formatting (colors, etc.)
				createDebug.formatArgs.call(self, args);

				const logFn = self.log || createDebug.log;
				logFn.apply(self, args);
			}

			debug.namespace = namespace;
			debug.useColors = createDebug.useColors();
			debug.color = createDebug.selectColor(namespace);
			debug.extend = extend;
			debug.destroy = createDebug.destroy; // XXX Temporary. Will be removed in the next major release.

			Object.defineProperty(debug, 'enabled', {
				enumerable: true,
				configurable: false,
				get: () => {
					if (enableOverride !== null) {
						return enableOverride;
					}
					if (namespacesCache !== createDebug.namespaces) {
						namespacesCache = createDebug.namespaces;
						enabledCache = createDebug.enabled(namespace);
					}

					return enabledCache;
				},
				set: v => {
					enableOverride = v;
				}
			});

			// Env-specific initialization logic for debug instances
			if (typeof createDebug.init === 'function') {
				createDebug.init(debug);
			}

			return debug;
		}

		function extend(namespace, delimiter) {
			const newDebug = createDebug(this.namespace + (typeof delimiter === 'undefined' ? ':' : delimiter) + namespace);
			newDebug.log = this.log;
			return newDebug;
		}

		/**
		* Enables a debug mode by namespaces. This can include modes
		* separated by a colon and wildcards.
		*
		* @param {String} namespaces
		* @api public
		*/
		function enable(namespaces) {
			createDebug.save(namespaces);
			createDebug.namespaces = namespaces;

			createDebug.names = [];
			createDebug.skips = [];

			const split = (typeof namespaces === 'string' ? namespaces : '')
				.trim()
				.replace(' ', ',')
				.split(',')
				.filter(Boolean);

			for (const ns of split) {
				if (ns[0] === '-') {
					createDebug.skips.push(ns.slice(1));
				} else {
					createDebug.names.push(ns);
				}
			}
		}

		/**
		 * Checks if the given string matches a namespace template, honoring
		 * asterisks as wildcards.
		 *
		 * @param {String} search
		 * @param {String} template
		 * @return {Boolean}
		 */
		function matchesTemplate(search, template) {
			let searchIndex = 0;
			let templateIndex = 0;
			let starIndex = -1;
			let matchIndex = 0;

			while (searchIndex < search.length) {
				if (templateIndex < template.length && (template[templateIndex] === search[searchIndex] || template[templateIndex] === '*')) {
					// Match character or proceed with wildcard
					if (template[templateIndex] === '*') {
						starIndex = templateIndex;
						matchIndex = searchIndex;
						templateIndex++; // Skip the '*'
					} else {
						searchIndex++;
						templateIndex++;
					}
				} else if (starIndex !== -1) { // eslint-disable-line no-negated-condition
					// Backtrack to the last '*' and try to match more characters
					templateIndex = starIndex + 1;
					matchIndex++;
					searchIndex = matchIndex;
				} else {
					return false; // No match
				}
			}

			// Handle trailing '*' in template
			while (templateIndex < template.length && template[templateIndex] === '*') {
				templateIndex++;
			}

			return templateIndex === template.length;
		}

		/**
		* Disable debug output.
		*
		* @return {String} namespaces
		* @api public
		*/
		function disable() {
			const namespaces = [
				...createDebug.names,
				...createDebug.skips.map(namespace => '-' + namespace)
			].join(',');
			createDebug.enable('');
			return namespaces;
		}

		/**
		* Returns true if the given mode name is enabled, false otherwise.
		*
		* @param {String} name
		* @return {Boolean}
		* @api public
		*/
		function enabled(name) {
			for (const skip of createDebug.skips) {
				if (matchesTemplate(name, skip)) {
					return false;
				}
			}

			for (const ns of createDebug.names) {
				if (matchesTemplate(name, ns)) {
					return true;
				}
			}

			return false;
		}

		/**
		* Coerce `val`.
		*
		* @param {Mixed} val
		* @return {Mixed}
		* @api private
		*/
		function coerce(val) {
			if (val instanceof Error) {
				return val.stack || val.message;
			}
			return val;
		}

		/**
		* XXX DO NOT USE. This is a temporary stub function.
		* XXX It WILL be removed in the next major release.
		*/
		function destroy() {
			console.warn('Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.');
		}

		createDebug.enable(createDebug.load());

		return createDebug;
	}

	common = setup;
	return common;
}

var hasRequiredBrowser;

function requireBrowser () {
	if (hasRequiredBrowser) return browser.exports;
	hasRequiredBrowser = 1;
	(function (module, exports) {
		var define_process_env_default = {};
		exports.formatArgs = formatArgs;
		exports.save = save;
		exports.load = load;
		exports.useColors = useColors;
		exports.storage = localstorage();
		exports.destroy = /* @__PURE__ */ (() => {
		  let warned = false;
		  return () => {
		    if (!warned) {
		      warned = true;
		      console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
		    }
		  };
		})();
		exports.colors = [
		  "#0000CC",
		  "#0000FF",
		  "#0033CC",
		  "#0033FF",
		  "#0066CC",
		  "#0066FF",
		  "#0099CC",
		  "#0099FF",
		  "#00CC00",
		  "#00CC33",
		  "#00CC66",
		  "#00CC99",
		  "#00CCCC",
		  "#00CCFF",
		  "#3300CC",
		  "#3300FF",
		  "#3333CC",
		  "#3333FF",
		  "#3366CC",
		  "#3366FF",
		  "#3399CC",
		  "#3399FF",
		  "#33CC00",
		  "#33CC33",
		  "#33CC66",
		  "#33CC99",
		  "#33CCCC",
		  "#33CCFF",
		  "#6600CC",
		  "#6600FF",
		  "#6633CC",
		  "#6633FF",
		  "#66CC00",
		  "#66CC33",
		  "#9900CC",
		  "#9900FF",
		  "#9933CC",
		  "#9933FF",
		  "#99CC00",
		  "#99CC33",
		  "#CC0000",
		  "#CC0033",
		  "#CC0066",
		  "#CC0099",
		  "#CC00CC",
		  "#CC00FF",
		  "#CC3300",
		  "#CC3333",
		  "#CC3366",
		  "#CC3399",
		  "#CC33CC",
		  "#CC33FF",
		  "#CC6600",
		  "#CC6633",
		  "#CC9900",
		  "#CC9933",
		  "#CCCC00",
		  "#CCCC33",
		  "#FF0000",
		  "#FF0033",
		  "#FF0066",
		  "#FF0099",
		  "#FF00CC",
		  "#FF00FF",
		  "#FF3300",
		  "#FF3333",
		  "#FF3366",
		  "#FF3399",
		  "#FF33CC",
		  "#FF33FF",
		  "#FF6600",
		  "#FF6633",
		  "#FF9900",
		  "#FF9933",
		  "#FFCC00",
		  "#FFCC33"
		];
		function useColors() {
		  if (typeof window !== "undefined" && window.process && (window.process.type === "renderer" || window.process.__nwjs)) {
		    return true;
		  }
		  if (typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
		    return false;
		  }
		  let m;
		  return typeof document !== "undefined" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || // Is firebug? http://stackoverflow.com/a/398120/376773
		  typeof window !== "undefined" && window.console && (window.console.firebug || window.console.exception && window.console.table) || // Is firefox >= v31?
		  // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
		  typeof navigator !== "undefined" && navigator.userAgent && (m = navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)) && parseInt(m[1], 10) >= 31 || // Double check webkit in userAgent just in case we are in a worker
		  typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
		}
		function formatArgs(args) {
		  args[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + args[0] + (this.useColors ? "%c " : " ") + "+" + module.exports.humanize(this.diff);
		  if (!this.useColors) {
		    return;
		  }
		  const c = "color: " + this.color;
		  args.splice(1, 0, c, "color: inherit");
		  let index = 0;
		  let lastC = 0;
		  args[0].replace(/%[a-zA-Z%]/g, (match) => {
		    if (match === "%%") {
		      return;
		    }
		    index++;
		    if (match === "%c") {
		      lastC = index;
		    }
		  });
		  args.splice(lastC, 0, c);
		}
		exports.log = console.debug || console.log || (() => {
		});
		function save(namespaces) {
		  try {
		    if (namespaces) {
		      exports.storage.setItem("debug", namespaces);
		    } else {
		      exports.storage.removeItem("debug");
		    }
		  } catch (error) {
		  }
		}
		function load() {
		  let r;
		  try {
		    r = exports.storage.getItem("debug");
		  } catch (error) {
		  }
		  if (!r && typeof process !== "undefined" && "env" in process) {
		    r = define_process_env_default.DEBUG;
		  }
		  return r;
		}
		function localstorage() {
		  try {
		    return localStorage;
		  } catch (error) {
		  }
		}
		module.exports = requireCommon()(exports);
		const { formatters } = module.exports;
		formatters.j = function(v) {
		  try {
		    return JSON.stringify(v);
		  } catch (error) {
		    return "[UnexpectedJSONParseError]: " + error.message;
		  }
		}; 
	} (browser, browser.exports));
	return browser.exports;
}

var browserExports = requireBrowser();
const debug = /*@__PURE__*/getDefaultExportFromCjs(browserExports);

var eventemitter3 = {exports: {}};

var hasRequiredEventemitter3;

function requireEventemitter3 () {
	if (hasRequiredEventemitter3) return eventemitter3.exports;
	hasRequiredEventemitter3 = 1;
	(function (module) {

		var has = Object.prototype.hasOwnProperty
		  , prefix = '~';

		/**
		 * Constructor to create a storage for our `EE` objects.
		 * An `Events` instance is a plain object whose properties are event names.
		 *
		 * @constructor
		 * @private
		 */
		function Events() {}

		//
		// We try to not inherit from `Object.prototype`. In some engines creating an
		// instance in this way is faster than calling `Object.create(null)` directly.
		// If `Object.create(null)` is not supported we prefix the event names with a
		// character to make sure that the built-in object properties are not
		// overridden or used as an attack vector.
		//
		if (Object.create) {
		  Events.prototype = Object.create(null);

		  //
		  // This hack is needed because the `__proto__` property is still inherited in
		  // some old browsers like Android 4, iPhone 5.1, Opera 11 and Safari 5.
		  //
		  if (!new Events().__proto__) prefix = false;
		}

		/**
		 * Representation of a single event listener.
		 *
		 * @param {Function} fn The listener function.
		 * @param {*} context The context to invoke the listener with.
		 * @param {Boolean} [once=false] Specify if the listener is a one-time listener.
		 * @constructor
		 * @private
		 */
		function EE(fn, context, once) {
		  this.fn = fn;
		  this.context = context;
		  this.once = once || false;
		}

		/**
		 * Add a listener for a given event.
		 *
		 * @param {EventEmitter} emitter Reference to the `EventEmitter` instance.
		 * @param {(String|Symbol)} event The event name.
		 * @param {Function} fn The listener function.
		 * @param {*} context The context to invoke the listener with.
		 * @param {Boolean} once Specify if the listener is a one-time listener.
		 * @returns {EventEmitter}
		 * @private
		 */
		function addListener(emitter, event, fn, context, once) {
		  if (typeof fn !== 'function') {
		    throw new TypeError('The listener must be a function');
		  }

		  var listener = new EE(fn, context || emitter, once)
		    , evt = prefix ? prefix + event : event;

		  if (!emitter._events[evt]) emitter._events[evt] = listener, emitter._eventsCount++;
		  else if (!emitter._events[evt].fn) emitter._events[evt].push(listener);
		  else emitter._events[evt] = [emitter._events[evt], listener];

		  return emitter;
		}

		/**
		 * Clear event by name.
		 *
		 * @param {EventEmitter} emitter Reference to the `EventEmitter` instance.
		 * @param {(String|Symbol)} evt The Event name.
		 * @private
		 */
		function clearEvent(emitter, evt) {
		  if (--emitter._eventsCount === 0) emitter._events = new Events();
		  else delete emitter._events[evt];
		}

		/**
		 * Minimal `EventEmitter` interface that is molded against the Node.js
		 * `EventEmitter` interface.
		 *
		 * @constructor
		 * @public
		 */
		function EventEmitter() {
		  this._events = new Events();
		  this._eventsCount = 0;
		}

		/**
		 * Return an array listing the events for which the emitter has registered
		 * listeners.
		 *
		 * @returns {Array}
		 * @public
		 */
		EventEmitter.prototype.eventNames = function eventNames() {
		  var names = []
		    , events
		    , name;

		  if (this._eventsCount === 0) return names;

		  for (name in (events = this._events)) {
		    if (has.call(events, name)) names.push(prefix ? name.slice(1) : name);
		  }

		  if (Object.getOwnPropertySymbols) {
		    return names.concat(Object.getOwnPropertySymbols(events));
		  }

		  return names;
		};

		/**
		 * Return the listeners registered for a given event.
		 *
		 * @param {(String|Symbol)} event The event name.
		 * @returns {Array} The registered listeners.
		 * @public
		 */
		EventEmitter.prototype.listeners = function listeners(event) {
		  var evt = prefix ? prefix + event : event
		    , handlers = this._events[evt];

		  if (!handlers) return [];
		  if (handlers.fn) return [handlers.fn];

		  for (var i = 0, l = handlers.length, ee = new Array(l); i < l; i++) {
		    ee[i] = handlers[i].fn;
		  }

		  return ee;
		};

		/**
		 * Return the number of listeners listening to a given event.
		 *
		 * @param {(String|Symbol)} event The event name.
		 * @returns {Number} The number of listeners.
		 * @public
		 */
		EventEmitter.prototype.listenerCount = function listenerCount(event) {
		  var evt = prefix ? prefix + event : event
		    , listeners = this._events[evt];

		  if (!listeners) return 0;
		  if (listeners.fn) return 1;
		  return listeners.length;
		};

		/**
		 * Calls each of the listeners registered for a given event.
		 *
		 * @param {(String|Symbol)} event The event name.
		 * @returns {Boolean} `true` if the event had listeners, else `false`.
		 * @public
		 */
		EventEmitter.prototype.emit = function emit(event, a1, a2, a3, a4, a5) {
		  var evt = prefix ? prefix + event : event;

		  if (!this._events[evt]) return false;

		  var listeners = this._events[evt]
		    , len = arguments.length
		    , args
		    , i;

		  if (listeners.fn) {
		    if (listeners.once) this.removeListener(event, listeners.fn, undefined, true);

		    switch (len) {
		      case 1: return listeners.fn.call(listeners.context), true;
		      case 2: return listeners.fn.call(listeners.context, a1), true;
		      case 3: return listeners.fn.call(listeners.context, a1, a2), true;
		      case 4: return listeners.fn.call(listeners.context, a1, a2, a3), true;
		      case 5: return listeners.fn.call(listeners.context, a1, a2, a3, a4), true;
		      case 6: return listeners.fn.call(listeners.context, a1, a2, a3, a4, a5), true;
		    }

		    for (i = 1, args = new Array(len -1); i < len; i++) {
		      args[i - 1] = arguments[i];
		    }

		    listeners.fn.apply(listeners.context, args);
		  } else {
		    var length = listeners.length
		      , j;

		    for (i = 0; i < length; i++) {
		      if (listeners[i].once) this.removeListener(event, listeners[i].fn, undefined, true);

		      switch (len) {
		        case 1: listeners[i].fn.call(listeners[i].context); break;
		        case 2: listeners[i].fn.call(listeners[i].context, a1); break;
		        case 3: listeners[i].fn.call(listeners[i].context, a1, a2); break;
		        case 4: listeners[i].fn.call(listeners[i].context, a1, a2, a3); break;
		        default:
		          if (!args) for (j = 1, args = new Array(len -1); j < len; j++) {
		            args[j - 1] = arguments[j];
		          }

		          listeners[i].fn.apply(listeners[i].context, args);
		      }
		    }
		  }

		  return true;
		};

		/**
		 * Add a listener for a given event.
		 *
		 * @param {(String|Symbol)} event The event name.
		 * @param {Function} fn The listener function.
		 * @param {*} [context=this] The context to invoke the listener with.
		 * @returns {EventEmitter} `this`.
		 * @public
		 */
		EventEmitter.prototype.on = function on(event, fn, context) {
		  return addListener(this, event, fn, context, false);
		};

		/**
		 * Add a one-time listener for a given event.
		 *
		 * @param {(String|Symbol)} event The event name.
		 * @param {Function} fn The listener function.
		 * @param {*} [context=this] The context to invoke the listener with.
		 * @returns {EventEmitter} `this`.
		 * @public
		 */
		EventEmitter.prototype.once = function once(event, fn, context) {
		  return addListener(this, event, fn, context, true);
		};

		/**
		 * Remove the listeners of a given event.
		 *
		 * @param {(String|Symbol)} event The event name.
		 * @param {Function} fn Only remove the listeners that match this function.
		 * @param {*} context Only remove the listeners that have this context.
		 * @param {Boolean} once Only remove one-time listeners.
		 * @returns {EventEmitter} `this`.
		 * @public
		 */
		EventEmitter.prototype.removeListener = function removeListener(event, fn, context, once) {
		  var evt = prefix ? prefix + event : event;

		  if (!this._events[evt]) return this;
		  if (!fn) {
		    clearEvent(this, evt);
		    return this;
		  }

		  var listeners = this._events[evt];

		  if (listeners.fn) {
		    if (
		      listeners.fn === fn &&
		      (!once || listeners.once) &&
		      (!context || listeners.context === context)
		    ) {
		      clearEvent(this, evt);
		    }
		  } else {
		    for (var i = 0, events = [], length = listeners.length; i < length; i++) {
		      if (
		        listeners[i].fn !== fn ||
		        (once && !listeners[i].once) ||
		        (context && listeners[i].context !== context)
		      ) {
		        events.push(listeners[i]);
		      }
		    }

		    //
		    // Reset the array, or remove it completely if we have no more listeners.
		    //
		    if (events.length) this._events[evt] = events.length === 1 ? events[0] : events;
		    else clearEvent(this, evt);
		  }

		  return this;
		};

		/**
		 * Remove all listeners, or those of the specified event.
		 *
		 * @param {(String|Symbol)} [event] The event name.
		 * @returns {EventEmitter} `this`.
		 * @public
		 */
		EventEmitter.prototype.removeAllListeners = function removeAllListeners(event) {
		  var evt;

		  if (event) {
		    evt = prefix ? prefix + event : event;
		    if (this._events[evt]) clearEvent(this, evt);
		  } else {
		    this._events = new Events();
		    this._eventsCount = 0;
		  }

		  return this;
		};

		//
		// Alias methods names because people roll like that.
		//
		EventEmitter.prototype.off = EventEmitter.prototype.removeListener;
		EventEmitter.prototype.addListener = EventEmitter.prototype.on;

		//
		// Expose the prefix.
		//
		EventEmitter.prefixed = prefix;

		//
		// Allow `EventEmitter` to be imported as module namespace.
		//
		EventEmitter.EventEmitter = EventEmitter;

		//
		// Expose the module.
		//
		{
		  module.exports = EventEmitter;
		} 
	} (eventemitter3));
	return eventemitter3.exports;
}

var eventemitter3Exports = requireEventemitter3();
const EventEmitter = /*@__PURE__*/getDefaultExportFromCjs(eventemitter3Exports);

// From https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/globalThis
function getGlobal() {
  if (typeof globalThis !== 'undefined') {
    return globalThis;
  }
  if (typeof self !== 'undefined') {
    return self;
  }
  if (typeof window !== 'undefined') {
    return window;
  }
  if (typeof global !== 'undefined') {
    return global;
  }
}
function getDevTools() {
  const w = getGlobal();
  if (w.__xstate__) {
    return w.__xstate__;
  }
  return undefined;
}
const devToolsAdapter = service => {
  if (typeof window === 'undefined') {
    return;
  }
  const devTools = getDevTools();
  if (devTools) {
    devTools.register(service);
  }
};

class Mailbox {
  constructor(_process) {
    this._process = _process;
    this._active = false;
    this._current = null;
    this._last = null;
  }
  start() {
    this._active = true;
    this.flush();
  }
  clear() {
    // we can't set _current to null because we might be currently processing
    // and enqueue following clear shouldnt start processing the enqueued item immediately
    if (this._current) {
      this._current.next = null;
      this._last = this._current;
    }
  }
  enqueue(event) {
    const enqueued = {
      value: event,
      next: null
    };
    if (this._current) {
      this._last.next = enqueued;
      this._last = enqueued;
      return;
    }
    this._current = enqueued;
    this._last = enqueued;
    if (this._active) {
      this.flush();
    }
  }
  flush() {
    while (this._current) {
      // atm the given _process is responsible for implementing proper try/catch handling
      // we assume here that this won't throw in a way that can affect this mailbox
      const consumed = this._current;
      this._process(consumed.value);
      this._current = consumed.next;
    }
    this._last = null;
  }
}

const STATE_DELIMITER = '.';
const TARGETLESS_KEY = '';
const NULL_EVENT = '';
const STATE_IDENTIFIER$1 = '#';
const WILDCARD = '*';
const XSTATE_INIT = 'xstate.init';
const XSTATE_STOP = 'xstate.stop';

/**
 * Returns an event that represents an implicit event that is sent after the
 * specified `delay`.
 *
 * @param delayRef The delay in milliseconds
 * @param id The state node ID where this event is handled
 */
function createAfterEvent(delayRef, id) {
  return {
    type: `xstate.after.${delayRef}.${id}`
  };
}

/**
 * Returns an event that represents that a final state node has been reached in
 * the parent state node.
 *
 * @param id The final state node's parent state node `id`
 * @param output The data to pass into the event
 */
function createDoneStateEvent(id, output) {
  return {
    type: `xstate.done.state.${id}`,
    output
  };
}

/**
 * Returns an event that represents that an invoked service has terminated.
 *
 * An invoked service is terminated when it has reached a top-level final state
 * node, but not when it is canceled.
 *
 * @param invokeId The invoked service ID
 * @param output The data to pass into the event
 */
function createDoneActorEvent(invokeId, output) {
  return {
    type: `xstate.done.actor.${invokeId}`,
    output,
    actorId: invokeId
  };
}
function createErrorActorEvent(id, error) {
  return {
    type: `xstate.error.actor.${id}`,
    error,
    actorId: id
  };
}
function createInitEvent(input) {
  return {
    type: XSTATE_INIT,
    input
  };
}

/**
 * This function makes sure that unhandled errors are thrown in a separate
 * macrotask. It allows those errors to be detected by global error handlers and
 * reported to bug tracking services without interrupting our own stack of
 * execution.
 *
 * @param err Error to be thrown
 */
function reportUnhandledError(err) {
  setTimeout(() => {
    throw err;
  });
}

const symbolObservable = (() => typeof Symbol === 'function' && Symbol.observable || '@@observable')();

function matchesState(parentStateId, childStateId) {
  const parentStateValue = toStateValue(parentStateId);
  const childStateValue = toStateValue(childStateId);
  if (typeof childStateValue === 'string') {
    if (typeof parentStateValue === 'string') {
      return childStateValue === parentStateValue;
    }

    // Parent more specific than child
    return false;
  }
  if (typeof parentStateValue === 'string') {
    return parentStateValue in childStateValue;
  }
  return Object.keys(parentStateValue).every(key => {
    if (!(key in childStateValue)) {
      return false;
    }
    return matchesState(parentStateValue[key], childStateValue[key]);
  });
}
function toStatePath(stateId) {
  if (isArray(stateId)) {
    return stateId;
  }
  const result = [];
  let segment = '';
  for (let i = 0; i < stateId.length; i++) {
    const char = stateId.charCodeAt(i);
    switch (char) {
      // \
      case 92:
        // consume the next character
        segment += stateId[i + 1];
        // and skip over it
        i++;
        continue;
      // .
      case 46:
        result.push(segment);
        segment = '';
        continue;
    }
    segment += stateId[i];
  }
  result.push(segment);
  return result;
}
function toStateValue(stateValue) {
  if (isMachineSnapshot(stateValue)) {
    return stateValue.value;
  }
  if (typeof stateValue !== 'string') {
    return stateValue;
  }
  const statePath = toStatePath(stateValue);
  return pathToStateValue(statePath);
}
function pathToStateValue(statePath) {
  if (statePath.length === 1) {
    return statePath[0];
  }
  const value = {};
  let marker = value;
  for (let i = 0; i < statePath.length - 1; i++) {
    if (i === statePath.length - 2) {
      marker[statePath[i]] = statePath[i + 1];
    } else {
      const previous = marker;
      marker = {};
      previous[statePath[i]] = marker;
    }
  }
  return value;
}
function mapValues(collection, iteratee) {
  const result = {};
  const collectionKeys = Object.keys(collection);
  for (let i = 0; i < collectionKeys.length; i++) {
    const key = collectionKeys[i];
    result[key] = iteratee(collection[key], key, collection, i);
  }
  return result;
}
function toArrayStrict(value) {
  if (isArray(value)) {
    return value;
  }
  return [value];
}
function toArray(value) {
  if (value === undefined) {
    return [];
  }
  return toArrayStrict(value);
}
function resolveOutput(mapper, context, event, self) {
  if (typeof mapper === 'function') {
    return mapper({
      context,
      event,
      self
    });
  }
  return mapper;
}
function isArray(value) {
  return Array.isArray(value);
}
function isErrorActorEvent(event) {
  return event.type.startsWith('xstate.error.actor');
}
function toTransitionConfigArray(configLike) {
  return toArrayStrict(configLike).map(transitionLike => {
    if (typeof transitionLike === 'undefined' || typeof transitionLike === 'string') {
      return {
        target: transitionLike
      };
    }
    return transitionLike;
  });
}
function normalizeTarget(target) {
  if (target === undefined || target === TARGETLESS_KEY) {
    return undefined;
  }
  return toArray(target);
}
function toObserver(nextHandler, errorHandler, completionHandler) {
  const isObserver = typeof nextHandler === 'object';
  const self = isObserver ? nextHandler : undefined;
  return {
    next: (isObserver ? nextHandler.next : nextHandler)?.bind(self),
    error: (isObserver ? nextHandler.error : errorHandler)?.bind(self),
    complete: (isObserver ? nextHandler.complete : completionHandler)?.bind(self)
  };
}
function createInvokeId(stateNodeId, index) {
  return `${index}.${stateNodeId}`;
}
function resolveReferencedActor(machine, src) {
  const match = src.match(/^xstate\.invoke\.(\d+)\.(.*)/);
  if (!match) {
    return machine.implementations.actors[src];
  }
  const [, indexStr, nodeId] = match;
  const node = machine.getStateNodeById(nodeId);
  const invokeConfig = node.config.invoke;
  return (Array.isArray(invokeConfig) ? invokeConfig[indexStr] : invokeConfig).src;
}

function createScheduledEventId(actorRef, id) {
  return `${actorRef.sessionId}.${id}`;
}
let idCounter = 0;
function createSystem(rootActor, options) {
  const children = new Map();
  const keyedActors = new Map();
  const reverseKeyedActors = new WeakMap();
  const inspectionObservers = new Set();
  const timerMap = {};
  const {
    clock,
    logger
  } = options;
  const scheduler = {
    schedule: (source, target, event, delay, id = Math.random().toString(36).slice(2)) => {
      const scheduledEvent = {
        source,
        target,
        event,
        delay,
        id,
        startedAt: Date.now()
      };
      const scheduledEventId = createScheduledEventId(source, id);
      system._snapshot._scheduledEvents[scheduledEventId] = scheduledEvent;
      const timeout = clock.setTimeout(() => {
        delete timerMap[scheduledEventId];
        delete system._snapshot._scheduledEvents[scheduledEventId];
        system._relay(source, target, event);
      }, delay);
      timerMap[scheduledEventId] = timeout;
    },
    cancel: (source, id) => {
      const scheduledEventId = createScheduledEventId(source, id);
      const timeout = timerMap[scheduledEventId];
      delete timerMap[scheduledEventId];
      delete system._snapshot._scheduledEvents[scheduledEventId];
      if (timeout !== undefined) {
        clock.clearTimeout(timeout);
      }
    },
    cancelAll: actorRef => {
      for (const scheduledEventId in system._snapshot._scheduledEvents) {
        const scheduledEvent = system._snapshot._scheduledEvents[scheduledEventId];
        if (scheduledEvent.source === actorRef) {
          scheduler.cancel(actorRef, scheduledEvent.id);
        }
      }
    }
  };
  const sendInspectionEvent = event => {
    if (!inspectionObservers.size) {
      return;
    }
    const resolvedInspectionEvent = {
      ...event,
      rootId: rootActor.sessionId
    };
    inspectionObservers.forEach(observer => observer.next?.(resolvedInspectionEvent));
  };
  const system = {
    _snapshot: {
      _scheduledEvents: (options?.snapshot && options.snapshot.scheduler) ?? {}
    },
    _bookId: () => `x:${idCounter++}`,
    _register: (sessionId, actorRef) => {
      children.set(sessionId, actorRef);
      return sessionId;
    },
    _unregister: actorRef => {
      children.delete(actorRef.sessionId);
      const systemId = reverseKeyedActors.get(actorRef);
      if (systemId !== undefined) {
        keyedActors.delete(systemId);
        reverseKeyedActors.delete(actorRef);
      }
    },
    get: systemId => {
      return keyedActors.get(systemId);
    },
    _set: (systemId, actorRef) => {
      const existing = keyedActors.get(systemId);
      if (existing && existing !== actorRef) {
        throw new Error(`Actor with system ID '${systemId}' already exists.`);
      }
      keyedActors.set(systemId, actorRef);
      reverseKeyedActors.set(actorRef, systemId);
    },
    inspect: observerOrFn => {
      const observer = toObserver(observerOrFn);
      inspectionObservers.add(observer);
      return {
        unsubscribe() {
          inspectionObservers.delete(observer);
        }
      };
    },
    _sendInspectionEvent: sendInspectionEvent,
    _relay: (source, target, event) => {
      system._sendInspectionEvent({
        type: '@xstate.event',
        sourceRef: source,
        actorRef: target,
        event
      });
      target._send(event);
    },
    scheduler,
    getSnapshot: () => {
      return {
        _scheduledEvents: {
          ...system._snapshot._scheduledEvents
        }
      };
    },
    start: () => {
      const scheduledEvents = system._snapshot._scheduledEvents;
      system._snapshot._scheduledEvents = {};
      for (const scheduledId in scheduledEvents) {
        const {
          source,
          target,
          event,
          delay,
          id
        } = scheduledEvents[scheduledId];
        scheduler.schedule(source, target, event, delay, id);
      }
    },
    _clock: clock,
    _logger: logger
  };
  return system;
}

let executingCustomAction = false;
const $$ACTOR_TYPE = 1;

// those values are currently used by @xstate/react directly so it's important to keep the assigned values in sync
let ProcessingStatus = /*#__PURE__*/function (ProcessingStatus) {
  ProcessingStatus[ProcessingStatus["NotStarted"] = 0] = "NotStarted";
  ProcessingStatus[ProcessingStatus["Running"] = 1] = "Running";
  ProcessingStatus[ProcessingStatus["Stopped"] = 2] = "Stopped";
  return ProcessingStatus;
}({});
const defaultOptions$1 = {
  clock: {
    setTimeout: (fn, ms) => {
      return setTimeout(fn, ms);
    },
    clearTimeout: id => {
      return clearTimeout(id);
    }
  },
  logger: console.log.bind(console),
  devTools: false
};

/**
 * An Actor is a running process that can receive events, send events and change
 * its behavior based on the events it receives, which can cause effects outside
 * of the actor. When you run a state machine, it becomes an actor.
 */
class Actor {
  /**
   * Creates a new actor instance for the given logic with the provided options,
   * if any.
   *
   * @param logic The logic to create an actor from
   * @param options Actor options
   */
  constructor(logic, options) {
    this.logic = logic;
    /** The current internal state of the actor. */
    this._snapshot = void 0;
    /**
     * The clock that is responsible for setting and clearing timeouts, such as
     * delayed events and transitions.
     */
    this.clock = void 0;
    this.options = void 0;
    /** The unique identifier for this actor relative to its parent. */
    this.id = void 0;
    this.mailbox = new Mailbox(this._process.bind(this));
    this.observers = new Set();
    this.eventListeners = new Map();
    this.logger = void 0;
    /** @internal */
    this._processingStatus = ProcessingStatus.NotStarted;
    // Actor Ref
    this._parent = void 0;
    /** @internal */
    this._syncSnapshot = void 0;
    this.ref = void 0;
    // TODO: add typings for system
    this._actorScope = void 0;
    this._systemId = void 0;
    /** The globally unique process ID for this invocation. */
    this.sessionId = void 0;
    /** The system to which this actor belongs. */
    this.system = void 0;
    this._doneEvent = void 0;
    this.src = void 0;
    // array of functions to defer
    this._deferred = [];
    const resolvedOptions = {
      ...defaultOptions$1,
      ...options
    };
    const {
      clock,
      logger,
      parent,
      syncSnapshot,
      id,
      systemId,
      inspect
    } = resolvedOptions;
    this.system = parent ? parent.system : createSystem(this, {
      clock,
      logger
    });
    if (inspect && !parent) {
      // Always inspect at the system-level
      this.system.inspect(toObserver(inspect));
    }
    this.sessionId = this.system._bookId();
    this.id = id ?? this.sessionId;
    this.logger = options?.logger ?? this.system._logger;
    this.clock = options?.clock ?? this.system._clock;
    this._parent = parent;
    this._syncSnapshot = syncSnapshot;
    this.options = resolvedOptions;
    this.src = resolvedOptions.src ?? logic;
    this.ref = this;
    this._actorScope = {
      self: this,
      id: this.id,
      sessionId: this.sessionId,
      logger: this.logger,
      defer: fn => {
        this._deferred.push(fn);
      },
      system: this.system,
      stopChild: child => {
        if (child._parent !== this) {
          throw new Error(`Cannot stop child actor ${child.id} of ${this.id} because it is not a child`);
        }
        child._stop();
      },
      emit: emittedEvent => {
        const listeners = this.eventListeners.get(emittedEvent.type);
        const wildcardListener = this.eventListeners.get('*');
        if (!listeners && !wildcardListener) {
          return;
        }
        const allListeners = [...(listeners ? listeners.values() : []), ...(wildcardListener ? wildcardListener.values() : [])];
        for (const handler of allListeners) {
          handler(emittedEvent);
        }
      },
      actionExecutor: action => {
        const exec = () => {
          this._actorScope.system._sendInspectionEvent({
            type: '@xstate.action',
            actorRef: this,
            action: {
              type: action.type,
              params: action.params
            }
          });
          if (!action.exec) {
            return;
          }
          const saveExecutingCustomAction = executingCustomAction;
          try {
            executingCustomAction = true;
            action.exec(action.info, action.params);
          } finally {
            executingCustomAction = saveExecutingCustomAction;
          }
        };
        if (this._processingStatus === ProcessingStatus.Running) {
          exec();
        } else {
          this._deferred.push(exec);
        }
      }
    };

    // Ensure that the send method is bound to this Actor instance
    // if destructured
    this.send = this.send.bind(this);
    this.system._sendInspectionEvent({
      type: '@xstate.actor',
      actorRef: this
    });
    if (systemId) {
      this._systemId = systemId;
      this.system._set(systemId, this);
    }
    this._initState(options?.snapshot ?? options?.state);
    if (systemId && this._snapshot.status !== 'active') {
      this.system._unregister(this);
    }
  }
  _initState(persistedState) {
    try {
      this._snapshot = persistedState ? this.logic.restoreSnapshot ? this.logic.restoreSnapshot(persistedState, this._actorScope) : persistedState : this.logic.getInitialSnapshot(this._actorScope, this.options?.input);
    } catch (err) {
      // if we get here then it means that we assign a value to this._snapshot that is not of the correct type
      // we can't get the true `TSnapshot & { status: 'error'; }`, it's impossible
      // so right now this is a lie of sorts
      this._snapshot = {
        status: 'error',
        output: undefined,
        error: err
      };
    }
  }
  update(snapshot, event) {
    // Update state
    this._snapshot = snapshot;

    // Execute deferred effects
    let deferredFn;
    while (deferredFn = this._deferred.shift()) {
      try {
        deferredFn();
      } catch (err) {
        // this error can only be caught when executing *initial* actions
        // it's the only time when we call actions provided by the user through those deferreds
        // when the actor is already running we always execute them synchronously while transitioning
        // no "builtin deferred" should actually throw an error since they are either safe
        // or the control flow is passed through the mailbox and errors should be caught by the `_process` used by the mailbox
        this._deferred.length = 0;
        this._snapshot = {
          ...snapshot,
          status: 'error',
          error: err
        };
      }
    }
    switch (this._snapshot.status) {
      case 'active':
        for (const observer of this.observers) {
          try {
            observer.next?.(snapshot);
          } catch (err) {
            reportUnhandledError(err);
          }
        }
        break;
      case 'done':
        // next observers are meant to be notified about done snapshots
        // this can be seen as something that is different from how observable work
        // but with observables `complete` callback is called without any arguments
        // it's more ergonomic for XState to treat a done snapshot as a "next" value
        // and the completion event as something that is separate,
        // something that merely follows emitting that done snapshot
        for (const observer of this.observers) {
          try {
            observer.next?.(snapshot);
          } catch (err) {
            reportUnhandledError(err);
          }
        }
        this._stopProcedure();
        this._complete();
        this._doneEvent = createDoneActorEvent(this.id, this._snapshot.output);
        if (this._parent) {
          this.system._relay(this, this._parent, this._doneEvent);
        }
        break;
      case 'error':
        this._error(this._snapshot.error);
        break;
    }
    this.system._sendInspectionEvent({
      type: '@xstate.snapshot',
      actorRef: this,
      event,
      snapshot
    });
  }

  /**
   * Subscribe an observer to an actor’s snapshot values.
   *
   * @remarks
   * The observer will receive the actor’s snapshot value when it is emitted.
   * The observer can be:
   *
   * - A plain function that receives the latest snapshot, or
   * - An observer object whose `.next(snapshot)` method receives the latest
   *   snapshot
   *
   * @example
   *
   * ```ts
   * // Observer as a plain function
   * const subscription = actor.subscribe((snapshot) => {
   *   console.log(snapshot);
   * });
   * ```
   *
   * @example
   *
   * ```ts
   * // Observer as an object
   * const subscription = actor.subscribe({
   *   next(snapshot) {
   *     console.log(snapshot);
   *   },
   *   error(err) {
   *     // ...
   *   },
   *   complete() {
   *     // ...
   *   }
   * });
   * ```
   *
   * The return value of `actor.subscribe(observer)` is a subscription object
   * that has an `.unsubscribe()` method. You can call
   * `subscription.unsubscribe()` to unsubscribe the observer:
   *
   * @example
   *
   * ```ts
   * const subscription = actor.subscribe((snapshot) => {
   *   // ...
   * });
   *
   * // Unsubscribe the observer
   * subscription.unsubscribe();
   * ```
   *
   * When the actor is stopped, all of its observers will automatically be
   * unsubscribed.
   *
   * @param observer - Either a plain function that receives the latest
   *   snapshot, or an observer object whose `.next(snapshot)` method receives
   *   the latest snapshot
   */

  subscribe(nextListenerOrObserver, errorListener, completeListener) {
    const observer = toObserver(nextListenerOrObserver, errorListener, completeListener);
    if (this._processingStatus !== ProcessingStatus.Stopped) {
      this.observers.add(observer);
    } else {
      switch (this._snapshot.status) {
        case 'done':
          try {
            observer.complete?.();
          } catch (err) {
            reportUnhandledError(err);
          }
          break;
        case 'error':
          {
            const err = this._snapshot.error;
            if (!observer.error) {
              reportUnhandledError(err);
            } else {
              try {
                observer.error(err);
              } catch (err) {
                reportUnhandledError(err);
              }
            }
            break;
          }
      }
    }
    return {
      unsubscribe: () => {
        this.observers.delete(observer);
      }
    };
  }
  on(type, handler) {
    let listeners = this.eventListeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(type, listeners);
    }
    const wrappedHandler = handler.bind(undefined);
    listeners.add(wrappedHandler);
    return {
      unsubscribe: () => {
        listeners.delete(wrappedHandler);
      }
    };
  }

  /** Starts the Actor from the initial state */
  start() {
    if (this._processingStatus === ProcessingStatus.Running) {
      // Do not restart the service if it is already started
      return this;
    }
    if (this._syncSnapshot) {
      this.subscribe({
        next: snapshot => {
          if (snapshot.status === 'active') {
            this.system._relay(this, this._parent, {
              type: `xstate.snapshot.${this.id}`,
              snapshot
            });
          }
        },
        error: () => {}
      });
    }
    this.system._register(this.sessionId, this);
    if (this._systemId) {
      this.system._set(this._systemId, this);
    }
    this._processingStatus = ProcessingStatus.Running;

    // TODO: this isn't correct when rehydrating
    const initEvent = createInitEvent(this.options.input);
    this.system._sendInspectionEvent({
      type: '@xstate.event',
      sourceRef: this._parent,
      actorRef: this,
      event: initEvent
    });
    const status = this._snapshot.status;
    switch (status) {
      case 'done':
        // a state machine can be "done" upon initialization (it could reach a final state using initial microsteps)
        // we still need to complete observers, flush deferreds etc
        this.update(this._snapshot, initEvent);
        // TODO: rethink cleanup of observers, mailbox, etc
        return this;
      case 'error':
        this._error(this._snapshot.error);
        return this;
    }
    if (!this._parent) {
      this.system.start();
    }
    if (this.logic.start) {
      try {
        this.logic.start(this._snapshot, this._actorScope);
      } catch (err) {
        this._snapshot = {
          ...this._snapshot,
          status: 'error',
          error: err
        };
        this._error(err);
        return this;
      }
    }

    // TODO: this notifies all subscribers but usually this is redundant
    // there is no real change happening here
    // we need to rethink if this needs to be refactored
    this.update(this._snapshot, initEvent);
    if (this.options.devTools) {
      this.attachDevTools();
    }
    this.mailbox.start();
    return this;
  }
  _process(event) {
    let nextState;
    let caughtError;
    try {
      nextState = this.logic.transition(this._snapshot, event, this._actorScope);
    } catch (err) {
      // we wrap it in a box so we can rethrow it later even if falsy value gets caught here
      caughtError = {
        err
      };
    }
    if (caughtError) {
      const {
        err
      } = caughtError;
      this._snapshot = {
        ...this._snapshot,
        status: 'error',
        error: err
      };
      this._error(err);
      return;
    }
    this.update(nextState, event);
    if (event.type === XSTATE_STOP) {
      this._stopProcedure();
      this._complete();
    }
  }
  _stop() {
    if (this._processingStatus === ProcessingStatus.Stopped) {
      return this;
    }
    this.mailbox.clear();
    if (this._processingStatus === ProcessingStatus.NotStarted) {
      this._processingStatus = ProcessingStatus.Stopped;
      return this;
    }
    this.mailbox.enqueue({
      type: XSTATE_STOP
    });
    return this;
  }

  /** Stops the Actor and unsubscribe all listeners. */
  stop() {
    if (this._parent) {
      throw new Error('A non-root actor cannot be stopped directly.');
    }
    return this._stop();
  }
  _complete() {
    for (const observer of this.observers) {
      try {
        observer.complete?.();
      } catch (err) {
        reportUnhandledError(err);
      }
    }
    this.observers.clear();
  }
  _reportError(err) {
    if (!this.observers.size) {
      if (!this._parent) {
        reportUnhandledError(err);
      }
      return;
    }
    let reportError = false;
    for (const observer of this.observers) {
      const errorListener = observer.error;
      reportError ||= !errorListener;
      try {
        errorListener?.(err);
      } catch (err2) {
        reportUnhandledError(err2);
      }
    }
    this.observers.clear();
    if (reportError) {
      reportUnhandledError(err);
    }
  }
  _error(err) {
    this._stopProcedure();
    this._reportError(err);
    if (this._parent) {
      this.system._relay(this, this._parent, createErrorActorEvent(this.id, err));
    }
  }
  // TODO: atm children don't belong entirely to the actor so
  // in a way - it's not even super aware of them
  // so we can't stop them from here but we really should!
  // right now, they are being stopped within the machine's transition
  // but that could throw and leave us with "orphaned" active actors
  _stopProcedure() {
    if (this._processingStatus !== ProcessingStatus.Running) {
      // Actor already stopped; do nothing
      return this;
    }

    // Cancel all delayed events
    this.system.scheduler.cancelAll(this);

    // TODO: mailbox.reset
    this.mailbox.clear();
    // TODO: after `stop` we must prepare ourselves for receiving events again
    // events sent *after* stop signal must be queued
    // it seems like this should be the common behavior for all of our consumers
    // so perhaps this should be unified somehow for all of them
    this.mailbox = new Mailbox(this._process.bind(this));
    this._processingStatus = ProcessingStatus.Stopped;
    this.system._unregister(this);
    return this;
  }

  /** @internal */
  _send(event) {
    if (this._processingStatus === ProcessingStatus.Stopped) {
      return;
    }
    this.mailbox.enqueue(event);
  }

  /**
   * Sends an event to the running Actor to trigger a transition.
   *
   * @param event The event to send
   */
  send(event) {
    this.system._relay(undefined, this, event);
  }
  attachDevTools() {
    const {
      devTools
    } = this.options;
    if (devTools) {
      const resolvedDevToolsAdapter = typeof devTools === 'function' ? devTools : devToolsAdapter;
      resolvedDevToolsAdapter(this);
    }
  }
  toJSON() {
    return {
      xstate$$type: $$ACTOR_TYPE,
      id: this.id
    };
  }

  /**
   * Obtain the internal state of the actor, which can be persisted.
   *
   * @remarks
   * The internal state can be persisted from any actor, not only machines.
   *
   * Note that the persisted state is not the same as the snapshot from
   * {@link Actor.getSnapshot}. Persisted state represents the internal state of
   * the actor, while snapshots represent the actor's last emitted value.
   *
   * Can be restored with {@link ActorOptions.state}
   * @see https://stately.ai/docs/persistence
   */

  getPersistedSnapshot(options) {
    return this.logic.getPersistedSnapshot(this._snapshot, options);
  }
  [symbolObservable]() {
    return this;
  }

  /**
   * Read an actor’s snapshot synchronously.
   *
   * @remarks
   * The snapshot represent an actor's last emitted value.
   *
   * When an actor receives an event, its internal state may change. An actor
   * may emit a snapshot when a state transition occurs.
   *
   * Note that some actors, such as callback actors generated with
   * `fromCallback`, will not emit snapshots.
   * @see {@link Actor.subscribe} to subscribe to an actor’s snapshot values.
   * @see {@link Actor.getPersistedSnapshot} to persist the internal state of an actor (which is more than just a snapshot).
   */
  getSnapshot() {
    return this._snapshot;
  }
}
/**
 * Creates a new actor instance for the given actor logic with the provided
 * options, if any.
 *
 * @remarks
 * When you create an actor from actor logic via `createActor(logic)`, you
 * implicitly create an actor system where the created actor is the root actor.
 * Any actors spawned from this root actor and its descendants are part of that
 * actor system.
 * @example
 *
 * ```ts
 * import { createActor } from 'xstate';
 * import { someActorLogic } from './someActorLogic.ts';
 *
 * // Creating the actor, which implicitly creates an actor system with itself as the root actor
 * const actor = createActor(someActorLogic);
 *
 * actor.subscribe((snapshot) => {
 *   console.log(snapshot);
 * });
 *
 * // Actors must be started by calling `actor.start()`, which will also start the actor system.
 * actor.start();
 *
 * // Actors can receive events
 * actor.send({ type: 'someEvent' });
 *
 * // You can stop root actors by calling `actor.stop()`, which will also stop the actor system and all actors in that system.
 * actor.stop();
 * ```
 *
 * @param logic - The actor logic to create an actor from. For a state machine
 *   actor logic creator, see {@link createMachine}. Other actor logic creators
 *   include {@link fromCallback}, {@link fromEventObservable},
 *   {@link fromObservable}, {@link fromPromise}, and {@link fromTransition}.
 * @param options - Actor options
 */
function createActor(logic, ...[options]) {
  return new Actor(logic, options);
}

/**
 * @deprecated Use `Actor` instead.
 * @alias
 */

function resolveCancel(_, snapshot, actionArgs, actionParams, {
  sendId
}) {
  const resolvedSendId = typeof sendId === 'function' ? sendId(actionArgs, actionParams) : sendId;
  return [snapshot, {
    sendId: resolvedSendId
  }, undefined];
}
function executeCancel(actorScope, params) {
  actorScope.defer(() => {
    actorScope.system.scheduler.cancel(actorScope.self, params.sendId);
  });
}
/**
 * Cancels a delayed `sendTo(...)` action that is waiting to be executed. The
 * canceled `sendTo(...)` action will not send its event or execute, unless the
 * `delay` has already elapsed before `cancel(...)` is called.
 *
 * @example
 *
 * ```ts
 * import { createMachine, sendTo, cancel } from 'xstate';
 *
 * const machine = createMachine({
 *   // ...
 *   on: {
 *     sendEvent: {
 *       actions: sendTo(
 *         'some-actor',
 *         { type: 'someEvent' },
 *         {
 *           id: 'some-id',
 *           delay: 1000
 *         }
 *       )
 *     },
 *     cancelEvent: {
 *       actions: cancel('some-id')
 *     }
 *   }
 * });
 * ```
 *
 * @param sendId The `id` of the `sendTo(...)` action to cancel.
 */
function cancel(sendId) {
  function cancel(_args, _params) {
  }
  cancel.type = 'xstate.cancel';
  cancel.sendId = sendId;
  cancel.resolve = resolveCancel;
  cancel.execute = executeCancel;
  return cancel;
}

function resolveSpawn(actorScope, snapshot, actionArgs, _actionParams, {
  id,
  systemId,
  src,
  input,
  syncSnapshot
}) {
  const logic = typeof src === 'string' ? resolveReferencedActor(snapshot.machine, src) : src;
  const resolvedId = typeof id === 'function' ? id(actionArgs) : id;
  let actorRef;
  let resolvedInput = undefined;
  if (logic) {
    resolvedInput = typeof input === 'function' ? input({
      context: snapshot.context,
      event: actionArgs.event,
      self: actorScope.self
    }) : input;
    actorRef = createActor(logic, {
      id: resolvedId,
      src,
      parent: actorScope.self,
      syncSnapshot,
      systemId,
      input: resolvedInput
    });
  }
  return [cloneMachineSnapshot(snapshot, {
    children: {
      ...snapshot.children,
      [resolvedId]: actorRef
    }
  }), {
    id,
    systemId,
    actorRef,
    src,
    input: resolvedInput
  }, undefined];
}
function executeSpawn(actorScope, {
  actorRef
}) {
  if (!actorRef) {
    return;
  }
  actorScope.defer(() => {
    if (actorRef._processingStatus === ProcessingStatus.Stopped) {
      return;
    }
    actorRef.start();
  });
}
function spawnChild(...[src, {
  id,
  systemId,
  input,
  syncSnapshot = false
} = {}]) {
  function spawnChild(_args, _params) {
  }
  spawnChild.type = 'xstate.spawnChild';
  spawnChild.id = id;
  spawnChild.systemId = systemId;
  spawnChild.src = src;
  spawnChild.input = input;
  spawnChild.syncSnapshot = syncSnapshot;
  spawnChild.resolve = resolveSpawn;
  spawnChild.execute = executeSpawn;
  return spawnChild;
}

function resolveStop(_, snapshot, args, actionParams, {
  actorRef
}) {
  const actorRefOrString = typeof actorRef === 'function' ? actorRef(args, actionParams) : actorRef;
  const resolvedActorRef = typeof actorRefOrString === 'string' ? snapshot.children[actorRefOrString] : actorRefOrString;
  let children = snapshot.children;
  if (resolvedActorRef) {
    children = {
      ...children
    };
    delete children[resolvedActorRef.id];
  }
  return [cloneMachineSnapshot(snapshot, {
    children
  }), resolvedActorRef, undefined];
}
function executeStop(actorScope, actorRef) {
  if (!actorRef) {
    return;
  }

  // we need to eagerly unregister it here so a new actor with the same systemId can be registered immediately
  // since we defer actual stopping of the actor but we don't defer actor creations (and we can't do that)
  // this could throw on `systemId` collision, for example, when dealing with reentering transitions
  actorScope.system._unregister(actorRef);

  // this allows us to prevent an actor from being started if it gets stopped within the same macrostep
  // this can happen, for example, when the invoking state is being exited immediately by an always transition
  if (actorRef._processingStatus !== ProcessingStatus.Running) {
    actorScope.stopChild(actorRef);
    return;
  }
  // stopping a child enqueues a stop event in the child actor's mailbox
  // we need for all of the already enqueued events to be processed before we stop the child
  // the parent itself might want to send some events to a child (for example from exit actions on the invoking state)
  // and we don't want to ignore those events
  actorScope.defer(() => {
    actorScope.stopChild(actorRef);
  });
}
/**
 * Stops a child actor.
 *
 * @param actorRef The actor to stop.
 */
function stopChild(actorRef) {
  function stop(_args, _params) {
  }
  stop.type = 'xstate.stopChild';
  stop.actorRef = actorRef;
  stop.resolve = resolveStop;
  stop.execute = executeStop;
  return stop;
}

// TODO: throw on cycles (depth check should be enough)
function evaluateGuard(guard, context, event, snapshot) {
  const {
    machine
  } = snapshot;
  const isInline = typeof guard === 'function';
  const resolved = isInline ? guard : machine.implementations.guards[typeof guard === 'string' ? guard : guard.type];
  if (!isInline && !resolved) {
    throw new Error(`Guard '${typeof guard === 'string' ? guard : guard.type}' is not implemented.'.`);
  }
  if (typeof resolved !== 'function') {
    return evaluateGuard(resolved, context, event, snapshot);
  }
  const guardArgs = {
    context,
    event
  };
  const guardParams = isInline || typeof guard === 'string' ? undefined : 'params' in guard ? typeof guard.params === 'function' ? guard.params({
    context,
    event
  }) : guard.params : undefined;
  if (!('check' in resolved)) {
    // the existing type of `.guards` assumes non-nullable `TExpressionGuard`
    // inline guards expect `TExpressionGuard` to be set to `undefined`
    // it's fine to cast this here, our logic makes sure that we call those 2 "variants" correctly
    return resolved(guardArgs, guardParams);
  }
  const builtinGuard = resolved;
  return builtinGuard.check(snapshot, guardArgs, resolved // this holds all params
  );
}

const isAtomicStateNode = stateNode => stateNode.type === 'atomic' || stateNode.type === 'final';
function getChildren(stateNode) {
  return Object.values(stateNode.states).filter(sn => sn.type !== 'history');
}
function getProperAncestors(stateNode, toStateNode) {
  const ancestors = [];
  if (toStateNode === stateNode) {
    return ancestors;
  }

  // add all ancestors
  let m = stateNode.parent;
  while (m && m !== toStateNode) {
    ancestors.push(m);
    m = m.parent;
  }
  return ancestors;
}
function getAllStateNodes(stateNodes) {
  const nodeSet = new Set(stateNodes);
  const adjList = getAdjList(nodeSet);

  // add descendants
  for (const s of nodeSet) {
    // if previously active, add existing child nodes
    if (s.type === 'compound' && (!adjList.get(s) || !adjList.get(s).length)) {
      getInitialStateNodesWithTheirAncestors(s).forEach(sn => nodeSet.add(sn));
    } else {
      if (s.type === 'parallel') {
        for (const child of getChildren(s)) {
          if (child.type === 'history') {
            continue;
          }
          if (!nodeSet.has(child)) {
            const initialStates = getInitialStateNodesWithTheirAncestors(child);
            for (const initialStateNode of initialStates) {
              nodeSet.add(initialStateNode);
            }
          }
        }
      }
    }
  }

  // add all ancestors
  for (const s of nodeSet) {
    let m = s.parent;
    while (m) {
      nodeSet.add(m);
      m = m.parent;
    }
  }
  return nodeSet;
}
function getValueFromAdj(baseNode, adjList) {
  const childStateNodes = adjList.get(baseNode);
  if (!childStateNodes) {
    return {}; // todo: fix?
  }
  if (baseNode.type === 'compound') {
    const childStateNode = childStateNodes[0];
    if (childStateNode) {
      if (isAtomicStateNode(childStateNode)) {
        return childStateNode.key;
      }
    } else {
      return {};
    }
  }
  const stateValue = {};
  for (const childStateNode of childStateNodes) {
    stateValue[childStateNode.key] = getValueFromAdj(childStateNode, adjList);
  }
  return stateValue;
}
function getAdjList(stateNodes) {
  const adjList = new Map();
  for (const s of stateNodes) {
    if (!adjList.has(s)) {
      adjList.set(s, []);
    }
    if (s.parent) {
      if (!adjList.has(s.parent)) {
        adjList.set(s.parent, []);
      }
      adjList.get(s.parent).push(s);
    }
  }
  return adjList;
}
function getStateValue(rootNode, stateNodes) {
  const config = getAllStateNodes(stateNodes);
  return getValueFromAdj(rootNode, getAdjList(config));
}
function isInFinalState(stateNodeSet, stateNode) {
  if (stateNode.type === 'compound') {
    return getChildren(stateNode).some(s => s.type === 'final' && stateNodeSet.has(s));
  }
  if (stateNode.type === 'parallel') {
    return getChildren(stateNode).every(sn => isInFinalState(stateNodeSet, sn));
  }
  return stateNode.type === 'final';
}
const isStateId = str => str[0] === STATE_IDENTIFIER$1;
function getCandidates(stateNode, receivedEventType) {
  const candidates = stateNode.transitions.get(receivedEventType) || [...stateNode.transitions.keys()].filter(eventDescriptor => {
    // check if transition is a wildcard transition,
    // which matches any non-transient events
    if (eventDescriptor === WILDCARD) {
      return true;
    }
    if (!eventDescriptor.endsWith('.*')) {
      return false;
    }
    const partialEventTokens = eventDescriptor.split('.');
    const eventTokens = receivedEventType.split('.');
    for (let tokenIndex = 0; tokenIndex < partialEventTokens.length; tokenIndex++) {
      const partialEventToken = partialEventTokens[tokenIndex];
      const eventToken = eventTokens[tokenIndex];
      if (partialEventToken === '*') {
        const isLastToken = tokenIndex === partialEventTokens.length - 1;
        return isLastToken;
      }
      if (partialEventToken !== eventToken) {
        return false;
      }
    }
    return true;
  }).sort((a, b) => b.length - a.length).flatMap(key => stateNode.transitions.get(key));
  return candidates;
}

/** All delayed transitions from the config. */
function getDelayedTransitions(stateNode) {
  const afterConfig = stateNode.config.after;
  if (!afterConfig) {
    return [];
  }
  const mutateEntryExit = delay => {
    const afterEvent = createAfterEvent(delay, stateNode.id);
    const eventType = afterEvent.type;
    stateNode.entry.push(raise(afterEvent, {
      id: eventType,
      delay
    }));
    stateNode.exit.push(cancel(eventType));
    return eventType;
  };
  const delayedTransitions = Object.keys(afterConfig).flatMap(delay => {
    const configTransition = afterConfig[delay];
    const resolvedTransition = typeof configTransition === 'string' ? {
      target: configTransition
    } : configTransition;
    const resolvedDelay = Number.isNaN(+delay) ? delay : +delay;
    const eventType = mutateEntryExit(resolvedDelay);
    return toArray(resolvedTransition).map(transition => ({
      ...transition,
      event: eventType,
      delay: resolvedDelay
    }));
  });
  return delayedTransitions.map(delayedTransition => {
    const {
      delay
    } = delayedTransition;
    return {
      ...formatTransition(stateNode, delayedTransition.event, delayedTransition),
      delay
    };
  });
}
function formatTransition(stateNode, descriptor, transitionConfig) {
  const normalizedTarget = normalizeTarget(transitionConfig.target);
  const reenter = transitionConfig.reenter ?? false;
  const target = resolveTarget(stateNode, normalizedTarget);
  const transition = {
    ...transitionConfig,
    actions: toArray(transitionConfig.actions),
    guard: transitionConfig.guard,
    target,
    source: stateNode,
    reenter,
    eventType: descriptor,
    toJSON: () => ({
      ...transition,
      source: `#${stateNode.id}`,
      target: target ? target.map(t => `#${t.id}`) : undefined
    })
  };
  return transition;
}
function formatTransitions(stateNode) {
  const transitions = new Map();
  if (stateNode.config.on) {
    for (const descriptor of Object.keys(stateNode.config.on)) {
      if (descriptor === NULL_EVENT) {
        throw new Error('Null events ("") cannot be specified as a transition key. Use `always: { ... }` instead.');
      }
      const transitionsConfig = stateNode.config.on[descriptor];
      transitions.set(descriptor, toTransitionConfigArray(transitionsConfig).map(t => formatTransition(stateNode, descriptor, t)));
    }
  }
  if (stateNode.config.onDone) {
    const descriptor = `xstate.done.state.${stateNode.id}`;
    transitions.set(descriptor, toTransitionConfigArray(stateNode.config.onDone).map(t => formatTransition(stateNode, descriptor, t)));
  }
  for (const invokeDef of stateNode.invoke) {
    if (invokeDef.onDone) {
      const descriptor = `xstate.done.actor.${invokeDef.id}`;
      transitions.set(descriptor, toTransitionConfigArray(invokeDef.onDone).map(t => formatTransition(stateNode, descriptor, t)));
    }
    if (invokeDef.onError) {
      const descriptor = `xstate.error.actor.${invokeDef.id}`;
      transitions.set(descriptor, toTransitionConfigArray(invokeDef.onError).map(t => formatTransition(stateNode, descriptor, t)));
    }
    if (invokeDef.onSnapshot) {
      const descriptor = `xstate.snapshot.${invokeDef.id}`;
      transitions.set(descriptor, toTransitionConfigArray(invokeDef.onSnapshot).map(t => formatTransition(stateNode, descriptor, t)));
    }
  }
  for (const delayedTransition of stateNode.after) {
    let existing = transitions.get(delayedTransition.eventType);
    if (!existing) {
      existing = [];
      transitions.set(delayedTransition.eventType, existing);
    }
    existing.push(delayedTransition);
  }
  return transitions;
}
function formatInitialTransition(stateNode, _target) {
  const resolvedTarget = typeof _target === 'string' ? stateNode.states[_target] : _target ? stateNode.states[_target.target] : undefined;
  if (!resolvedTarget && _target) {
    throw new Error(
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-base-to-string
    `Initial state node "${_target}" not found on parent state node #${stateNode.id}`);
  }
  const transition = {
    source: stateNode,
    actions: !_target || typeof _target === 'string' ? [] : toArray(_target.actions),
    eventType: null,
    reenter: false,
    target: resolvedTarget ? [resolvedTarget] : [],
    toJSON: () => ({
      ...transition,
      source: `#${stateNode.id}`,
      target: resolvedTarget ? [`#${resolvedTarget.id}`] : []
    })
  };
  return transition;
}
function resolveTarget(stateNode, targets) {
  if (targets === undefined) {
    // an undefined target signals that the state node should not transition from that state when receiving that event
    return undefined;
  }
  return targets.map(target => {
    if (typeof target !== 'string') {
      return target;
    }
    if (isStateId(target)) {
      return stateNode.machine.getStateNodeById(target);
    }
    const isInternalTarget = target[0] === STATE_DELIMITER;
    // If internal target is defined on machine,
    // do not include machine key on target
    if (isInternalTarget && !stateNode.parent) {
      return getStateNodeByPath(stateNode, target.slice(1));
    }
    const resolvedTarget = isInternalTarget ? stateNode.key + target : target;
    if (stateNode.parent) {
      try {
        const targetStateNode = getStateNodeByPath(stateNode.parent, resolvedTarget);
        return targetStateNode;
      } catch (err) {
        throw new Error(`Invalid transition definition for state node '${stateNode.id}':\n${err.message}`);
      }
    } else {
      throw new Error(`Invalid target: "${target}" is not a valid target from the root node. Did you mean ".${target}"?`);
    }
  });
}
function resolveHistoryDefaultTransition(stateNode) {
  const normalizedTarget = normalizeTarget(stateNode.config.target);
  if (!normalizedTarget) {
    return stateNode.parent.initial;
  }
  return {
    target: normalizedTarget.map(t => typeof t === 'string' ? getStateNodeByPath(stateNode.parent, t) : t)
  };
}
function isHistoryNode(stateNode) {
  return stateNode.type === 'history';
}
function getInitialStateNodesWithTheirAncestors(stateNode) {
  const states = getInitialStateNodes(stateNode);
  for (const initialState of states) {
    for (const ancestor of getProperAncestors(initialState, stateNode)) {
      states.add(ancestor);
    }
  }
  return states;
}
function getInitialStateNodes(stateNode) {
  const set = new Set();
  function iter(descStateNode) {
    if (set.has(descStateNode)) {
      return;
    }
    set.add(descStateNode);
    if (descStateNode.type === 'compound') {
      iter(descStateNode.initial.target[0]);
    } else if (descStateNode.type === 'parallel') {
      for (const child of getChildren(descStateNode)) {
        iter(child);
      }
    }
  }
  iter(stateNode);
  return set;
}
/** Returns the child state node from its relative `stateKey`, or throws. */
function getStateNode(stateNode, stateKey) {
  if (isStateId(stateKey)) {
    return stateNode.machine.getStateNodeById(stateKey);
  }
  if (!stateNode.states) {
    throw new Error(`Unable to retrieve child state '${stateKey}' from '${stateNode.id}'; no child states exist.`);
  }
  const result = stateNode.states[stateKey];
  if (!result) {
    throw new Error(`Child state '${stateKey}' does not exist on '${stateNode.id}'`);
  }
  return result;
}

/**
 * Returns the relative state node from the given `statePath`, or throws.
 *
 * @param statePath The string or string array relative path to the state node.
 */
function getStateNodeByPath(stateNode, statePath) {
  if (typeof statePath === 'string' && isStateId(statePath)) {
    try {
      return stateNode.machine.getStateNodeById(statePath);
    } catch {
      // try individual paths
      // throw e;
    }
  }
  const arrayStatePath = toStatePath(statePath).slice();
  let currentStateNode = stateNode;
  while (arrayStatePath.length) {
    const key = arrayStatePath.shift();
    if (!key.length) {
      break;
    }
    currentStateNode = getStateNode(currentStateNode, key);
  }
  return currentStateNode;
}

/**
 * Returns the state nodes represented by the current state value.
 *
 * @param stateValue The state value or State instance
 */
function getStateNodes(stateNode, stateValue) {
  if (typeof stateValue === 'string') {
    const childStateNode = stateNode.states[stateValue];
    if (!childStateNode) {
      throw new Error(`State '${stateValue}' does not exist on '${stateNode.id}'`);
    }
    return [stateNode, childStateNode];
  }
  const childStateKeys = Object.keys(stateValue);
  const childStateNodes = childStateKeys.map(subStateKey => getStateNode(stateNode, subStateKey)).filter(Boolean);
  return [stateNode.machine.root, stateNode].concat(childStateNodes, childStateKeys.reduce((allSubStateNodes, subStateKey) => {
    const subStateNode = getStateNode(stateNode, subStateKey);
    if (!subStateNode) {
      return allSubStateNodes;
    }
    const subStateNodes = getStateNodes(subStateNode, stateValue[subStateKey]);
    return allSubStateNodes.concat(subStateNodes);
  }, []));
}
function transitionAtomicNode(stateNode, stateValue, snapshot, event) {
  const childStateNode = getStateNode(stateNode, stateValue);
  const next = childStateNode.next(snapshot, event);
  if (!next || !next.length) {
    return stateNode.next(snapshot, event);
  }
  return next;
}
function transitionCompoundNode(stateNode, stateValue, snapshot, event) {
  const subStateKeys = Object.keys(stateValue);
  const childStateNode = getStateNode(stateNode, subStateKeys[0]);
  const next = transitionNode(childStateNode, stateValue[subStateKeys[0]], snapshot, event);
  if (!next || !next.length) {
    return stateNode.next(snapshot, event);
  }
  return next;
}
function transitionParallelNode(stateNode, stateValue, snapshot, event) {
  const allInnerTransitions = [];
  for (const subStateKey of Object.keys(stateValue)) {
    const subStateValue = stateValue[subStateKey];
    if (!subStateValue) {
      continue;
    }
    const subStateNode = getStateNode(stateNode, subStateKey);
    const innerTransitions = transitionNode(subStateNode, subStateValue, snapshot, event);
    if (innerTransitions) {
      allInnerTransitions.push(...innerTransitions);
    }
  }
  if (!allInnerTransitions.length) {
    return stateNode.next(snapshot, event);
  }
  return allInnerTransitions;
}
function transitionNode(stateNode, stateValue, snapshot, event) {
  // leaf node
  if (typeof stateValue === 'string') {
    return transitionAtomicNode(stateNode, stateValue, snapshot, event);
  }

  // compound node
  if (Object.keys(stateValue).length === 1) {
    return transitionCompoundNode(stateNode, stateValue, snapshot, event);
  }

  // parallel node
  return transitionParallelNode(stateNode, stateValue, snapshot, event);
}
function getHistoryNodes(stateNode) {
  return Object.keys(stateNode.states).map(key => stateNode.states[key]).filter(sn => sn.type === 'history');
}
function isDescendant(childStateNode, parentStateNode) {
  let marker = childStateNode;
  while (marker.parent && marker.parent !== parentStateNode) {
    marker = marker.parent;
  }
  return marker.parent === parentStateNode;
}
function hasIntersection(s1, s2) {
  const set1 = new Set(s1);
  const set2 = new Set(s2);
  for (const item of set1) {
    if (set2.has(item)) {
      return true;
    }
  }
  for (const item of set2) {
    if (set1.has(item)) {
      return true;
    }
  }
  return false;
}
function removeConflictingTransitions(enabledTransitions, stateNodeSet, historyValue) {
  const filteredTransitions = new Set();
  for (const t1 of enabledTransitions) {
    let t1Preempted = false;
    const transitionsToRemove = new Set();
    for (const t2 of filteredTransitions) {
      if (hasIntersection(computeExitSet([t1], stateNodeSet, historyValue), computeExitSet([t2], stateNodeSet, historyValue))) {
        if (isDescendant(t1.source, t2.source)) {
          transitionsToRemove.add(t2);
        } else {
          t1Preempted = true;
          break;
        }
      }
    }
    if (!t1Preempted) {
      for (const t3 of transitionsToRemove) {
        filteredTransitions.delete(t3);
      }
      filteredTransitions.add(t1);
    }
  }
  return Array.from(filteredTransitions);
}
function findLeastCommonAncestor(stateNodes) {
  const [head, ...tail] = stateNodes;
  for (const ancestor of getProperAncestors(head, undefined)) {
    if (tail.every(sn => isDescendant(sn, ancestor))) {
      return ancestor;
    }
  }
}
function getEffectiveTargetStates(transition, historyValue) {
  if (!transition.target) {
    return [];
  }
  const targets = new Set();
  for (const targetNode of transition.target) {
    if (isHistoryNode(targetNode)) {
      if (historyValue[targetNode.id]) {
        for (const node of historyValue[targetNode.id]) {
          targets.add(node);
        }
      } else {
        for (const node of getEffectiveTargetStates(resolveHistoryDefaultTransition(targetNode), historyValue)) {
          targets.add(node);
        }
      }
    } else {
      targets.add(targetNode);
    }
  }
  return [...targets];
}
function getTransitionDomain(transition, historyValue) {
  const targetStates = getEffectiveTargetStates(transition, historyValue);
  if (!targetStates) {
    return;
  }
  if (!transition.reenter && targetStates.every(target => target === transition.source || isDescendant(target, transition.source))) {
    return transition.source;
  }
  const lca = findLeastCommonAncestor(targetStates.concat(transition.source));
  if (lca) {
    return lca;
  }

  // at this point we know that it's a root transition since LCA couldn't be found
  if (transition.reenter) {
    return;
  }
  return transition.source.machine.root;
}
function computeExitSet(transitions, stateNodeSet, historyValue) {
  const statesToExit = new Set();
  for (const t of transitions) {
    if (t.target?.length) {
      const domain = getTransitionDomain(t, historyValue);
      if (t.reenter && t.source === domain) {
        statesToExit.add(domain);
      }
      for (const stateNode of stateNodeSet) {
        if (isDescendant(stateNode, domain)) {
          statesToExit.add(stateNode);
        }
      }
    }
  }
  return [...statesToExit];
}
function areStateNodeCollectionsEqual(prevStateNodes, nextStateNodeSet) {
  if (prevStateNodes.length !== nextStateNodeSet.size) {
    return false;
  }
  for (const node of prevStateNodes) {
    if (!nextStateNodeSet.has(node)) {
      return false;
    }
  }
  return true;
}

/** https://www.w3.org/TR/scxml/#microstepProcedure */
function microstep(transitions, currentSnapshot, actorScope, event, isInitial, internalQueue) {
  if (!transitions.length) {
    return currentSnapshot;
  }
  const mutStateNodeSet = new Set(currentSnapshot._nodes);
  let historyValue = currentSnapshot.historyValue;
  const filteredTransitions = removeConflictingTransitions(transitions, mutStateNodeSet, historyValue);
  let nextState = currentSnapshot;

  // Exit states
  if (!isInitial) {
    [nextState, historyValue] = exitStates(nextState, event, actorScope, filteredTransitions, mutStateNodeSet, historyValue, internalQueue, actorScope.actionExecutor);
  }

  // Execute transition content
  nextState = resolveActionsAndContext(nextState, event, actorScope, filteredTransitions.flatMap(t => t.actions), internalQueue, undefined);

  // Enter states
  nextState = enterStates(nextState, event, actorScope, filteredTransitions, mutStateNodeSet, internalQueue, historyValue, isInitial);
  const nextStateNodes = [...mutStateNodeSet];
  if (nextState.status === 'done') {
    nextState = resolveActionsAndContext(nextState, event, actorScope, nextStateNodes.sort((a, b) => b.order - a.order).flatMap(state => state.exit), internalQueue, undefined);
  }

  // eslint-disable-next-line no-useless-catch
  try {
    if (historyValue === currentSnapshot.historyValue && areStateNodeCollectionsEqual(currentSnapshot._nodes, mutStateNodeSet)) {
      return nextState;
    }
    return cloneMachineSnapshot(nextState, {
      _nodes: nextStateNodes,
      historyValue
    });
  } catch (e) {
    // TODO: Refactor this once proper error handling is implemented.
    // See https://github.com/statelyai/rfcs/pull/4
    throw e;
  }
}
function getMachineOutput(snapshot, event, actorScope, rootNode, rootCompletionNode) {
  if (rootNode.output === undefined) {
    return;
  }
  const doneStateEvent = createDoneStateEvent(rootCompletionNode.id, rootCompletionNode.output !== undefined && rootCompletionNode.parent ? resolveOutput(rootCompletionNode.output, snapshot.context, event, actorScope.self) : undefined);
  return resolveOutput(rootNode.output, snapshot.context, doneStateEvent, actorScope.self);
}
function enterStates(currentSnapshot, event, actorScope, filteredTransitions, mutStateNodeSet, internalQueue, historyValue, isInitial) {
  let nextSnapshot = currentSnapshot;
  const statesToEnter = new Set();
  // those are states that were directly targeted or indirectly targeted by the explicit target
  // in other words, those are states for which initial actions should be executed
  // when we target `#deep_child` initial actions of its ancestors shouldn't be executed
  const statesForDefaultEntry = new Set();
  computeEntrySet(filteredTransitions, historyValue, statesForDefaultEntry, statesToEnter);

  // In the initial state, the root state node is "entered".
  if (isInitial) {
    statesForDefaultEntry.add(currentSnapshot.machine.root);
  }
  const completedNodes = new Set();
  for (const stateNodeToEnter of [...statesToEnter].sort((a, b) => a.order - b.order)) {
    mutStateNodeSet.add(stateNodeToEnter);
    const actions = [];

    // Add entry actions
    actions.push(...stateNodeToEnter.entry);
    for (const invokeDef of stateNodeToEnter.invoke) {
      actions.push(spawnChild(invokeDef.src, {
        ...invokeDef,
        syncSnapshot: !!invokeDef.onSnapshot
      }));
    }
    if (statesForDefaultEntry.has(stateNodeToEnter)) {
      const initialActions = stateNodeToEnter.initial.actions;
      actions.push(...initialActions);
    }
    nextSnapshot = resolveActionsAndContext(nextSnapshot, event, actorScope, actions, internalQueue, stateNodeToEnter.invoke.map(invokeDef => invokeDef.id));
    if (stateNodeToEnter.type === 'final') {
      const parent = stateNodeToEnter.parent;
      let ancestorMarker = parent?.type === 'parallel' ? parent : parent?.parent;
      let rootCompletionNode = ancestorMarker || stateNodeToEnter;
      if (parent?.type === 'compound') {
        internalQueue.push(createDoneStateEvent(parent.id, stateNodeToEnter.output !== undefined ? resolveOutput(stateNodeToEnter.output, nextSnapshot.context, event, actorScope.self) : undefined));
      }
      while (ancestorMarker?.type === 'parallel' && !completedNodes.has(ancestorMarker) && isInFinalState(mutStateNodeSet, ancestorMarker)) {
        completedNodes.add(ancestorMarker);
        internalQueue.push(createDoneStateEvent(ancestorMarker.id));
        rootCompletionNode = ancestorMarker;
        ancestorMarker = ancestorMarker.parent;
      }
      if (ancestorMarker) {
        continue;
      }
      nextSnapshot = cloneMachineSnapshot(nextSnapshot, {
        status: 'done',
        output: getMachineOutput(nextSnapshot, event, actorScope, nextSnapshot.machine.root, rootCompletionNode)
      });
    }
  }
  return nextSnapshot;
}
function computeEntrySet(transitions, historyValue, statesForDefaultEntry, statesToEnter) {
  for (const t of transitions) {
    const domain = getTransitionDomain(t, historyValue);
    for (const s of t.target || []) {
      if (!isHistoryNode(s) && (
      // if the target is different than the source then it will *definitely* be entered
      t.source !== s ||
      // we know that the domain can't lie within the source
      // if it's different than the source then it's outside of it and it means that the target has to be entered as well
      t.source !== domain ||
      // reentering transitions always enter the target, even if it's the source itself
      t.reenter)) {
        statesToEnter.add(s);
        statesForDefaultEntry.add(s);
      }
      addDescendantStatesToEnter(s, historyValue, statesForDefaultEntry, statesToEnter);
    }
    const targetStates = getEffectiveTargetStates(t, historyValue);
    for (const s of targetStates) {
      const ancestors = getProperAncestors(s, domain);
      if (domain?.type === 'parallel') {
        ancestors.push(domain);
      }
      addAncestorStatesToEnter(statesToEnter, historyValue, statesForDefaultEntry, ancestors, !t.source.parent && t.reenter ? undefined : domain);
    }
  }
}
function addDescendantStatesToEnter(stateNode, historyValue, statesForDefaultEntry, statesToEnter) {
  if (isHistoryNode(stateNode)) {
    if (historyValue[stateNode.id]) {
      const historyStateNodes = historyValue[stateNode.id];
      for (const s of historyStateNodes) {
        statesToEnter.add(s);
        addDescendantStatesToEnter(s, historyValue, statesForDefaultEntry, statesToEnter);
      }
      for (const s of historyStateNodes) {
        addProperAncestorStatesToEnter(s, stateNode.parent, statesToEnter, historyValue, statesForDefaultEntry);
      }
    } else {
      const historyDefaultTransition = resolveHistoryDefaultTransition(stateNode);
      for (const s of historyDefaultTransition.target) {
        statesToEnter.add(s);
        if (historyDefaultTransition === stateNode.parent?.initial) {
          statesForDefaultEntry.add(stateNode.parent);
        }
        addDescendantStatesToEnter(s, historyValue, statesForDefaultEntry, statesToEnter);
      }
      for (const s of historyDefaultTransition.target) {
        addProperAncestorStatesToEnter(s, stateNode.parent, statesToEnter, historyValue, statesForDefaultEntry);
      }
    }
  } else {
    if (stateNode.type === 'compound') {
      const [initialState] = stateNode.initial.target;
      if (!isHistoryNode(initialState)) {
        statesToEnter.add(initialState);
        statesForDefaultEntry.add(initialState);
      }
      addDescendantStatesToEnter(initialState, historyValue, statesForDefaultEntry, statesToEnter);
      addProperAncestorStatesToEnter(initialState, stateNode, statesToEnter, historyValue, statesForDefaultEntry);
    } else {
      if (stateNode.type === 'parallel') {
        for (const child of getChildren(stateNode).filter(sn => !isHistoryNode(sn))) {
          if (![...statesToEnter].some(s => isDescendant(s, child))) {
            if (!isHistoryNode(child)) {
              statesToEnter.add(child);
              statesForDefaultEntry.add(child);
            }
            addDescendantStatesToEnter(child, historyValue, statesForDefaultEntry, statesToEnter);
          }
        }
      }
    }
  }
}
function addAncestorStatesToEnter(statesToEnter, historyValue, statesForDefaultEntry, ancestors, reentrancyDomain) {
  for (const anc of ancestors) {
    if (!reentrancyDomain || isDescendant(anc, reentrancyDomain)) {
      statesToEnter.add(anc);
    }
    if (anc.type === 'parallel') {
      for (const child of getChildren(anc).filter(sn => !isHistoryNode(sn))) {
        if (![...statesToEnter].some(s => isDescendant(s, child))) {
          statesToEnter.add(child);
          addDescendantStatesToEnter(child, historyValue, statesForDefaultEntry, statesToEnter);
        }
      }
    }
  }
}
function addProperAncestorStatesToEnter(stateNode, toStateNode, statesToEnter, historyValue, statesForDefaultEntry) {
  addAncestorStatesToEnter(statesToEnter, historyValue, statesForDefaultEntry, getProperAncestors(stateNode, toStateNode));
}
function exitStates(currentSnapshot, event, actorScope, transitions, mutStateNodeSet, historyValue, internalQueue, _actionExecutor) {
  let nextSnapshot = currentSnapshot;
  const statesToExit = computeExitSet(transitions, mutStateNodeSet, historyValue);
  statesToExit.sort((a, b) => b.order - a.order);
  let changedHistory;

  // From SCXML algorithm: https://www.w3.org/TR/scxml/#exitStates
  for (const exitStateNode of statesToExit) {
    for (const historyNode of getHistoryNodes(exitStateNode)) {
      let predicate;
      if (historyNode.history === 'deep') {
        predicate = sn => isAtomicStateNode(sn) && isDescendant(sn, exitStateNode);
      } else {
        predicate = sn => {
          return sn.parent === exitStateNode;
        };
      }
      changedHistory ??= {
        ...historyValue
      };
      changedHistory[historyNode.id] = Array.from(mutStateNodeSet).filter(predicate);
    }
  }
  for (const s of statesToExit) {
    nextSnapshot = resolveActionsAndContext(nextSnapshot, event, actorScope, [...s.exit, ...s.invoke.map(def => stopChild(def.id))], internalQueue, undefined);
    mutStateNodeSet.delete(s);
  }
  return [nextSnapshot, changedHistory || historyValue];
}
function getAction(machine, actionType) {
  return machine.implementations.actions[actionType];
}
function resolveAndExecuteActionsWithContext(currentSnapshot, event, actorScope, actions, extra, retries) {
  const {
    machine
  } = currentSnapshot;
  let intermediateSnapshot = currentSnapshot;
  for (const action of actions) {
    const isInline = typeof action === 'function';
    const resolvedAction = isInline ? action :
    // the existing type of `.actions` assumes non-nullable `TExpressionAction`
    // it's fine to cast this here to get a common type and lack of errors in the rest of the code
    // our logic below makes sure that we call those 2 "variants" correctly

    getAction(machine, typeof action === 'string' ? action : action.type);
    const actionArgs = {
      context: intermediateSnapshot.context,
      event,
      self: actorScope.self,
      system: actorScope.system
    };
    const actionParams = isInline || typeof action === 'string' ? undefined : 'params' in action ? typeof action.params === 'function' ? action.params({
      context: intermediateSnapshot.context,
      event
    }) : action.params : undefined;
    if (!resolvedAction || !('resolve' in resolvedAction)) {
      actorScope.actionExecutor({
        type: typeof action === 'string' ? action : typeof action === 'object' ? action.type : action.name || '(anonymous)',
        info: actionArgs,
        params: actionParams,
        exec: resolvedAction
      });
      continue;
    }
    const builtinAction = resolvedAction;
    const [nextState, params, actions] = builtinAction.resolve(actorScope, intermediateSnapshot, actionArgs, actionParams, resolvedAction,
    // this holds all params
    extra);
    intermediateSnapshot = nextState;
    if ('retryResolve' in builtinAction) {
      retries?.push([builtinAction, params]);
    }
    if ('execute' in builtinAction) {
      actorScope.actionExecutor({
        type: builtinAction.type,
        info: actionArgs,
        params,
        exec: builtinAction.execute.bind(null, actorScope, params)
      });
    }
    if (actions) {
      intermediateSnapshot = resolveAndExecuteActionsWithContext(intermediateSnapshot, event, actorScope, actions, extra, retries);
    }
  }
  return intermediateSnapshot;
}
function resolveActionsAndContext(currentSnapshot, event, actorScope, actions, internalQueue, deferredActorIds) {
  const retries = deferredActorIds ? [] : undefined;
  const nextState = resolveAndExecuteActionsWithContext(currentSnapshot, event, actorScope, actions, {
    internalQueue,
    deferredActorIds
  }, retries);
  retries?.forEach(([builtinAction, params]) => {
    builtinAction.retryResolve(actorScope, nextState, params);
  });
  return nextState;
}
function macrostep(snapshot, event, actorScope, internalQueue) {
  let nextSnapshot = snapshot;
  const microstates = [];
  function addMicrostate(microstate, event, transitions) {
    actorScope.system._sendInspectionEvent({
      type: '@xstate.microstep',
      actorRef: actorScope.self,
      event,
      snapshot: microstate,
      _transitions: transitions
    });
    microstates.push(microstate);
  }

  // Handle stop event
  if (event.type === XSTATE_STOP) {
    nextSnapshot = cloneMachineSnapshot(stopChildren(nextSnapshot, event, actorScope), {
      status: 'stopped'
    });
    addMicrostate(nextSnapshot, event, []);
    return {
      snapshot: nextSnapshot,
      microstates
    };
  }
  let nextEvent = event;

  // Assume the state is at rest (no raised events)
  // Determine the next state based on the next microstep
  if (nextEvent.type !== XSTATE_INIT) {
    const currentEvent = nextEvent;
    const isErr = isErrorActorEvent(currentEvent);
    const transitions = selectTransitions(currentEvent, nextSnapshot);
    if (isErr && !transitions.length) {
      // TODO: we should likely only allow transitions selected by very explicit descriptors
      // `*` shouldn't be matched, likely `xstate.error.*` shouldnt be either
      // similarly `xstate.error.actor.*` and `xstate.error.actor.todo.*` have to be considered too
      nextSnapshot = cloneMachineSnapshot(snapshot, {
        status: 'error',
        error: currentEvent.error
      });
      addMicrostate(nextSnapshot, currentEvent, []);
      return {
        snapshot: nextSnapshot,
        microstates
      };
    }
    nextSnapshot = microstep(transitions, snapshot, actorScope, nextEvent, false,
    // isInitial
    internalQueue);
    addMicrostate(nextSnapshot, currentEvent, transitions);
  }
  let shouldSelectEventlessTransitions = true;
  while (nextSnapshot.status === 'active') {
    let enabledTransitions = shouldSelectEventlessTransitions ? selectEventlessTransitions(nextSnapshot, nextEvent) : [];

    // eventless transitions should always be selected after selecting *regular* transitions
    // by assigning `undefined` to `previousState` we ensure that `shouldSelectEventlessTransitions` gets always computed to true in such a case
    const previousState = enabledTransitions.length ? nextSnapshot : undefined;
    if (!enabledTransitions.length) {
      if (!internalQueue.length) {
        break;
      }
      nextEvent = internalQueue.shift();
      enabledTransitions = selectTransitions(nextEvent, nextSnapshot);
    }
    nextSnapshot = microstep(enabledTransitions, nextSnapshot, actorScope, nextEvent, false, internalQueue);
    shouldSelectEventlessTransitions = nextSnapshot !== previousState;
    addMicrostate(nextSnapshot, nextEvent, enabledTransitions);
  }
  if (nextSnapshot.status !== 'active') {
    stopChildren(nextSnapshot, nextEvent, actorScope);
  }
  return {
    snapshot: nextSnapshot,
    microstates
  };
}
function stopChildren(nextState, event, actorScope) {
  return resolveActionsAndContext(nextState, event, actorScope, Object.values(nextState.children).map(child => stopChild(child)), [], undefined);
}
function selectTransitions(event, nextState) {
  return nextState.machine.getTransitionData(nextState, event);
}
function selectEventlessTransitions(nextState, event) {
  const enabledTransitionSet = new Set();
  const atomicStates = nextState._nodes.filter(isAtomicStateNode);
  for (const stateNode of atomicStates) {
    loop: for (const s of [stateNode].concat(getProperAncestors(stateNode, undefined))) {
      if (!s.always) {
        continue;
      }
      for (const transition of s.always) {
        if (transition.guard === undefined || evaluateGuard(transition.guard, nextState.context, event, nextState)) {
          enabledTransitionSet.add(transition);
          break loop;
        }
      }
    }
  }
  return removeConflictingTransitions(Array.from(enabledTransitionSet), new Set(nextState._nodes), nextState.historyValue);
}

/**
 * Resolves a partial state value with its full representation in the state
 * node's machine.
 *
 * @param stateValue The partial state value to resolve.
 */
function resolveStateValue(rootNode, stateValue) {
  const allStateNodes = getAllStateNodes(getStateNodes(rootNode, stateValue));
  return getStateValue(rootNode, [...allStateNodes]);
}

function isMachineSnapshot(value) {
  return !!value && typeof value === 'object' && 'machine' in value && 'value' in value;
}
const machineSnapshotMatches = function matches(testValue) {
  return matchesState(testValue, this.value);
};
const machineSnapshotHasTag = function hasTag(tag) {
  return this.tags.has(tag);
};
const machineSnapshotCan = function can(event) {
  const transitionData = this.machine.getTransitionData(this, event);
  return !!transitionData?.length &&
  // Check that at least one transition is not forbidden
  transitionData.some(t => t.target !== undefined || t.actions.length);
};
const machineSnapshotToJSON = function toJSON() {
  const {
    _nodes: nodes,
    tags,
    machine,
    getMeta,
    toJSON,
    can,
    hasTag,
    matches,
    ...jsonValues
  } = this;
  return {
    ...jsonValues,
    tags: Array.from(tags)
  };
};
const machineSnapshotGetMeta = function getMeta() {
  return this._nodes.reduce((acc, stateNode) => {
    if (stateNode.meta !== undefined) {
      acc[stateNode.id] = stateNode.meta;
    }
    return acc;
  }, {});
};
function createMachineSnapshot(config, machine) {
  return {
    status: config.status,
    output: config.output,
    error: config.error,
    machine,
    context: config.context,
    _nodes: config._nodes,
    value: getStateValue(machine.root, config._nodes),
    tags: new Set(config._nodes.flatMap(sn => sn.tags)),
    children: config.children,
    historyValue: config.historyValue || {},
    matches: machineSnapshotMatches,
    hasTag: machineSnapshotHasTag,
    can: machineSnapshotCan,
    getMeta: machineSnapshotGetMeta,
    toJSON: machineSnapshotToJSON
  };
}
function cloneMachineSnapshot(snapshot, config = {}) {
  return createMachineSnapshot({
    ...snapshot,
    ...config
  }, snapshot.machine);
}
function getPersistedSnapshot(snapshot, options) {
  const {
    _nodes: nodes,
    tags,
    machine,
    children,
    context,
    can,
    hasTag,
    matches,
    getMeta,
    toJSON,
    ...jsonValues
  } = snapshot;
  const childrenJson = {};
  for (const id in children) {
    const child = children[id];
    childrenJson[id] = {
      snapshot: child.getPersistedSnapshot(options),
      src: child.src,
      systemId: child._systemId,
      syncSnapshot: child._syncSnapshot
    };
  }
  const persisted = {
    ...jsonValues,
    context: persistContext(context),
    children: childrenJson
  };
  return persisted;
}
function persistContext(contextPart) {
  let copy;
  for (const key in contextPart) {
    const value = contextPart[key];
    if (value && typeof value === 'object') {
      if ('sessionId' in value && 'send' in value && 'ref' in value) {
        copy ??= Array.isArray(contextPart) ? contextPart.slice() : {
          ...contextPart
        };
        copy[key] = {
          xstate$$type: $$ACTOR_TYPE,
          id: value.id
        };
      } else {
        const result = persistContext(value);
        if (result !== value) {
          copy ??= Array.isArray(contextPart) ? contextPart.slice() : {
            ...contextPart
          };
          copy[key] = result;
        }
      }
    }
  }
  return copy ?? contextPart;
}

function resolveRaise(_, snapshot, args, actionParams, {
  event: eventOrExpr,
  id,
  delay
}, {
  internalQueue
}) {
  const delaysMap = snapshot.machine.implementations.delays;
  if (typeof eventOrExpr === 'string') {
    throw new Error(
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    `Only event objects may be used with raise; use raise({ type: "${eventOrExpr}" }) instead`);
  }
  const resolvedEvent = typeof eventOrExpr === 'function' ? eventOrExpr(args, actionParams) : eventOrExpr;
  let resolvedDelay;
  if (typeof delay === 'string') {
    const configDelay = delaysMap && delaysMap[delay];
    resolvedDelay = typeof configDelay === 'function' ? configDelay(args, actionParams) : configDelay;
  } else {
    resolvedDelay = typeof delay === 'function' ? delay(args, actionParams) : delay;
  }
  if (typeof resolvedDelay !== 'number') {
    internalQueue.push(resolvedEvent);
  }
  return [snapshot, {
    event: resolvedEvent,
    id,
    delay: resolvedDelay
  }, undefined];
}
function executeRaise(actorScope, params) {
  const {
    event,
    delay,
    id
  } = params;
  if (typeof delay === 'number') {
    actorScope.defer(() => {
      const self = actorScope.self;
      actorScope.system.scheduler.schedule(self, self, event, delay, id);
    });
    return;
  }
}
/**
 * Raises an event. This places the event in the internal event queue, so that
 * the event is immediately consumed by the machine in the current step.
 *
 * @param eventType The event to raise.
 */
function raise(eventOrExpr, options) {
  function raise(_args, _params) {
  }
  raise.type = 'xstate.raise';
  raise.event = eventOrExpr;
  raise.id = options?.id;
  raise.delay = options?.delay;
  raise.resolve = resolveRaise;
  raise.execute = executeRaise;
  return raise;
}

function createSpawner(actorScope, {
  machine,
  context
}, event, spawnedChildren) {
  const spawn = (src, options) => {
    if (typeof src === 'string') {
      const logic = resolveReferencedActor(machine, src);
      if (!logic) {
        throw new Error(`Actor logic '${src}' not implemented in machine '${machine.id}'`);
      }
      const actorRef = createActor(logic, {
        id: options?.id,
        parent: actorScope.self,
        syncSnapshot: options?.syncSnapshot,
        input: typeof options?.input === 'function' ? options.input({
          context,
          event,
          self: actorScope.self
        }) : options?.input,
        src,
        systemId: options?.systemId
      });
      spawnedChildren[actorRef.id] = actorRef;
      return actorRef;
    } else {
      const actorRef = createActor(src, {
        id: options?.id,
        parent: actorScope.self,
        syncSnapshot: options?.syncSnapshot,
        input: options?.input,
        src,
        systemId: options?.systemId
      });
      return actorRef;
    }
  };
  return (src, options) => {
    const actorRef = spawn(src, options); // TODO: fix types
    spawnedChildren[actorRef.id] = actorRef;
    actorScope.defer(() => {
      if (actorRef._processingStatus === ProcessingStatus.Stopped) {
        return;
      }
      actorRef.start();
    });
    return actorRef;
  };
}

function resolveAssign(actorScope, snapshot, actionArgs, actionParams, {
  assignment
}) {
  if (!snapshot.context) {
    throw new Error('Cannot assign to undefined `context`. Ensure that `context` is defined in the machine config.');
  }
  const spawnedChildren = {};
  const assignArgs = {
    context: snapshot.context,
    event: actionArgs.event,
    spawn: createSpawner(actorScope, snapshot, actionArgs.event, spawnedChildren),
    self: actorScope.self,
    system: actorScope.system
  };
  let partialUpdate = {};
  if (typeof assignment === 'function') {
    partialUpdate = assignment(assignArgs, actionParams);
  } else {
    for (const key of Object.keys(assignment)) {
      const propAssignment = assignment[key];
      partialUpdate[key] = typeof propAssignment === 'function' ? propAssignment(assignArgs, actionParams) : propAssignment;
    }
  }
  const updatedContext = Object.assign({}, snapshot.context, partialUpdate);
  return [cloneMachineSnapshot(snapshot, {
    context: updatedContext,
    children: Object.keys(spawnedChildren).length ? {
      ...snapshot.children,
      ...spawnedChildren
    } : snapshot.children
  }), undefined, undefined];
}
/**
 * Updates the current context of the machine.
 *
 * @example
 *
 * ```ts
 * import { createMachine, assign } from 'xstate';
 *
 * const countMachine = createMachine({
 *   context: {
 *     count: 0,
 *     message: ''
 *   },
 *   on: {
 *     inc: {
 *       actions: assign({
 *         count: ({ context }) => context.count + 1
 *       })
 *     },
 *     updateMessage: {
 *       actions: assign(({ context, event }) => {
 *         return {
 *           message: event.message.trim()
 *         };
 *       })
 *     }
 *   }
 * });
 * ```
 *
 * @param assignment An object that represents the partial context to update, or
 *   a function that returns an object that represents the partial context to
 *   update.
 */
function assign(assignment) {
  function assign(_args, _params) {
  }
  assign.type = 'xstate.assign';
  assign.assignment = assignment;
  assign.resolve = resolveAssign;
  return assign;
}

/**
 * Asserts that the given event object is of the specified type or types. Throws
 * an error if the event object is not of the specified types.
 *
 * @example
 *
 * ```ts
 * // ...
 * entry: ({ event }) => {
 *   assertEvent(event, 'doNothing');
 *   // event is { type: 'doNothing' }
 * },
 * // ...
 * exit: ({ event }) => {
 *   assertEvent(event, 'greet');
 *   // event is { type: 'greet'; message: string }
 *
 *   assertEvent(event, ['greet', 'notify']);
 *   // event is { type: 'greet'; message: string }
 *   // or { type: 'notify'; message: string; level: 'info' | 'error' }
 * },
 * ```
 */
function assertEvent(event, type) {
  const types = toArray(type);
  if (!types.includes(event.type)) {
    const typesText = types.length === 1 ? `type "${types[0]}"` : `one of types "${types.join('", "')}"`;
    throw new Error(`Expected event ${JSON.stringify(event)} to have ${typesText}`);
  }
}

const cache = new WeakMap();
function memo(object, key, fn) {
  let memoizedData = cache.get(object);
  if (!memoizedData) {
    memoizedData = {
      [key]: fn()
    };
    cache.set(object, memoizedData);
  } else if (!(key in memoizedData)) {
    memoizedData[key] = fn();
  }
  return memoizedData[key];
}

const EMPTY_OBJECT = {};
const toSerializableAction = action => {
  if (typeof action === 'string') {
    return {
      type: action
    };
  }
  if (typeof action === 'function') {
    if ('resolve' in action) {
      return {
        type: action.type
      };
    }
    return {
      type: action.name
    };
  }
  return action;
};
class StateNode {
  constructor(/** The raw config used to create the machine. */
  config, options) {
    this.config = config;
    /**
     * The relative key of the state node, which represents its location in the
     * overall state value.
     */
    this.key = void 0;
    /** The unique ID of the state node. */
    this.id = void 0;
    /**
     * The type of this state node:
     *
     * - `'atomic'` - no child state nodes
     * - `'compound'` - nested child state nodes (XOR)
     * - `'parallel'` - orthogonal nested child state nodes (AND)
     * - `'history'` - history state node
     * - `'final'` - final state node
     */
    this.type = void 0;
    /** The string path from the root machine node to this node. */
    this.path = void 0;
    /** The child state nodes. */
    this.states = void 0;
    /**
     * The type of history on this state node. Can be:
     *
     * - `'shallow'` - recalls only top-level historical state value
     * - `'deep'` - recalls historical state value at all levels
     */
    this.history = void 0;
    /** The action(s) to be executed upon entering the state node. */
    this.entry = void 0;
    /** The action(s) to be executed upon exiting the state node. */
    this.exit = void 0;
    /** The parent state node. */
    this.parent = void 0;
    /** The root machine node. */
    this.machine = void 0;
    /**
     * The meta data associated with this state node, which will be returned in
     * State instances.
     */
    this.meta = void 0;
    /**
     * The output data sent with the "xstate.done.state._id_" event if this is a
     * final state node.
     */
    this.output = void 0;
    /**
     * The order this state node appears. Corresponds to the implicit document
     * order.
     */
    this.order = -1;
    this.description = void 0;
    this.tags = [];
    this.transitions = void 0;
    this.always = void 0;
    this.parent = options._parent;
    this.key = options._key;
    this.machine = options._machine;
    this.path = this.parent ? this.parent.path.concat(this.key) : [];
    this.id = this.config.id || [this.machine.id, ...this.path].join(STATE_DELIMITER);
    this.type = this.config.type || (this.config.states && Object.keys(this.config.states).length ? 'compound' : this.config.history ? 'history' : 'atomic');
    this.description = this.config.description;
    this.order = this.machine.idMap.size;
    this.machine.idMap.set(this.id, this);
    this.states = this.config.states ? mapValues(this.config.states, (stateConfig, key) => {
      const stateNode = new StateNode(stateConfig, {
        _parent: this,
        _key: key,
        _machine: this.machine
      });
      return stateNode;
    }) : EMPTY_OBJECT;
    if (this.type === 'compound' && !this.config.initial) {
      throw new Error(`No initial state specified for compound state node "#${this.id}". Try adding { initial: "${Object.keys(this.states)[0]}" } to the state config.`);
    }

    // History config
    this.history = this.config.history === true ? 'shallow' : this.config.history || false;
    this.entry = toArray(this.config.entry).slice();
    this.exit = toArray(this.config.exit).slice();
    this.meta = this.config.meta;
    this.output = this.type === 'final' || !this.parent ? this.config.output : undefined;
    this.tags = toArray(config.tags).slice();
  }

  /** @internal */
  _initialize() {
    this.transitions = formatTransitions(this);
    if (this.config.always) {
      this.always = toTransitionConfigArray(this.config.always).map(t => formatTransition(this, NULL_EVENT, t));
    }
    Object.keys(this.states).forEach(key => {
      this.states[key]._initialize();
    });
  }

  /** The well-structured state node definition. */
  get definition() {
    return {
      id: this.id,
      key: this.key,
      version: this.machine.version,
      type: this.type,
      initial: this.initial ? {
        target: this.initial.target,
        source: this,
        actions: this.initial.actions.map(toSerializableAction),
        eventType: null,
        reenter: false,
        toJSON: () => ({
          target: this.initial.target.map(t => `#${t.id}`),
          source: `#${this.id}`,
          actions: this.initial.actions.map(toSerializableAction),
          eventType: null
        })
      } : undefined,
      history: this.history,
      states: mapValues(this.states, state => {
        return state.definition;
      }),
      on: this.on,
      transitions: [...this.transitions.values()].flat().map(t => ({
        ...t,
        actions: t.actions.map(toSerializableAction)
      })),
      entry: this.entry.map(toSerializableAction),
      exit: this.exit.map(toSerializableAction),
      meta: this.meta,
      order: this.order || -1,
      output: this.output,
      invoke: this.invoke,
      description: this.description,
      tags: this.tags
    };
  }

  /** @internal */
  toJSON() {
    return this.definition;
  }

  /** The logic invoked as actors by this state node. */
  get invoke() {
    return memo(this, 'invoke', () => toArray(this.config.invoke).map((invokeConfig, i) => {
      const {
        src,
        systemId
      } = invokeConfig;
      const resolvedId = invokeConfig.id ?? createInvokeId(this.id, i);
      const sourceName = typeof src === 'string' ? src : `xstate.invoke.${createInvokeId(this.id, i)}`;
      return {
        ...invokeConfig,
        src: sourceName,
        id: resolvedId,
        systemId: systemId,
        toJSON() {
          const {
            onDone,
            onError,
            ...invokeDefValues
          } = invokeConfig;
          return {
            ...invokeDefValues,
            type: 'xstate.invoke',
            src: sourceName,
            id: resolvedId
          };
        }
      };
    }));
  }

  /** The mapping of events to transitions. */
  get on() {
    return memo(this, 'on', () => {
      const transitions = this.transitions;
      return [...transitions].flatMap(([descriptor, t]) => t.map(t => [descriptor, t])).reduce((map, [descriptor, transition]) => {
        map[descriptor] = map[descriptor] || [];
        map[descriptor].push(transition);
        return map;
      }, {});
    });
  }
  get after() {
    return memo(this, 'delayedTransitions', () => getDelayedTransitions(this));
  }
  get initial() {
    return memo(this, 'initial', () => formatInitialTransition(this, this.config.initial));
  }

  /** @internal */
  next(snapshot, event) {
    const eventType = event.type;
    const actions = [];
    let selectedTransition;
    const candidates = memo(this, `candidates-${eventType}`, () => getCandidates(this, eventType));
    for (const candidate of candidates) {
      const {
        guard
      } = candidate;
      const resolvedContext = snapshot.context;
      let guardPassed = false;
      try {
        guardPassed = !guard || evaluateGuard(guard, resolvedContext, event, snapshot);
      } catch (err) {
        const guardType = typeof guard === 'string' ? guard : typeof guard === 'object' ? guard.type : undefined;
        throw new Error(`Unable to evaluate guard ${guardType ? `'${guardType}' ` : ''}in transition for event '${eventType}' in state node '${this.id}':\n${err.message}`);
      }
      if (guardPassed) {
        actions.push(...candidate.actions);
        selectedTransition = candidate;
        break;
      }
    }
    return selectedTransition ? [selectedTransition] : undefined;
  }

  /** All the event types accepted by this state node and its descendants. */
  get events() {
    return memo(this, 'events', () => {
      const {
        states
      } = this;
      const events = new Set(this.ownEvents);
      if (states) {
        for (const stateId of Object.keys(states)) {
          const state = states[stateId];
          if (state.states) {
            for (const event of state.events) {
              events.add(`${event}`);
            }
          }
        }
      }
      return Array.from(events);
    });
  }

  /**
   * All the events that have transitions directly from this state node.
   *
   * Excludes any inert events.
   */
  get ownEvents() {
    const events = new Set([...this.transitions.keys()].filter(descriptor => {
      return this.transitions.get(descriptor).some(transition => !(!transition.target && !transition.actions.length && !transition.reenter));
    }));
    return Array.from(events);
  }
}

const STATE_IDENTIFIER = '#';
class StateMachine {
  constructor(/** The raw config used to create the machine. */
  config, implementations) {
    this.config = config;
    /** The machine's own version. */
    this.version = void 0;
    this.schemas = void 0;
    this.implementations = void 0;
    /** @internal */
    this.__xstatenode = true;
    /** @internal */
    this.idMap = new Map();
    this.root = void 0;
    this.id = void 0;
    this.states = void 0;
    this.events = void 0;
    this.id = config.id || '(machine)';
    this.implementations = {
      actors: implementations?.actors ?? {},
      actions: implementations?.actions ?? {},
      delays: implementations?.delays ?? {},
      guards: implementations?.guards ?? {}
    };
    this.version = this.config.version;
    this.schemas = this.config.schemas;
    this.transition = this.transition.bind(this);
    this.getInitialSnapshot = this.getInitialSnapshot.bind(this);
    this.getPersistedSnapshot = this.getPersistedSnapshot.bind(this);
    this.restoreSnapshot = this.restoreSnapshot.bind(this);
    this.start = this.start.bind(this);
    this.root = new StateNode(config, {
      _key: this.id,
      _machine: this
    });
    this.root._initialize();
    this.states = this.root.states; // TODO: remove!
    this.events = this.root.events;
  }

  /**
   * Clones this state machine with the provided implementations and merges the
   * `context` (if provided).
   *
   * @param implementations Options (`actions`, `guards`, `actors`, `delays`,
   *   `context`) to recursively merge with the existing options.
   * @returns A new `StateMachine` instance with the provided implementations.
   */
  provide(implementations) {
    const {
      actions,
      guards,
      actors,
      delays
    } = this.implementations;
    return new StateMachine(this.config, {
      actions: {
        ...actions,
        ...implementations.actions
      },
      guards: {
        ...guards,
        ...implementations.guards
      },
      actors: {
        ...actors,
        ...implementations.actors
      },
      delays: {
        ...delays,
        ...implementations.delays
      }
    });
  }
  resolveState(config) {
    const resolvedStateValue = resolveStateValue(this.root, config.value);
    const nodeSet = getAllStateNodes(getStateNodes(this.root, resolvedStateValue));
    return createMachineSnapshot({
      _nodes: [...nodeSet],
      context: config.context || {},
      children: {},
      status: isInFinalState(nodeSet, this.root) ? 'done' : config.status || 'active',
      output: config.output,
      error: config.error,
      historyValue: config.historyValue
    }, this);
  }

  /**
   * Determines the next snapshot given the current `snapshot` and received
   * `event`. Calculates a full macrostep from all microsteps.
   *
   * @param snapshot The current snapshot
   * @param event The received event
   */
  transition(snapshot, event, actorScope) {
    return macrostep(snapshot, event, actorScope, []).snapshot;
  }

  /**
   * Determines the next state given the current `state` and `event`. Calculates
   * a microstep.
   *
   * @param state The current state
   * @param event The received event
   */
  microstep(snapshot, event, actorScope) {
    return macrostep(snapshot, event, actorScope, []).microstates;
  }
  getTransitionData(snapshot, event) {
    return transitionNode(this.root, snapshot.value, snapshot, event) || [];
  }

  /**
   * The initial state _before_ evaluating any microsteps. This "pre-initial"
   * state is provided to initial actions executed in the initial state.
   */
  getPreInitialState(actorScope, initEvent, internalQueue) {
    const {
      context
    } = this.config;
    const preInitial = createMachineSnapshot({
      context: typeof context !== 'function' && context ? context : {},
      _nodes: [this.root],
      children: {},
      status: 'active'
    }, this);
    if (typeof context === 'function') {
      const assignment = ({
        spawn,
        event,
        self
      }) => context({
        spawn,
        input: event.input,
        self
      });
      return resolveActionsAndContext(preInitial, initEvent, actorScope, [assign(assignment)], internalQueue, undefined);
    }
    return preInitial;
  }

  /**
   * Returns the initial `State` instance, with reference to `self` as an
   * `ActorRef`.
   */
  getInitialSnapshot(actorScope, input) {
    const initEvent = createInitEvent(input); // TODO: fix;
    const internalQueue = [];
    const preInitialState = this.getPreInitialState(actorScope, initEvent, internalQueue);
    const nextState = microstep([{
      target: [...getInitialStateNodes(this.root)],
      source: this.root,
      reenter: true,
      actions: [],
      eventType: null,
      toJSON: null // TODO: fix
    }], preInitialState, actorScope, initEvent, true, internalQueue);
    const {
      snapshot: macroState
    } = macrostep(nextState, initEvent, actorScope, internalQueue);
    return macroState;
  }
  start(snapshot) {
    Object.values(snapshot.children).forEach(child => {
      if (child.getSnapshot().status === 'active') {
        child.start();
      }
    });
  }
  getStateNodeById(stateId) {
    const fullPath = toStatePath(stateId);
    const relativePath = fullPath.slice(1);
    const resolvedStateId = isStateId(fullPath[0]) ? fullPath[0].slice(STATE_IDENTIFIER.length) : fullPath[0];
    const stateNode = this.idMap.get(resolvedStateId);
    if (!stateNode) {
      throw new Error(`Child state node '#${resolvedStateId}' does not exist on machine '${this.id}'`);
    }
    return getStateNodeByPath(stateNode, relativePath);
  }
  get definition() {
    return this.root.definition;
  }
  toJSON() {
    return this.definition;
  }
  getPersistedSnapshot(snapshot, options) {
    return getPersistedSnapshot(snapshot, options);
  }
  restoreSnapshot(snapshot, _actorScope) {
    const children = {};
    const snapshotChildren = snapshot.children;
    Object.keys(snapshotChildren).forEach(actorId => {
      const actorData = snapshotChildren[actorId];
      const childState = actorData.snapshot;
      const src = actorData.src;
      const logic = typeof src === 'string' ? resolveReferencedActor(this, src) : src;
      if (!logic) {
        return;
      }
      const actorRef = createActor(logic, {
        id: actorId,
        parent: _actorScope.self,
        syncSnapshot: actorData.syncSnapshot,
        snapshot: childState,
        src,
        systemId: actorData.systemId
      });
      children[actorId] = actorRef;
    });
    const restoredSnapshot = createMachineSnapshot({
      ...snapshot,
      children,
      _nodes: Array.from(getAllStateNodes(getStateNodes(this.root, snapshot.value)))
    }, this);
    const seen = new Set();
    function reviveContext(contextPart, children) {
      if (seen.has(contextPart)) {
        return;
      }
      seen.add(contextPart);
      for (const key in contextPart) {
        const value = contextPart[key];
        if (value && typeof value === 'object') {
          if ('xstate$$type' in value && value.xstate$$type === $$ACTOR_TYPE) {
            contextPart[key] = children[value.id];
            continue;
          }
          reviveContext(value, children);
        }
      }
    }
    reviveContext(restoredSnapshot.context, children);
    return restoredSnapshot;
  }
}

/**
 * Creates a state machine (statechart) with the given configuration.
 *
 * The state machine represents the pure logic of a state machine actor.
 *
 * @example
 *
 * ```ts
 * import { createMachine } from 'xstate';
 *
 * const lightMachine = createMachine({
 *   id: 'light',
 *   initial: 'green',
 *   states: {
 *     green: {
 *       on: {
 *         TIMER: { target: 'yellow' }
 *       }
 *     },
 *     yellow: {
 *       on: {
 *         TIMER: { target: 'red' }
 *       }
 *     },
 *     red: {
 *       on: {
 *         TIMER: { target: 'green' }
 *       }
 *     }
 *   }
 * });
 *
 * const lightActor = createActor(lightMachine);
 * lightActor.start();
 *
 * lightActor.send({ type: 'TIMER' });
 * ```
 *
 * @param config The state machine configuration.
 * @param options DEPRECATED: use `setup({ ... })` or `machine.provide({ ... })`
 *   to provide machine implementations instead.
 */
function createMachine(config, implementations) {
  return new StateMachine(config, implementations);
}

// at the moment we allow extra actors - ones that are not specified by `children`
// this could be reconsidered in the future

function setup({
  schemas,
  actors,
  actions,
  guards,
  delays
}) {
  return {
    createMachine: config => createMachine({
      ...config,
      schemas
    }, {
      actors,
      actions,
      guards,
      delays
    })
  };
}

const defaultWaitForOptions = {
  timeout: Infinity // much more than 10 seconds
};

/**
 * Subscribes to an actor ref and waits for its emitted value to satisfy a
 * predicate, and then resolves with that value. Will throw if the desired state
 * is not reached after an optional timeout. (defaults to Infinity).
 *
 * @example
 *
 * ```js
 * const state = await waitFor(someService, (state) => {
 *   return state.hasTag('loaded');
 * });
 *
 * state.hasTag('loaded'); // true
 * ```
 *
 * @param actorRef The actor ref to subscribe to
 * @param predicate Determines if a value matches the condition to wait for
 * @param options
 * @returns A promise that eventually resolves to the emitted value that matches
 *   the condition
 */
function waitFor(actorRef, predicate, options) {
  const resolvedOptions = {
    ...defaultWaitForOptions,
    ...options
  };
  return new Promise((res, rej) => {
    const {
      signal
    } = resolvedOptions;
    if (signal?.aborted) {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      rej(signal.reason);
      return;
    }
    let done = false;
    const handle = resolvedOptions.timeout === Infinity ? undefined : setTimeout(() => {
      dispose();
      rej(new Error(`Timeout of ${resolvedOptions.timeout} ms exceeded`));
    }, resolvedOptions.timeout);
    const dispose = () => {
      clearTimeout(handle);
      done = true;
      sub?.unsubscribe();
      if (abortListener) {
        signal.removeEventListener('abort', abortListener);
      }
    };
    function checkEmitted(emitted) {
      if (predicate(emitted)) {
        dispose();
        res(emitted);
      }
    }

    /**
     * If the `signal` option is provided, this will be the listener for its
     * `abort` event
     */
    let abortListener;
    // eslint-disable-next-line prefer-const
    let sub; // avoid TDZ when disposing synchronously

    // See if the current snapshot already matches the predicate
    checkEmitted(actorRef.getSnapshot());
    if (done) {
      return;
    }

    // only define the `abortListener` if the `signal` option is provided
    if (signal) {
      abortListener = () => {
        dispose();
        // XState does not "own" the signal, so we should reject with its reason (if any)
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        rej(signal.reason);
      };
      signal.addEventListener('abort', abortListener);
    }
    sub = actorRef.subscribe({
      next: checkEmitted,
      error: err => {
        dispose();
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        rej(err);
      },
      complete: () => {
        dispose();
        rej(new Error(`Actor terminated without satisfying predicate`));
      }
    });
    if (done) {
      sub.unsubscribe();
    }
  });
}

var sha256$2 = {};

var _md = {};

var _assert = {};

var hasRequired_assert;

function require_assert () {
	if (hasRequired_assert) return _assert;
	hasRequired_assert = 1;
	Object.defineProperty(_assert, "__esModule", { value: true });
	_assert.anumber = anumber;
	_assert.number = anumber;
	_assert.abytes = abytes;
	_assert.bytes = abytes;
	_assert.ahash = ahash;
	_assert.aexists = aexists;
	_assert.aoutput = aoutput;
	function anumber(n) {
	    if (!Number.isSafeInteger(n) || n < 0)
	        throw new Error('positive integer expected, got ' + n);
	}
	// copied from utils
	function isBytes(a) {
	    return a instanceof Uint8Array || (ArrayBuffer.isView(a) && a.constructor.name === 'Uint8Array');
	}
	function abytes(b, ...lengths) {
	    if (!isBytes(b))
	        throw new Error('Uint8Array expected');
	    if (lengths.length > 0 && !lengths.includes(b.length))
	        throw new Error('Uint8Array expected of length ' + lengths + ', got length=' + b.length);
	}
	function ahash(h) {
	    if (typeof h !== 'function' || typeof h.create !== 'function')
	        throw new Error('Hash should be wrapped by utils.wrapConstructor');
	    anumber(h.outputLen);
	    anumber(h.blockLen);
	}
	function aexists(instance, checkFinished = true) {
	    if (instance.destroyed)
	        throw new Error('Hash instance has been destroyed');
	    if (checkFinished && instance.finished)
	        throw new Error('Hash#digest() has already been called');
	}
	function aoutput(out, instance) {
	    abytes(out);
	    const min = instance.outputLen;
	    if (out.length < min) {
	        throw new Error('digestInto() expects output buffer of length at least ' + min);
	    }
	}
	const assert = {
	    number: anumber,
	    bytes: abytes,
	    hash: ahash,
	    exists: aexists,
	    output: aoutput,
	};
	_assert.default = assert;
	
	return _assert;
}

var utils = {};

var crypto$1 = {};

var hasRequiredCrypto;

function requireCrypto () {
	if (hasRequiredCrypto) return crypto$1;
	hasRequiredCrypto = 1;
	Object.defineProperty(crypto$1, "__esModule", { value: true });
	crypto$1.crypto = void 0;
	crypto$1.crypto = typeof globalThis === 'object' && 'crypto' in globalThis ? globalThis.crypto : undefined;
	
	return crypto$1;
}

var hasRequiredUtils;

function requireUtils () {
	if (hasRequiredUtils) return utils;
	hasRequiredUtils = 1;
	(function (exports) {
		/*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) */
		Object.defineProperty(exports, "__esModule", { value: true });
		exports.Hash = exports.nextTick = exports.byteSwapIfBE = exports.byteSwap = exports.isLE = exports.rotl = exports.rotr = exports.createView = exports.u32 = exports.u8 = void 0;
		exports.isBytes = isBytes;
		exports.byteSwap32 = byteSwap32;
		exports.bytesToHex = bytesToHex;
		exports.hexToBytes = hexToBytes;
		exports.asyncLoop = asyncLoop;
		exports.utf8ToBytes = utf8ToBytes;
		exports.toBytes = toBytes;
		exports.concatBytes = concatBytes;
		exports.checkOpts = checkOpts;
		exports.wrapConstructor = wrapConstructor;
		exports.wrapConstructorWithOpts = wrapConstructorWithOpts;
		exports.wrapXOFConstructorWithOpts = wrapXOFConstructorWithOpts;
		exports.randomBytes = randomBytes;
		// We use WebCrypto aka globalThis.crypto, which exists in browsers and node.js 16+.
		// node.js versions earlier than v19 don't declare it in global scope.
		// For node.js, package.json#exports field mapping rewrites import
		// from `crypto` to `cryptoNode`, which imports native module.
		// Makes the utils un-importable in browsers without a bundler.
		// Once node.js 18 is deprecated (2025-04-30), we can just drop the import.
		const crypto_1 = /*@__PURE__*/ requireCrypto();
		const _assert_js_1 = /*@__PURE__*/ require_assert();
		// export { isBytes } from './_assert.js';
		// We can't reuse isBytes from _assert, because somehow this causes huge perf issues
		function isBytes(a) {
		    return a instanceof Uint8Array || (ArrayBuffer.isView(a) && a.constructor.name === 'Uint8Array');
		}
		// Cast array to different type
		const u8 = (arr) => new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
		exports.u8 = u8;
		const u32 = (arr) => new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
		exports.u32 = u32;
		// Cast array to view
		const createView = (arr) => new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
		exports.createView = createView;
		// The rotate right (circular right shift) operation for uint32
		const rotr = (word, shift) => (word << (32 - shift)) | (word >>> shift);
		exports.rotr = rotr;
		// The rotate left (circular left shift) operation for uint32
		const rotl = (word, shift) => (word << shift) | ((word >>> (32 - shift)) >>> 0);
		exports.rotl = rotl;
		exports.isLE = (() => new Uint8Array(new Uint32Array([0x11223344]).buffer)[0] === 0x44)();
		// The byte swap operation for uint32
		const byteSwap = (word) => ((word << 24) & 0xff000000) |
		    ((word << 8) & 0xff0000) |
		    ((word >>> 8) & 0xff00) |
		    ((word >>> 24) & 0xff);
		exports.byteSwap = byteSwap;
		// Conditionally byte swap if on a big-endian platform
		exports.byteSwapIfBE = exports.isLE ? (n) => n : (n) => (0, exports.byteSwap)(n);
		// In place byte swap for Uint32Array
		function byteSwap32(arr) {
		    for (let i = 0; i < arr.length; i++) {
		        arr[i] = (0, exports.byteSwap)(arr[i]);
		    }
		}
		// Array where index 0xf0 (240) is mapped to string 'f0'
		const hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
		/**
		 * @example bytesToHex(Uint8Array.from([0xca, 0xfe, 0x01, 0x23])) // 'cafe0123'
		 */
		function bytesToHex(bytes) {
		    (0, _assert_js_1.abytes)(bytes);
		    // pre-caching improves the speed 6x
		    let hex = '';
		    for (let i = 0; i < bytes.length; i++) {
		        hex += hexes[bytes[i]];
		    }
		    return hex;
		}
		// We use optimized technique to convert hex string to byte array
		const asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
		function asciiToBase16(ch) {
		    if (ch >= asciis._0 && ch <= asciis._9)
		        return ch - asciis._0; // '2' => 50-48
		    if (ch >= asciis.A && ch <= asciis.F)
		        return ch - (asciis.A - 10); // 'B' => 66-(65-10)
		    if (ch >= asciis.a && ch <= asciis.f)
		        return ch - (asciis.a - 10); // 'b' => 98-(97-10)
		    return;
		}
		/**
		 * @example hexToBytes('cafe0123') // Uint8Array.from([0xca, 0xfe, 0x01, 0x23])
		 */
		function hexToBytes(hex) {
		    if (typeof hex !== 'string')
		        throw new Error('hex string expected, got ' + typeof hex);
		    const hl = hex.length;
		    const al = hl / 2;
		    if (hl % 2)
		        throw new Error('hex string expected, got unpadded hex of length ' + hl);
		    const array = new Uint8Array(al);
		    for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
		        const n1 = asciiToBase16(hex.charCodeAt(hi));
		        const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
		        if (n1 === undefined || n2 === undefined) {
		            const char = hex[hi] + hex[hi + 1];
		            throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
		        }
		        array[ai] = n1 * 16 + n2; // multiply first octet, e.g. 'a3' => 10*16+3 => 160 + 3 => 163
		    }
		    return array;
		}
		// There is no setImmediate in browser and setTimeout is slow.
		// call of async fn will return Promise, which will be fullfiled only on
		// next scheduler queue processing step and this is exactly what we need.
		const nextTick = async () => { };
		exports.nextTick = nextTick;
		// Returns control to thread each 'tick' ms to avoid blocking
		async function asyncLoop(iters, tick, cb) {
		    let ts = Date.now();
		    for (let i = 0; i < iters; i++) {
		        cb(i);
		        // Date.now() is not monotonic, so in case if clock goes backwards we return return control too
		        const diff = Date.now() - ts;
		        if (diff >= 0 && diff < tick)
		            continue;
		        await (0, exports.nextTick)();
		        ts += diff;
		    }
		}
		/**
		 * @example utf8ToBytes('abc') // new Uint8Array([97, 98, 99])
		 */
		function utf8ToBytes(str) {
		    if (typeof str !== 'string')
		        throw new Error('utf8ToBytes expected string, got ' + typeof str);
		    return new Uint8Array(new TextEncoder().encode(str)); // https://bugzil.la/1681809
		}
		/**
		 * Normalizes (non-hex) string or Uint8Array to Uint8Array.
		 * Warning: when Uint8Array is passed, it would NOT get copied.
		 * Keep in mind for future mutable operations.
		 */
		function toBytes(data) {
		    if (typeof data === 'string')
		        data = utf8ToBytes(data);
		    (0, _assert_js_1.abytes)(data);
		    return data;
		}
		/**
		 * Copies several Uint8Arrays into one.
		 */
		function concatBytes(...arrays) {
		    let sum = 0;
		    for (let i = 0; i < arrays.length; i++) {
		        const a = arrays[i];
		        (0, _assert_js_1.abytes)(a);
		        sum += a.length;
		    }
		    const res = new Uint8Array(sum);
		    for (let i = 0, pad = 0; i < arrays.length; i++) {
		        const a = arrays[i];
		        res.set(a, pad);
		        pad += a.length;
		    }
		    return res;
		}
		// For runtime check if class implements interface
		class Hash {
		    // Safe version that clones internal state
		    clone() {
		        return this._cloneInto();
		    }
		}
		exports.Hash = Hash;
		function checkOpts(defaults, opts) {
		    if (opts !== undefined && {}.toString.call(opts) !== '[object Object]')
		        throw new Error('Options should be object or undefined');
		    const merged = Object.assign(defaults, opts);
		    return merged;
		}
		function wrapConstructor(hashCons) {
		    const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
		    const tmp = hashCons();
		    hashC.outputLen = tmp.outputLen;
		    hashC.blockLen = tmp.blockLen;
		    hashC.create = () => hashCons();
		    return hashC;
		}
		function wrapConstructorWithOpts(hashCons) {
		    const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
		    const tmp = hashCons({});
		    hashC.outputLen = tmp.outputLen;
		    hashC.blockLen = tmp.blockLen;
		    hashC.create = (opts) => hashCons(opts);
		    return hashC;
		}
		function wrapXOFConstructorWithOpts(hashCons) {
		    const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
		    const tmp = hashCons({});
		    hashC.outputLen = tmp.outputLen;
		    hashC.blockLen = tmp.blockLen;
		    hashC.create = (opts) => hashCons(opts);
		    return hashC;
		}
		/**
		 * Secure PRNG. Uses `crypto.getRandomValues`, which defers to OS.
		 */
		function randomBytes(bytesLength = 32) {
		    if (crypto_1.crypto && typeof crypto_1.crypto.getRandomValues === 'function') {
		        return crypto_1.crypto.getRandomValues(new Uint8Array(bytesLength));
		    }
		    // Legacy Node.js compatibility
		    if (crypto_1.crypto && typeof crypto_1.crypto.randomBytes === 'function') {
		        return crypto_1.crypto.randomBytes(bytesLength);
		    }
		    throw new Error('crypto.getRandomValues must be defined');
		}
		
	} (utils));
	return utils;
}

var hasRequired_md;

function require_md () {
	if (hasRequired_md) return _md;
	hasRequired_md = 1;
	Object.defineProperty(_md, "__esModule", { value: true });
	_md.HashMD = _md.Maj = _md.Chi = void 0;
	const _assert_js_1 = /*@__PURE__*/ require_assert();
	const utils_js_1 = /*@__PURE__*/ requireUtils();
	/**
	 * Polyfill for Safari 14
	 */
	function setBigUint64(view, byteOffset, value, isLE) {
	    if (typeof view.setBigUint64 === 'function')
	        return view.setBigUint64(byteOffset, value, isLE);
	    const _32n = BigInt(32);
	    const _u32_max = BigInt(0xffffffff);
	    const wh = Number((value >> _32n) & _u32_max);
	    const wl = Number(value & _u32_max);
	    const h = isLE ? 4 : 0;
	    const l = isLE ? 0 : 4;
	    view.setUint32(byteOffset + h, wh, isLE);
	    view.setUint32(byteOffset + l, wl, isLE);
	}
	/**
	 * Choice: a ? b : c
	 */
	const Chi = (a, b, c) => (a & b) ^ (~a & c);
	_md.Chi = Chi;
	/**
	 * Majority function, true if any two inputs is true
	 */
	const Maj = (a, b, c) => (a & b) ^ (a & c) ^ (b & c);
	_md.Maj = Maj;
	/**
	 * Merkle-Damgard hash construction base class.
	 * Could be used to create MD5, RIPEMD, SHA1, SHA2.
	 */
	class HashMD extends utils_js_1.Hash {
	    constructor(blockLen, outputLen, padOffset, isLE) {
	        super();
	        this.blockLen = blockLen;
	        this.outputLen = outputLen;
	        this.padOffset = padOffset;
	        this.isLE = isLE;
	        this.finished = false;
	        this.length = 0;
	        this.pos = 0;
	        this.destroyed = false;
	        this.buffer = new Uint8Array(blockLen);
	        this.view = (0, utils_js_1.createView)(this.buffer);
	    }
	    update(data) {
	        (0, _assert_js_1.aexists)(this);
	        const { view, buffer, blockLen } = this;
	        data = (0, utils_js_1.toBytes)(data);
	        const len = data.length;
	        for (let pos = 0; pos < len;) {
	            const take = Math.min(blockLen - this.pos, len - pos);
	            // Fast path: we have at least one block in input, cast it to view and process
	            if (take === blockLen) {
	                const dataView = (0, utils_js_1.createView)(data);
	                for (; blockLen <= len - pos; pos += blockLen)
	                    this.process(dataView, pos);
	                continue;
	            }
	            buffer.set(data.subarray(pos, pos + take), this.pos);
	            this.pos += take;
	            pos += take;
	            if (this.pos === blockLen) {
	                this.process(view, 0);
	                this.pos = 0;
	            }
	        }
	        this.length += data.length;
	        this.roundClean();
	        return this;
	    }
	    digestInto(out) {
	        (0, _assert_js_1.aexists)(this);
	        (0, _assert_js_1.aoutput)(out, this);
	        this.finished = true;
	        // Padding
	        // We can avoid allocation of buffer for padding completely if it
	        // was previously not allocated here. But it won't change performance.
	        const { buffer, view, blockLen, isLE } = this;
	        let { pos } = this;
	        // append the bit '1' to the message
	        buffer[pos++] = 0b10000000;
	        this.buffer.subarray(pos).fill(0);
	        // we have less than padOffset left in buffer, so we cannot put length in
	        // current block, need process it and pad again
	        if (this.padOffset > blockLen - pos) {
	            this.process(view, 0);
	            pos = 0;
	        }
	        // Pad until full block byte with zeros
	        for (let i = pos; i < blockLen; i++)
	            buffer[i] = 0;
	        // Note: sha512 requires length to be 128bit integer, but length in JS will overflow before that
	        // You need to write around 2 exabytes (u64_max / 8 / (1024**6)) for this to happen.
	        // So we just write lowest 64 bits of that value.
	        setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE);
	        this.process(view, 0);
	        const oview = (0, utils_js_1.createView)(out);
	        const len = this.outputLen;
	        // NOTE: we do division by 4 later, which should be fused in single op with modulo by JIT
	        if (len % 4)
	            throw new Error('_sha2: outputLen should be aligned to 32bit');
	        const outLen = len / 4;
	        const state = this.get();
	        if (outLen > state.length)
	            throw new Error('_sha2: outputLen bigger than state');
	        for (let i = 0; i < outLen; i++)
	            oview.setUint32(4 * i, state[i], isLE);
	    }
	    digest() {
	        const { buffer, outputLen } = this;
	        this.digestInto(buffer);
	        const res = buffer.slice(0, outputLen);
	        this.destroy();
	        return res;
	    }
	    _cloneInto(to) {
	        to || (to = new this.constructor());
	        to.set(...this.get());
	        const { blockLen, buffer, length, finished, destroyed, pos } = this;
	        to.length = length;
	        to.pos = pos;
	        to.finished = finished;
	        to.destroyed = destroyed;
	        if (length % blockLen)
	            to.buffer.set(buffer);
	        return to;
	    }
	}
	_md.HashMD = HashMD;
	
	return _md;
}

var hasRequiredSha256$1;

function requireSha256$1 () {
	if (hasRequiredSha256$1) return sha256$2;
	hasRequiredSha256$1 = 1;
	Object.defineProperty(sha256$2, "__esModule", { value: true });
	sha256$2.sha224 = sha256$2.sha256 = sha256$2.SHA256 = void 0;
	const _md_js_1 = /*@__PURE__*/ require_md();
	const utils_js_1 = /*@__PURE__*/ requireUtils();
	// SHA2-256 need to try 2^128 hashes to execute birthday attack.
	// BTC network is doing 2^70 hashes/sec (2^95 hashes/year) as per late 2024.
	// Round constants:
	// first 32 bits of the fractional parts of the cube roots of the first 64 primes 2..311)
	// prettier-ignore
	const SHA256_K = /* @__PURE__ */ new Uint32Array([
	    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
	]);
	// Initial state:
	// first 32 bits of the fractional parts of the square roots of the first 8 primes 2..19
	// prettier-ignore
	const SHA256_IV = /* @__PURE__ */ new Uint32Array([
	    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
	]);
	// Temporary buffer, not used to store anything between runs
	// Named this way because it matches specification.
	const SHA256_W = /* @__PURE__ */ new Uint32Array(64);
	class SHA256 extends _md_js_1.HashMD {
	    constructor() {
	        super(64, 32, 8, false);
	        // We cannot use array here since array allows indexing by variable
	        // which means optimizer/compiler cannot use registers.
	        this.A = SHA256_IV[0] | 0;
	        this.B = SHA256_IV[1] | 0;
	        this.C = SHA256_IV[2] | 0;
	        this.D = SHA256_IV[3] | 0;
	        this.E = SHA256_IV[4] | 0;
	        this.F = SHA256_IV[5] | 0;
	        this.G = SHA256_IV[6] | 0;
	        this.H = SHA256_IV[7] | 0;
	    }
	    get() {
	        const { A, B, C, D, E, F, G, H } = this;
	        return [A, B, C, D, E, F, G, H];
	    }
	    // prettier-ignore
	    set(A, B, C, D, E, F, G, H) {
	        this.A = A | 0;
	        this.B = B | 0;
	        this.C = C | 0;
	        this.D = D | 0;
	        this.E = E | 0;
	        this.F = F | 0;
	        this.G = G | 0;
	        this.H = H | 0;
	    }
	    process(view, offset) {
	        // Extend the first 16 words into the remaining 48 words w[16..63] of the message schedule array
	        for (let i = 0; i < 16; i++, offset += 4)
	            SHA256_W[i] = view.getUint32(offset, false);
	        for (let i = 16; i < 64; i++) {
	            const W15 = SHA256_W[i - 15];
	            const W2 = SHA256_W[i - 2];
	            const s0 = (0, utils_js_1.rotr)(W15, 7) ^ (0, utils_js_1.rotr)(W15, 18) ^ (W15 >>> 3);
	            const s1 = (0, utils_js_1.rotr)(W2, 17) ^ (0, utils_js_1.rotr)(W2, 19) ^ (W2 >>> 10);
	            SHA256_W[i] = (s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16]) | 0;
	        }
	        // Compression function main loop, 64 rounds
	        let { A, B, C, D, E, F, G, H } = this;
	        for (let i = 0; i < 64; i++) {
	            const sigma1 = (0, utils_js_1.rotr)(E, 6) ^ (0, utils_js_1.rotr)(E, 11) ^ (0, utils_js_1.rotr)(E, 25);
	            const T1 = (H + sigma1 + (0, _md_js_1.Chi)(E, F, G) + SHA256_K[i] + SHA256_W[i]) | 0;
	            const sigma0 = (0, utils_js_1.rotr)(A, 2) ^ (0, utils_js_1.rotr)(A, 13) ^ (0, utils_js_1.rotr)(A, 22);
	            const T2 = (sigma0 + (0, _md_js_1.Maj)(A, B, C)) | 0;
	            H = G;
	            G = F;
	            F = E;
	            E = (D + T1) | 0;
	            D = C;
	            C = B;
	            B = A;
	            A = (T1 + T2) | 0;
	        }
	        // Add the compressed chunk to the current hash value
	        A = (A + this.A) | 0;
	        B = (B + this.B) | 0;
	        C = (C + this.C) | 0;
	        D = (D + this.D) | 0;
	        E = (E + this.E) | 0;
	        F = (F + this.F) | 0;
	        G = (G + this.G) | 0;
	        H = (H + this.H) | 0;
	        this.set(A, B, C, D, E, F, G, H);
	    }
	    roundClean() {
	        SHA256_W.fill(0);
	    }
	    destroy() {
	        this.set(0, 0, 0, 0, 0, 0, 0, 0);
	        this.buffer.fill(0);
	    }
	}
	sha256$2.SHA256 = SHA256;
	// Constants from https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf
	class SHA224 extends SHA256 {
	    constructor() {
	        super();
	        this.A = 0xc1059ed8 | 0;
	        this.B = 0x367cd507 | 0;
	        this.C = 0x3070dd17 | 0;
	        this.D = 0xf70e5939 | 0;
	        this.E = 0xffc00b31 | 0;
	        this.F = 0x68581511 | 0;
	        this.G = 0x64f98fa7 | 0;
	        this.H = 0xbefa4fa4 | 0;
	        this.outputLen = 28;
	    }
	}
	/**
	 * SHA2-256 hash function
	 * @param message - data that would be hashed
	 */
	sha256$2.sha256 = (0, utils_js_1.wrapConstructor)(() => new SHA256());
	/**
	 * SHA2-224 hash function
	 */
	sha256$2.sha224 = (0, utils_js_1.wrapConstructor)(() => new SHA224());
	
	return sha256$2;
}

var src$1;
var hasRequiredSrc;

function requireSrc () {
	if (hasRequiredSrc) return src$1;
	hasRequiredSrc = 1;
	// base-x encoding / decoding
	// Copyright (c) 2018 base-x contributors
	// Copyright (c) 2014-2018 The Bitcoin Core developers (base58.cpp)
	// Distributed under the MIT software license, see the accompanying
	// file LICENSE or http://www.opensource.org/licenses/mit-license.php.
	function base (ALPHABET) {
	  if (ALPHABET.length >= 255) { throw new TypeError('Alphabet too long') }
	  var BASE_MAP = new Uint8Array(256);
	  for (var j = 0; j < BASE_MAP.length; j++) {
	    BASE_MAP[j] = 255;
	  }
	  for (var i = 0; i < ALPHABET.length; i++) {
	    var x = ALPHABET.charAt(i);
	    var xc = x.charCodeAt(0);
	    if (BASE_MAP[xc] !== 255) { throw new TypeError(x + ' is ambiguous') }
	    BASE_MAP[xc] = i;
	  }
	  var BASE = ALPHABET.length;
	  var LEADER = ALPHABET.charAt(0);
	  var FACTOR = Math.log(BASE) / Math.log(256); // log(BASE) / log(256), rounded up
	  var iFACTOR = Math.log(256) / Math.log(BASE); // log(256) / log(BASE), rounded up
	  function encode (source) {
	    if (source instanceof Uint8Array) ; else if (ArrayBuffer.isView(source)) {
	      source = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
	    } else if (Array.isArray(source)) {
	      source = Uint8Array.from(source);
	    }
	    if (!(source instanceof Uint8Array)) { throw new TypeError('Expected Uint8Array') }
	    if (source.length === 0) { return '' }
	        // Skip & count leading zeroes.
	    var zeroes = 0;
	    var length = 0;
	    var pbegin = 0;
	    var pend = source.length;
	    while (pbegin !== pend && source[pbegin] === 0) {
	      pbegin++;
	      zeroes++;
	    }
	        // Allocate enough space in big-endian base58 representation.
	    var size = ((pend - pbegin) * iFACTOR + 1) >>> 0;
	    var b58 = new Uint8Array(size);
	        // Process the bytes.
	    while (pbegin !== pend) {
	      var carry = source[pbegin];
	            // Apply "b58 = b58 * 256 + ch".
	      var i = 0;
	      for (var it1 = size - 1; (carry !== 0 || i < length) && (it1 !== -1); it1--, i++) {
	        carry += (256 * b58[it1]) >>> 0;
	        b58[it1] = (carry % BASE) >>> 0;
	        carry = (carry / BASE) >>> 0;
	      }
	      if (carry !== 0) { throw new Error('Non-zero carry') }
	      length = i;
	      pbegin++;
	    }
	        // Skip leading zeroes in base58 result.
	    var it2 = size - length;
	    while (it2 !== size && b58[it2] === 0) {
	      it2++;
	    }
	        // Translate the result into a string.
	    var str = LEADER.repeat(zeroes);
	    for (; it2 < size; ++it2) { str += ALPHABET.charAt(b58[it2]); }
	    return str
	  }
	  function decodeUnsafe (source) {
	    if (typeof source !== 'string') { throw new TypeError('Expected String') }
	    if (source.length === 0) { return new Uint8Array() }
	    var psz = 0;
	        // Skip and count leading '1's.
	    var zeroes = 0;
	    var length = 0;
	    while (source[psz] === LEADER) {
	      zeroes++;
	      psz++;
	    }
	        // Allocate enough space in big-endian base256 representation.
	    var size = (((source.length - psz) * FACTOR) + 1) >>> 0; // log(58) / log(256), rounded up.
	    var b256 = new Uint8Array(size);
	        // Process the characters.
	    while (source[psz]) {
	            // Decode character
	      var carry = BASE_MAP[source.charCodeAt(psz)];
	            // Invalid character
	      if (carry === 255) { return }
	      var i = 0;
	      for (var it3 = size - 1; (carry !== 0 || i < length) && (it3 !== -1); it3--, i++) {
	        carry += (BASE * b256[it3]) >>> 0;
	        b256[it3] = (carry % 256) >>> 0;
	        carry = (carry / 256) >>> 0;
	      }
	      if (carry !== 0) { throw new Error('Non-zero carry') }
	      length = i;
	      psz++;
	    }
	        // Skip leading zeroes in b256.
	    var it4 = size - length;
	    while (it4 !== size && b256[it4] === 0) {
	      it4++;
	    }
	    var vch = new Uint8Array(zeroes + (size - it4));
	    var j = zeroes;
	    while (it4 !== size) {
	      vch[j++] = b256[it4++];
	    }
	    return vch
	  }
	  function decode (string) {
	    var buffer = decodeUnsafe(string);
	    if (buffer) { return buffer }
	    throw new Error('Non-base' + BASE + ' character')
	  }
	  return {
	    encode: encode,
	    decodeUnsafe: decodeUnsafe,
	    decode: decode
	  }
	}
	src$1 = base;
	return src$1;
}

var bs58;
var hasRequiredBs58;

function requireBs58 () {
	if (hasRequiredBs58) return bs58;
	hasRequiredBs58 = 1;
	const basex = requireSrc();
	const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

	bs58 = basex(ALPHABET);
	return bs58;
}

var base;
var hasRequiredBase;

function requireBase () {
	if (hasRequiredBase) return base;
	hasRequiredBase = 1;

	var base58 = requireBs58();

	base = function (checksumFn) {
	  // Encode a buffer as a base58-check encoded string
	  function encode (payload) {
	    var payloadU8 = Uint8Array.from(payload);
	    var checksum = checksumFn(payloadU8);
	    var length = payloadU8.length + 4;
	    var both = new Uint8Array(length);
	    both.set(payloadU8, 0);
	    both.set(checksum.subarray(0, 4), payloadU8.length);
	    return base58.encode(both, length)
	  }

	  function decodeRaw (buffer) {
	    var payload = buffer.slice(0, -4);
	    var checksum = buffer.slice(-4);
	    var newChecksum = checksumFn(payload);

	    if (checksum[0] ^ newChecksum[0] |
	        checksum[1] ^ newChecksum[1] |
	        checksum[2] ^ newChecksum[2] |
	        checksum[3] ^ newChecksum[3]) return

	    return payload
	  }

	  // Decode a base58-check encoded string to a buffer, no result if checksum is wrong
	  function decodeUnsafe (string) {
	    var buffer = base58.decodeUnsafe(string);
	    if (!buffer) return

	    return decodeRaw(buffer)
	  }

	  function decode (string) {
	    var buffer = base58.decode(string);
	    var payload = decodeRaw(buffer);
	    if (!payload) throw new Error('Invalid checksum')
	    return payload
	  }

	  return {
	    encode: encode,
	    decode: decode,
	    decodeUnsafe: decodeUnsafe
	  }
	};
	return base;
}

var bs58check$1;
var hasRequiredBs58check;

function requireBs58check () {
	if (hasRequiredBs58check) return bs58check$1;
	hasRequiredBs58check = 1;

	var { sha256 } = /*@__PURE__*/ requireSha256$1();
	var bs58checkBase = requireBase();

	// SHA256(SHA256(buffer))
	function sha256x2 (buffer) {
	  return sha256(sha256(buffer))
	}

	bs58check$1 = bs58checkBase(sha256x2);
	return bs58check$1;
}

var bs58checkExports = requireBs58check();
const bs58check = /*@__PURE__*/getDefaultExportFromCjs(bs58checkExports);

const urlPrefix = "automerge:";
/** Given an Automerge URL, returns the DocumentId in both base58check-encoded form and binary form */
const parseAutomergeUrl = (url) => {
    const regex = new RegExp(`^${urlPrefix}(\\w+)$`);
    const [, docMatch] = url.match(regex) || [];
    const documentId = docMatch;
    const binaryDocumentId = documentIdToBinary(documentId);
    if (!binaryDocumentId)
        throw new Error("Invalid document URL: " + url);
    return {
        /** unencoded DocumentId */
        binaryDocumentId,
        /** encoded DocumentId */
        documentId,
    };
};
/**
 * Given a documentId in either binary or base58check-encoded form, returns an Automerge URL.
 * Throws on invalid input.
 */
const stringifyAutomergeUrl = (arg) => {
    const documentId = arg instanceof Uint8Array || typeof arg === "string"
        ? arg
        : "documentId" in arg
            ? arg.documentId
            : undefined;
    const encodedDocumentId = documentId instanceof Uint8Array
        ? binaryToDocumentId(documentId)
        : typeof documentId === "string"
            ? documentId
            : undefined;
    if (encodedDocumentId === undefined)
        throw new Error("Invalid documentId: " + documentId);
    return (urlPrefix + encodedDocumentId);
};
/**
 * Given a string, returns true if it is a valid Automerge URL. This function also acts as a type
 * discriminator in Typescript.
 */
const isValidAutomergeUrl = (str) => {
    if (!str || !str.startsWith(urlPrefix))
        return false;
    const automergeUrl = str;
    try {
        const { documentId } = parseAutomergeUrl(automergeUrl);
        return isValidDocumentId(documentId);
    }
    catch {
        return false;
    }
};
const isValidDocumentId = (str) => {
    // try to decode from base58
    const binaryDocumentID = documentIdToBinary(str);
    if (binaryDocumentID === undefined)
        return false; // invalid base58check encoding
    // confirm that the document ID is a valid UUID
    const documentId = stringify(binaryDocumentID);
    return validate(documentId);
};
const isValidUuid = (str) => validate(str);
/**
 * Returns a new Automerge URL with a random UUID documentId. Called by Repo.create(), and also used by tests.
 */
const generateAutomergeUrl = () => {
    const documentId = v4(null, new Uint8Array(16));
    return stringifyAutomergeUrl({ documentId });
};
const documentIdToBinary = (docId) => bs58check.decodeUnsafe(docId);
const binaryToDocumentId = (docId) => bs58check.encode(docId);
/**
 * Given any valid expression of a document ID, returns a DocumentId in base58check-encoded form.
 *
 * Currently supports:
 * - base58check-encoded DocumentId
 * - Automerge URL
 * - legacy UUID
 * - binary DocumentId
 *
 * Throws on invalid input.
 */
const interpretAsDocumentId = (id) => {
    // binary
    if (id instanceof Uint8Array)
        return binaryToDocumentId(id);
    // url
    if (isValidAutomergeUrl(id))
        return parseAutomergeUrl(id).documentId;
    // base58check
    if (isValidDocumentId(id))
        return id;
    // legacy UUID
    if (isValidUuid(id)) {
        console.warn("Future versions will not support UUIDs as document IDs; use Automerge URLs instead.");
        const binaryDocumentID = parse(id);
        return binaryToDocumentId(binaryDocumentID);
    }
    // none of the above
    throw new Error(`Invalid AutomergeUrl: '${id}'`);
};

let decoder;
try {
	decoder = new TextDecoder();
} catch(error) {}
let src;
let srcEnd;
let position$1 = 0;
const LEGACY_RECORD_INLINE_ID = 105;
const RECORD_DEFINITIONS_ID = 0xdffe;
const RECORD_INLINE_ID = 0xdfff; // temporary first-come first-serve tag // proposed tag: 0x7265 // 're'
const BUNDLED_STRINGS_ID = 0xdff9;
const PACKED_REFERENCE_TAG_ID = 6;
const STOP_CODE = {};
let maxArraySize = 112810000; // This is the maximum array size in V8. We would potentially detect and set it higher
// for JSC, but this is pretty large and should be sufficient for most use cases
let maxMapSize = 16810000; // JavaScript has a fixed maximum map size of about 16710000, but JS itself enforces this,
let currentDecoder = {};
let currentStructures;
let srcString;
let srcStringStart = 0;
let srcStringEnd = 0;
let bundledStrings$1;
let referenceMap;
let currentExtensions = [];
let currentExtensionRanges = [];
let packedValues;
let dataView;
let restoreMapsAsObject;
let defaultOptions = {
	useRecords: false,
	mapsAsObjects: true
};
let sequentialMode = false;
let inlineObjectReadThreshold = 2;
// no-eval build
try {
	new Function('');
} catch(error) {
	// if eval variants are not supported, do not create inline object readers ever
	inlineObjectReadThreshold = Infinity;
}



class Decoder {
	constructor(options) {
		if (options) {
			if ((options.keyMap || options._keyMap) && !options.useRecords) {
				options.useRecords = false;
				options.mapsAsObjects = true;
			}
			if (options.useRecords === false && options.mapsAsObjects === undefined)
				options.mapsAsObjects = true;
			if (options.getStructures)
				options.getShared = options.getStructures;
			if (options.getShared && !options.structures)
				(options.structures = []).uninitialized = true; // this is what we use to denote an uninitialized structures
			if (options.keyMap) {
				this.mapKey = new Map();
				for (let [k,v] of Object.entries(options.keyMap)) this.mapKey.set(v,k);
			}
		}
		Object.assign(this, options);
	}
	/*
	decodeKey(key) {
		return this.keyMap
			? Object.keys(this.keyMap)[Object.values(this.keyMap).indexOf(key)] || key
			: key
	}
	*/
	decodeKey(key) {
		return this.keyMap ? this.mapKey.get(key) || key : key
	}
	
	encodeKey(key) {
		return this.keyMap && this.keyMap.hasOwnProperty(key) ? this.keyMap[key] : key
	}

	encodeKeys(rec) {
		if (!this._keyMap) return rec
		let map = new Map();
		for (let [k,v] of Object.entries(rec)) map.set((this._keyMap.hasOwnProperty(k) ? this._keyMap[k] : k), v);
		return map
	}

	decodeKeys(map) {
		if (!this._keyMap || map.constructor.name != 'Map') return map
		if (!this._mapKey) {
			this._mapKey = new Map();
			for (let [k,v] of Object.entries(this._keyMap)) this._mapKey.set(v,k);
		}
		let res = {};
		//map.forEach((v,k) => res[Object.keys(this._keyMap)[Object.values(this._keyMap).indexOf(k)] || k] = v)
		map.forEach((v,k) => res[safeKey(this._mapKey.has(k) ? this._mapKey.get(k) : k)] =  v);
		return res
	}
	
	mapDecode(source, end) {
	
		let res = this.decode(source);
		if (this._keyMap) { 
			//Experiemntal support for Optimised KeyMap  decoding 
			switch (res.constructor.name) {
				case 'Array': return res.map(r => this.decodeKeys(r))
				//case 'Map': return this.decodeKeys(res)
			}
		}
		return res
	}

	decode(source, end) {
		if (src) {
			// re-entrant execution, save the state and restore it after we do this decode
			return saveState(() => {
				clearSource();
				return this ? this.decode(source, end) : Decoder.prototype.decode.call(defaultOptions, source, end)
			})
		}
		srcEnd = end > -1 ? end : source.length;
		position$1 = 0;
		srcStringEnd = 0;
		srcString = null;
		bundledStrings$1 = null;
		src = source;
		// this provides cached access to the data view for a buffer if it is getting reused, which is a recommend
		// technique for getting data from a database where it can be copied into an existing buffer instead of creating
		// new ones
		try {
			dataView = source.dataView || (source.dataView = new DataView(source.buffer, source.byteOffset, source.byteLength));
		} catch(error) {
			// if it doesn't have a buffer, maybe it is the wrong type of object
			src = null;
			if (source instanceof Uint8Array)
				throw error
			throw new Error('Source must be a Uint8Array or Buffer but was a ' + ((source && typeof source == 'object') ? source.constructor.name : typeof source))
		}
		if (this instanceof Decoder) {
			currentDecoder = this;
			packedValues = this.sharedValues &&
				(this.pack ? new Array(this.maxPrivatePackedValues || 16).concat(this.sharedValues) :
				this.sharedValues);
			if (this.structures) {
				currentStructures = this.structures;
				return checkedRead()
			} else if (!currentStructures || currentStructures.length > 0) {
				currentStructures = [];
			}
		} else {
			currentDecoder = defaultOptions;
			if (!currentStructures || currentStructures.length > 0)
				currentStructures = [];
			packedValues = null;
		}
		return checkedRead()
	}
	decodeMultiple(source, forEach) {
		let values, lastPosition = 0;
		try {
			let size = source.length;
			sequentialMode = true;
			let value = this ? this.decode(source, size) : defaultDecoder.decode(source, size);
			if (forEach) {
				if (forEach(value) === false) {
					return
				}
				while(position$1 < size) {
					lastPosition = position$1;
					if (forEach(checkedRead()) === false) {
						return
					}
				}
			}
			else {
				values = [ value ];
				while(position$1 < size) {
					lastPosition = position$1;
					values.push(checkedRead());
				}
				return values
			}
		} catch(error) {
			error.lastPosition = lastPosition;
			error.values = values;
			throw error
		} finally {
			sequentialMode = false;
			clearSource();
		}
	}
}
function checkedRead() {
	try {
		let result = read();
		if (bundledStrings$1) {
			if (position$1 >= bundledStrings$1.postBundlePosition) {
				let error = new Error('Unexpected bundle position');
				error.incomplete = true;
				throw error
			}
			// bundled strings to skip past
			position$1 = bundledStrings$1.postBundlePosition;
			bundledStrings$1 = null;
		}

		if (position$1 == srcEnd) {
			// finished reading this source, cleanup references
			currentStructures = null;
			src = null;
			if (referenceMap)
				referenceMap = null;
		} else if (position$1 > srcEnd) {
			// over read
			let error = new Error('Unexpected end of CBOR data');
			error.incomplete = true;
			throw error
		} else if (!sequentialMode) {
			throw new Error('Data read, but end of buffer not reached')
		}
		// else more to read, but we are reading sequentially, so don't clear source yet
		return result
	} catch(error) {
		clearSource();
		if (error instanceof RangeError || error.message.startsWith('Unexpected end of buffer')) {
			error.incomplete = true;
		}
		throw error
	}
}

function read() {
	let token = src[position$1++];
	let majorType = token >> 5;
	token = token & 0x1f;
	if (token > 0x17) {
		switch (token) {
			case 0x18:
				token = src[position$1++];
				break
			case 0x19:
				if (majorType == 7) {
					return getFloat16()
				}
				token = dataView.getUint16(position$1);
				position$1 += 2;
				break
			case 0x1a:
				if (majorType == 7) {
					let value = dataView.getFloat32(position$1);
					if (currentDecoder.useFloat32 > 2) {
						// this does rounding of numbers that were encoded in 32-bit float to nearest significant decimal digit that could be preserved
						let multiplier = mult10[((src[position$1] & 0x7f) << 1) | (src[position$1 + 1] >> 7)];
						position$1 += 4;
						return ((multiplier * value + (value > 0 ? 0.5 : -0.5)) >> 0) / multiplier
					}
					position$1 += 4;
					return value
				}
				token = dataView.getUint32(position$1);
				position$1 += 4;
				break
			case 0x1b:
				if (majorType == 7) {
					let value = dataView.getFloat64(position$1);
					position$1 += 8;
					return value
				}
				if (majorType > 1) {
					if (dataView.getUint32(position$1) > 0)
						throw new Error('JavaScript does not support arrays, maps, or strings with length over 4294967295')
					token = dataView.getUint32(position$1 + 4);
				} else if (currentDecoder.int64AsNumber) {
					token = dataView.getUint32(position$1) * 0x100000000;
					token += dataView.getUint32(position$1 + 4);
				} else
					token = dataView.getBigUint64(position$1);
				position$1 += 8;
				break
			case 0x1f: 
				// indefinite length
				switch(majorType) {
					case 2: // byte string
					case 3: // text string
						throw new Error('Indefinite length not supported for byte or text strings')
					case 4: // array
						let array = [];
						let value, i = 0;
						while ((value = read()) != STOP_CODE) {
							if (i >= maxArraySize) throw new Error(`Array length exceeds ${maxArraySize}`)
							array[i++] = value;
						}
						return majorType == 4 ? array : majorType == 3 ? array.join('') : Buffer.concat(array)
					case 5: // map
						let key;
						if (currentDecoder.mapsAsObjects) {
							let object = {};
							let i = 0;
							if (currentDecoder.keyMap) {
								while((key = read()) != STOP_CODE) {
									if (i++ >= maxMapSize) throw new Error(`Property count exceeds ${maxMapSize}`)
									object[safeKey(currentDecoder.decodeKey(key))] = read();
								}
							}
							else {
								while ((key = read()) != STOP_CODE) {
									if (i++ >= maxMapSize) throw new Error(`Property count exceeds ${maxMapSize}`)
									object[safeKey(key)] = read();
								}
							}
							return object
						} else {
							if (restoreMapsAsObject) {
								currentDecoder.mapsAsObjects = true;
								restoreMapsAsObject = false;
							}
							let map = new Map();
							if (currentDecoder.keyMap) {
								let i = 0;
								while((key = read()) != STOP_CODE) {
									if (i++ >= maxMapSize) {
										throw new Error(`Map size exceeds ${maxMapSize}`);
									}
									map.set(currentDecoder.decodeKey(key), read());
								}
							}
							else {
								let i = 0;
								while ((key = read()) != STOP_CODE) {
									if (i++ >= maxMapSize) {
										throw new Error(`Map size exceeds ${maxMapSize}`);
									}
									map.set(key, read());
								}
							}
							return map
						}
					case 7:
						return STOP_CODE
					default:
						throw new Error('Invalid major type for indefinite length ' + majorType)
				}
			default:
				throw new Error('Unknown token ' + token)
		}
	}
	switch (majorType) {
		case 0: // positive int
			return token
		case 1: // negative int
			return ~token
		case 2: // buffer
			return readBin(token)
		case 3: // string
			if (srcStringEnd >= position$1) {
				return srcString.slice(position$1 - srcStringStart, (position$1 += token) - srcStringStart)
			}
			if (srcStringEnd == 0 && srcEnd < 140 && token < 32) {
				// for small blocks, avoiding the overhead of the extract call is helpful
				let string = token < 16 ? shortStringInJS(token) : longStringInJS(token);
				if (string != null)
					return string
			}
			return readFixedString(token)
		case 4: // array
			if (token >= maxArraySize) throw new Error(`Array length exceeds ${maxArraySize}`)
			let array = new Array(token);
		  //if (currentDecoder.keyMap) for (let i = 0; i < token; i++) array[i] = currentDecoder.decodeKey(read())	
			//else 
			for (let i = 0; i < token; i++) array[i] = read();
			return array
		case 5: // map
			if (token >= maxMapSize) throw new Error(`Map size exceeds ${maxArraySize}`)
			if (currentDecoder.mapsAsObjects) {
				let object = {};
				if (currentDecoder.keyMap) for (let i = 0; i < token; i++) object[safeKey(currentDecoder.decodeKey(read()))] = read();
				else for (let i = 0; i < token; i++) object[safeKey(read())] = read();
				return object
			} else {
				if (restoreMapsAsObject) {
					currentDecoder.mapsAsObjects = true;
					restoreMapsAsObject = false;
				}
				let map = new Map();
				if (currentDecoder.keyMap) for (let i = 0; i < token; i++) map.set(currentDecoder.decodeKey(read()),read());
				else for (let i = 0; i < token; i++) map.set(read(), read());
				return map
			}
		case 6: // extension
			if (token >= BUNDLED_STRINGS_ID) {
				let structure = currentStructures[token & 0x1fff]; // check record structures first
				// At some point we may provide an option for dynamic tag assignment with a range like token >= 8 && (token < 16 || (token > 0x80 && token < 0xc0) || (token > 0x130 && token < 0x4000))
				if (structure) {
					if (!structure.read) structure.read = createStructureReader(structure);
					return structure.read()
				}
				if (token < 0x10000) {
					if (token == RECORD_INLINE_ID) { // we do a special check for this so that we can keep the
						// currentExtensions as densely stored array (v8 stores arrays densely under about 3000 elements)
						let length = readJustLength();
						let id = read();
						let structure = read();
						recordDefinition(id, structure);
						let object = {};
						if (currentDecoder.keyMap) for (let i = 2; i < length; i++) {
							let key = currentDecoder.decodeKey(structure[i - 2]);
							object[safeKey(key)] = read();
						}
						else for (let i = 2; i < length; i++) {
							let key = structure[i - 2];
							object[safeKey(key)] = read();
						}
						return object
					}
					else if (token == RECORD_DEFINITIONS_ID) {
						let length = readJustLength();
						let id = read();
						for (let i = 2; i < length; i++) {
							recordDefinition(id++, read());
						}
						return read()
					} else if (token == BUNDLED_STRINGS_ID) {
						return readBundleExt()
					}
					if (currentDecoder.getShared) {
						loadShared();
						structure = currentStructures[token & 0x1fff];
						if (structure) {
							if (!structure.read)
								structure.read = createStructureReader(structure);
							return structure.read()
						}
					}
				}
			}
			let extension = currentExtensions[token];
			if (extension) {
				if (extension.handlesRead)
					return extension(read)
				else
					return extension(read())
			} else {
				let input = read();
				for (let i = 0; i < currentExtensionRanges.length; i++) {
					let value = currentExtensionRanges[i](token, input);
					if (value !== undefined)
						return value
				}
				return new Tag(input, token)
			}
		case 7: // fixed value
			switch (token) {
				case 0x14: return false
				case 0x15: return true
				case 0x16: return null
				case 0x17: return; // undefined
				case 0x1f:
				default:
					let packedValue = (packedValues || getPackedValues())[token];
					if (packedValue !== undefined)
						return packedValue
					throw new Error('Unknown token ' + token)
			}
		default: // negative int
			if (isNaN(token)) {
				let error = new Error('Unexpected end of CBOR data');
				error.incomplete = true;
				throw error
			}
			throw new Error('Unknown CBOR token ' + token)
	}
}
const validName = /^[a-zA-Z_$][a-zA-Z\d_$]*$/;
function createStructureReader(structure) {
	if (!structure) throw new Error('Structure is required in record definition');
	function readObject() {
		// get the array size from the header
		let length = src[position$1++];
		//let majorType = token >> 5
		length = length & 0x1f;
		if (length > 0x17) {
			switch (length) {
				case 0x18:
					length = src[position$1++];
					break
				case 0x19:
					length = dataView.getUint16(position$1);
					position$1 += 2;
					break
				case 0x1a:
					length = dataView.getUint32(position$1);
					position$1 += 4;
					break
				default:
					throw new Error('Expected array header, but got ' + src[position$1 - 1])
			}
		}
		// This initial function is quick to instantiate, but runs slower. After several iterations pay the cost to build the faster function
		let compiledReader = this.compiledReader; // first look to see if we have the fast compiled function
		while(compiledReader) {
			// we have a fast compiled object literal reader
			if (compiledReader.propertyCount === length)
				return compiledReader(read) // with the right length, so we use it
			compiledReader = compiledReader.next; // see if there is another reader with the right length
		}
		if (this.slowReads++ >= inlineObjectReadThreshold) { // create a fast compiled reader
			let array = this.length == length ? this : this.slice(0, length);
			compiledReader = currentDecoder.keyMap 
			? new Function('r', 'return {' + array.map(k => currentDecoder.decodeKey(k)).map(k => validName.test(k) ? safeKey(k) + ':r()' : ('[' + JSON.stringify(k) + ']:r()')).join(',') + '}')
			: new Function('r', 'return {' + array.map(key => validName.test(key) ? safeKey(key) + ':r()' : ('[' + JSON.stringify(key) + ']:r()')).join(',') + '}');
			if (this.compiledReader)
				compiledReader.next = this.compiledReader; // if there is an existing one, we store multiple readers as a linked list because it is usually pretty rare to have multiple readers (of different length) for the same structure
			compiledReader.propertyCount = length;
			this.compiledReader = compiledReader;
			return compiledReader(read)
		}
		let object = {};
		if (currentDecoder.keyMap) for (let i = 0; i < length; i++) object[safeKey(currentDecoder.decodeKey(this[i]))] = read();
		else for (let i = 0; i < length; i++) {
			object[safeKey(this[i])] = read();
		}
		return object
	}
	structure.slowReads = 0;
	return readObject
}

function safeKey(key) {
	// protect against prototype pollution
	if (typeof key === 'string') return key === '__proto__' ? '__proto_' : key
	if (typeof key === 'number' || typeof key === 'boolean' || typeof key === 'bigint') return key.toString();
	if (key == null) return key + '';
	// protect against expensive (DoS) string conversions
	throw new Error('Invalid property name type ' + typeof key);
}

let readFixedString = readStringJS;
function readStringJS(length) {
	let result;
	if (length < 16) {
		if (result = shortStringInJS(length))
			return result
	}
	if (length > 64 && decoder)
		return decoder.decode(src.subarray(position$1, position$1 += length))
	const end = position$1 + length;
	const units = [];
	result = '';
	while (position$1 < end) {
		const byte1 = src[position$1++];
		if ((byte1 & 0x80) === 0) {
			// 1 byte
			units.push(byte1);
		} else if ((byte1 & 0xe0) === 0xc0) {
			// 2 bytes
			const byte2 = src[position$1++] & 0x3f;
			units.push(((byte1 & 0x1f) << 6) | byte2);
		} else if ((byte1 & 0xf0) === 0xe0) {
			// 3 bytes
			const byte2 = src[position$1++] & 0x3f;
			const byte3 = src[position$1++] & 0x3f;
			units.push(((byte1 & 0x1f) << 12) | (byte2 << 6) | byte3);
		} else if ((byte1 & 0xf8) === 0xf0) {
			// 4 bytes
			const byte2 = src[position$1++] & 0x3f;
			const byte3 = src[position$1++] & 0x3f;
			const byte4 = src[position$1++] & 0x3f;
			let unit = ((byte1 & 0x07) << 0x12) | (byte2 << 0x0c) | (byte3 << 0x06) | byte4;
			if (unit > 0xffff) {
				unit -= 0x10000;
				units.push(((unit >>> 10) & 0x3ff) | 0xd800);
				unit = 0xdc00 | (unit & 0x3ff);
			}
			units.push(unit);
		} else {
			units.push(byte1);
		}

		if (units.length >= 0x1000) {
			result += fromCharCode.apply(String, units);
			units.length = 0;
		}
	}

	if (units.length > 0) {
		result += fromCharCode.apply(String, units);
	}

	return result
}
let fromCharCode = String.fromCharCode;
function longStringInJS(length) {
	let start = position$1;
	let bytes = new Array(length);
	for (let i = 0; i < length; i++) {
		const byte = src[position$1++];
		if ((byte & 0x80) > 0) {
			position$1 = start;
    			return
    		}
    		bytes[i] = byte;
    	}
    	return fromCharCode.apply(String, bytes)
}
function shortStringInJS(length) {
	if (length < 4) {
		if (length < 2) {
			if (length === 0)
				return ''
			else {
				let a = src[position$1++];
				if ((a & 0x80) > 1) {
					position$1 -= 1;
					return
				}
				return fromCharCode(a)
			}
		} else {
			let a = src[position$1++];
			let b = src[position$1++];
			if ((a & 0x80) > 0 || (b & 0x80) > 0) {
				position$1 -= 2;
				return
			}
			if (length < 3)
				return fromCharCode(a, b)
			let c = src[position$1++];
			if ((c & 0x80) > 0) {
				position$1 -= 3;
				return
			}
			return fromCharCode(a, b, c)
		}
	} else {
		let a = src[position$1++];
		let b = src[position$1++];
		let c = src[position$1++];
		let d = src[position$1++];
		if ((a & 0x80) > 0 || (b & 0x80) > 0 || (c & 0x80) > 0 || (d & 0x80) > 0) {
			position$1 -= 4;
			return
		}
		if (length < 6) {
			if (length === 4)
				return fromCharCode(a, b, c, d)
			else {
				let e = src[position$1++];
				if ((e & 0x80) > 0) {
					position$1 -= 5;
					return
				}
				return fromCharCode(a, b, c, d, e)
			}
		} else if (length < 8) {
			let e = src[position$1++];
			let f = src[position$1++];
			if ((e & 0x80) > 0 || (f & 0x80) > 0) {
				position$1 -= 6;
				return
			}
			if (length < 7)
				return fromCharCode(a, b, c, d, e, f)
			let g = src[position$1++];
			if ((g & 0x80) > 0) {
				position$1 -= 7;
				return
			}
			return fromCharCode(a, b, c, d, e, f, g)
		} else {
			let e = src[position$1++];
			let f = src[position$1++];
			let g = src[position$1++];
			let h = src[position$1++];
			if ((e & 0x80) > 0 || (f & 0x80) > 0 || (g & 0x80) > 0 || (h & 0x80) > 0) {
				position$1 -= 8;
				return
			}
			if (length < 10) {
				if (length === 8)
					return fromCharCode(a, b, c, d, e, f, g, h)
				else {
					let i = src[position$1++];
					if ((i & 0x80) > 0) {
						position$1 -= 9;
						return
					}
					return fromCharCode(a, b, c, d, e, f, g, h, i)
				}
			} else if (length < 12) {
				let i = src[position$1++];
				let j = src[position$1++];
				if ((i & 0x80) > 0 || (j & 0x80) > 0) {
					position$1 -= 10;
					return
				}
				if (length < 11)
					return fromCharCode(a, b, c, d, e, f, g, h, i, j)
				let k = src[position$1++];
				if ((k & 0x80) > 0) {
					position$1 -= 11;
					return
				}
				return fromCharCode(a, b, c, d, e, f, g, h, i, j, k)
			} else {
				let i = src[position$1++];
				let j = src[position$1++];
				let k = src[position$1++];
				let l = src[position$1++];
				if ((i & 0x80) > 0 || (j & 0x80) > 0 || (k & 0x80) > 0 || (l & 0x80) > 0) {
					position$1 -= 12;
					return
				}
				if (length < 14) {
					if (length === 12)
						return fromCharCode(a, b, c, d, e, f, g, h, i, j, k, l)
					else {
						let m = src[position$1++];
						if ((m & 0x80) > 0) {
							position$1 -= 13;
							return
						}
						return fromCharCode(a, b, c, d, e, f, g, h, i, j, k, l, m)
					}
				} else {
					let m = src[position$1++];
					let n = src[position$1++];
					if ((m & 0x80) > 0 || (n & 0x80) > 0) {
						position$1 -= 14;
						return
					}
					if (length < 15)
						return fromCharCode(a, b, c, d, e, f, g, h, i, j, k, l, m, n)
					let o = src[position$1++];
					if ((o & 0x80) > 0) {
						position$1 -= 15;
						return
					}
					return fromCharCode(a, b, c, d, e, f, g, h, i, j, k, l, m, n, o)
				}
			}
		}
	}
}

function readBin(length) {
	return currentDecoder.copyBuffers ?
		// specifically use the copying slice (not the node one)
		Uint8Array.prototype.slice.call(src, position$1, position$1 += length) :
		src.subarray(position$1, position$1 += length)
}
let f32Array = new Float32Array(1);
let u8Array = new Uint8Array(f32Array.buffer, 0, 4);
function getFloat16() {
	let byte0 = src[position$1++];
	let byte1 = src[position$1++];
	let exponent = (byte0 & 0x7f) >> 2;
	if (exponent === 0x1f) { // specials
		if (byte1 || (byte0 & 3))
			return NaN;
		return (byte0 & 0x80) ? -Infinity : Infinity;
	}
	if (exponent === 0) { // sub-normals
		// significand with 10 fractional bits and divided by 2^14
		let abs = (((byte0 & 3) << 8) | byte1) / (1 << 24);
		return (byte0 & 0x80) ? -abs : abs
	}

	u8Array[3] = (byte0 & 0x80) | // sign bit
		((exponent >> 1) + 56); // 4 of 5 of the exponent bits, re-offset-ed
	u8Array[2] = ((byte0 & 7) << 5) | // last exponent bit and first two mantissa bits
		(byte1 >> 3); // next 5 bits of mantissa
	u8Array[1] = byte1 << 5; // last three bits of mantissa
	u8Array[0] = 0;
	return f32Array[0];
}

new Array(4096);

class Tag {
	constructor(value, tag) {
		this.value = value;
		this.tag = tag;
	}
}

currentExtensions[0] = (dateString) => {
	// string date extension
	return new Date(dateString)
};

currentExtensions[1] = (epochSec) => {
	// numeric date extension
	return new Date(Math.round(epochSec * 1000))
};

currentExtensions[2] = (buffer) => {
	// bigint extension
	let value = BigInt(0);
	for (let i = 0, l = buffer.byteLength; i < l; i++) {
		value = BigInt(buffer[i]) + (value << BigInt(8));
	}
	return value
};

currentExtensions[3] = (buffer) => {
	// negative bigint extension
	return BigInt(-1) - currentExtensions[2](buffer)
};
currentExtensions[4] = (fraction) => {
	// best to reparse to maintain accuracy
	return +(fraction[1] + 'e' + fraction[0])
};

currentExtensions[5] = (fraction) => {
	// probably not sufficiently accurate
	return fraction[1] * Math.exp(fraction[0] * Math.log(2))
};

// the registration of the record definition extension
const recordDefinition = (id, structure) => {
	id = id - 0xe000;
	let existingStructure = currentStructures[id];
	if (existingStructure && existingStructure.isShared) {
		(currentStructures.restoreStructures || (currentStructures.restoreStructures = []))[id] = existingStructure;
	}
	currentStructures[id] = structure;

	structure.read = createStructureReader(structure);
};
currentExtensions[LEGACY_RECORD_INLINE_ID] = (data) => {
	let length = data.length;
	let structure = data[1];
	recordDefinition(data[0], structure);
	let object = {};
	for (let i = 2; i < length; i++) {
		let key = structure[i - 2];
		object[safeKey(key)] = data[i];
	}
	return object
};
currentExtensions[14] = (value) => {
	if (bundledStrings$1)
		return bundledStrings$1[0].slice(bundledStrings$1.position0, bundledStrings$1.position0 += value)
	return new Tag(value, 14)
};
currentExtensions[15] = (value) => {
	if (bundledStrings$1)
		return bundledStrings$1[1].slice(bundledStrings$1.position1, bundledStrings$1.position1 += value)
	return new Tag(value, 15)
};
let glbl = { Error, RegExp };
currentExtensions[27] = (data) => { // http://cbor.schmorp.de/generic-object
	return (glbl[data[0]] || Error)(data[1], data[2])
};
const packedTable = (read) => {
	if (src[position$1++] != 0x84) {
		let error = new Error('Packed values structure must be followed by a 4 element array');
		if (src.length < position$1)
			error.incomplete = true;
		throw error
	}
	let newPackedValues = read(); // packed values
	if (!newPackedValues || !newPackedValues.length) {
		let error = new Error('Packed values structure must be followed by a 4 element array');
		error.incomplete = true;
		throw error
	}
	packedValues = packedValues ? newPackedValues.concat(packedValues.slice(newPackedValues.length)) : newPackedValues;
	packedValues.prefixes = read();
	packedValues.suffixes = read();
	return read() // read the rump
};
packedTable.handlesRead = true;
currentExtensions[51] = packedTable;

currentExtensions[PACKED_REFERENCE_TAG_ID] = (data) => { // packed reference
	if (!packedValues) {
		if (currentDecoder.getShared)
			loadShared();
		else
			return new Tag(data, PACKED_REFERENCE_TAG_ID)
	}
	if (typeof data == 'number')
		return packedValues[16 + (data >= 0 ? 2 * data : (-2 * data - 1))]
	let error = new Error('No support for non-integer packed references yet');
	if (data === undefined)
		error.incomplete = true;
	throw error
};

// The following code is an incomplete implementation of http://cbor.schmorp.de/stringref
// the real thing would need to implemennt more logic to populate the stringRefs table and
// maintain a stack of stringRef "namespaces".
//
// currentExtensions[25] = (id) => {
// 	return stringRefs[id]
// }
// currentExtensions[256] = (read) => {
// 	stringRefs = []
// 	try {
// 		return read()
// 	} finally {
// 		stringRefs = null
// 	}
// }
// currentExtensions[256].handlesRead = true

currentExtensions[28] = (read) => { 
	// shareable http://cbor.schmorp.de/value-sharing (for structured clones)
	if (!referenceMap) {
		referenceMap = new Map();
		referenceMap.id = 0;
	}
	let id = referenceMap.id++;
	let startingPosition = position$1;
	let token = src[position$1];
	let target;
	// TODO: handle Maps, Sets, and other types that can cycle; this is complicated, because you potentially need to read
	// ahead past references to record structure definitions
	if ((token >> 5) == 4)
		target = [];
	else
		target = {};

	let refEntry = { target }; // a placeholder object
	referenceMap.set(id, refEntry);
	let targetProperties = read(); // read the next value as the target object to id
	if (refEntry.used) {// there is a cycle, so we have to assign properties to original target
		if (Object.getPrototypeOf(target) !== Object.getPrototypeOf(targetProperties)) {
			// this means that the returned target does not match the targetProperties, so we need rerun the read to
			// have the correctly create instance be assigned as a reference, then we do the copy the properties back to the
			// target
			// reset the position so that the read can be repeated
			position$1 = startingPosition;
			// the returned instance is our new target for references
			target = targetProperties;
			referenceMap.set(id, { target });
			targetProperties = read();
		}
		return Object.assign(target, targetProperties)
	}
	refEntry.target = targetProperties; // the placeholder wasn't used, replace with the deserialized one
	return targetProperties // no cycle, can just use the returned read object
};
currentExtensions[28].handlesRead = true;

currentExtensions[29] = (id) => {
	// sharedref http://cbor.schmorp.de/value-sharing (for structured clones)
	let refEntry = referenceMap.get(id);
	refEntry.used = true;
	return refEntry.target
};

currentExtensions[258] = (array) => new Set(array); // https://github.com/input-output-hk/cbor-sets-spec/blob/master/CBOR_SETS.md
(currentExtensions[259] = (read) => {
	// https://github.com/shanewholloway/js-cbor-codec/blob/master/docs/CBOR-259-spec
	// for decoding as a standard Map
	if (currentDecoder.mapsAsObjects) {
		currentDecoder.mapsAsObjects = false;
		restoreMapsAsObject = true;
	}
	return read()
}).handlesRead = true;
function combine(a, b) {
	if (typeof a === 'string')
		return a + b
	if (a instanceof Array)
		return a.concat(b)
	return Object.assign({}, a, b)
}
function getPackedValues() {
	if (!packedValues) {
		if (currentDecoder.getShared)
			loadShared();
		else
			throw new Error('No packed values available')
	}
	return packedValues
}
const SHARED_DATA_TAG_ID = 0x53687264; // ascii 'Shrd'
currentExtensionRanges.push((tag, input) => {
	if (tag >= 225 && tag <= 255)
		return combine(getPackedValues().prefixes[tag - 224], input)
	if (tag >= 28704 && tag <= 32767)
		return combine(getPackedValues().prefixes[tag - 28672], input)
	if (tag >= 1879052288 && tag <= 2147483647)
		return combine(getPackedValues().prefixes[tag - 1879048192], input)
	if (tag >= 216 && tag <= 223)
		return combine(input, getPackedValues().suffixes[tag - 216])
	if (tag >= 27647 && tag <= 28671)
		return combine(input, getPackedValues().suffixes[tag - 27639])
	if (tag >= 1811940352 && tag <= 1879048191)
		return combine(input, getPackedValues().suffixes[tag - 1811939328])
	if (tag == SHARED_DATA_TAG_ID) {// we do a special check for this so that we can keep the currentExtensions as densely stored array (v8 stores arrays densely under about 3000 elements)
		return {
			packedValues: packedValues,
			structures: currentStructures.slice(0),
			version: input,
		}
	}
	if (tag == 55799) // self-descriptive CBOR tag, just return input value
		return input
});

const isLittleEndianMachine$1 = new Uint8Array(new Uint16Array([1]).buffer)[0] == 1;
const typedArrays = [Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array,
	typeof BigUint64Array == 'undefined' ? { name:'BigUint64Array' } : BigUint64Array, Int8Array, Int16Array, Int32Array,
	typeof BigInt64Array == 'undefined' ? { name:'BigInt64Array' } : BigInt64Array, Float32Array, Float64Array];
const typedArrayTags = [64, 68, 69, 70, 71, 72, 77, 78, 79, 85, 86];
for (let i = 0; i < typedArrays.length; i++) {
	registerTypedArray(typedArrays[i], typedArrayTags[i]);
}
function registerTypedArray(TypedArray, tag) {
	let dvMethod = 'get' + TypedArray.name.slice(0, -5);
	let bytesPerElement;
	if (typeof TypedArray === 'function')
		bytesPerElement = TypedArray.BYTES_PER_ELEMENT;
	else
		TypedArray = null;
	for (let littleEndian = 0; littleEndian < 2; littleEndian++) {
		if (!littleEndian && bytesPerElement == 1)
			continue
		let sizeShift = bytesPerElement == 2 ? 1 : bytesPerElement == 4 ? 2 : bytesPerElement == 8 ? 3 : 0;
		currentExtensions[littleEndian ? tag : (tag - 4)] = (bytesPerElement == 1 || littleEndian == isLittleEndianMachine$1) ? (buffer) => {
			if (!TypedArray)
				throw new Error('Could not find typed array for code ' + tag)
			if (!currentDecoder.copyBuffers) {
				// try provide a direct view, but will only work if we are byte-aligned
				if (bytesPerElement === 1 ||
					bytesPerElement === 2 && !(buffer.byteOffset & 1) ||
					bytesPerElement === 4 && !(buffer.byteOffset & 3) ||
					bytesPerElement === 8 && !(buffer.byteOffset & 7))
					return new TypedArray(buffer.buffer, buffer.byteOffset, buffer.byteLength >> sizeShift);
			}
			// we have to slice/copy here to get a new ArrayBuffer, if we are not word/byte aligned
			return new TypedArray(Uint8Array.prototype.slice.call(buffer, 0).buffer)
		} : buffer => {
			if (!TypedArray)
				throw new Error('Could not find typed array for code ' + tag)
			let dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
			let elements = buffer.length >> sizeShift;
			let ta = new TypedArray(elements);
			let method = dv[dvMethod];
			for (let i = 0; i < elements; i++) {
				ta[i] = method.call(dv, i << sizeShift, littleEndian);
			}
			return ta
		};
	}
}

function readBundleExt() {
	let length = readJustLength();
	let bundlePosition = position$1 + read();
	for (let i = 2; i < length; i++) {
		// skip past bundles that were already read
		let bundleLength = readJustLength(); // this will increment position, so must add to position afterwards
		position$1 += bundleLength;
	}
	let dataPosition = position$1;
	position$1 = bundlePosition;
	bundledStrings$1 = [readStringJS(readJustLength()), readStringJS(readJustLength())];
	bundledStrings$1.position0 = 0;
	bundledStrings$1.position1 = 0;
	bundledStrings$1.postBundlePosition = position$1;
	position$1 = dataPosition;
	return read()
}

function readJustLength() {
	let token = src[position$1++] & 0x1f;
	if (token > 0x17) {
		switch (token) {
			case 0x18:
				token = src[position$1++];
				break
			case 0x19:
				token = dataView.getUint16(position$1);
				position$1 += 2;
				break
			case 0x1a:
				token = dataView.getUint32(position$1);
				position$1 += 4;
				break
		}
	}
	return token
}

function loadShared() {
	if (currentDecoder.getShared) {
		let sharedData = saveState(() => {
			// save the state in case getShared modifies our buffer
			src = null;
			return currentDecoder.getShared()
		}) || {};
		let updatedStructures = sharedData.structures || [];
		currentDecoder.sharedVersion = sharedData.version;
		packedValues = currentDecoder.sharedValues = sharedData.packedValues;
		if (currentStructures === true)
			currentDecoder.structures = currentStructures = updatedStructures;
		else
			currentStructures.splice.apply(currentStructures, [0, updatedStructures.length].concat(updatedStructures));
	}
}

function saveState(callback) {
	let savedSrcEnd = srcEnd;
	let savedPosition = position$1;
	let savedSrcStringStart = srcStringStart;
	let savedSrcStringEnd = srcStringEnd;
	let savedSrcString = srcString;
	let savedReferenceMap = referenceMap;
	let savedBundledStrings = bundledStrings$1;

	// TODO: We may need to revisit this if we do more external calls to user code (since it could be slow)
	let savedSrc = new Uint8Array(src.slice(0, srcEnd)); // we copy the data in case it changes while external data is processed
	let savedStructures = currentStructures;
	let savedDecoder = currentDecoder;
	let savedSequentialMode = sequentialMode;
	let value = callback();
	srcEnd = savedSrcEnd;
	position$1 = savedPosition;
	srcStringStart = savedSrcStringStart;
	srcStringEnd = savedSrcStringEnd;
	srcString = savedSrcString;
	referenceMap = savedReferenceMap;
	bundledStrings$1 = savedBundledStrings;
	src = savedSrc;
	sequentialMode = savedSequentialMode;
	currentStructures = savedStructures;
	currentDecoder = savedDecoder;
	dataView = new DataView(src.buffer, src.byteOffset, src.byteLength);
	return value
}
function clearSource() {
	src = null;
	referenceMap = null;
	currentStructures = null;
}

const mult10 = new Array(147); // this is a table matching binary exponents to the multiplier to determine significant digit rounding
for (let i = 0; i < 256; i++) {
	mult10[i] = +('1e' + Math.floor(45.15 - i * 0.30103));
}
let defaultDecoder = new Decoder({ useRecords: false });
const decode$1 = defaultDecoder.decode;
defaultDecoder.decodeMultiple;

let textEncoder;
try {
	textEncoder = new TextEncoder();
} catch (error) {}
let extensions, extensionClasses;
const Buffer$1 = typeof globalThis === 'object' && globalThis.Buffer;
const hasNodeBuffer = typeof Buffer$1 !== 'undefined';
const ByteArrayAllocate = hasNodeBuffer ? Buffer$1.allocUnsafeSlow : Uint8Array;
const ByteArray = hasNodeBuffer ? Buffer$1 : Uint8Array;
const MAX_STRUCTURES = 0x100;
const MAX_BUFFER_SIZE = hasNodeBuffer ? 0x100000000 : 0x7fd00000;
let throwOnIterable;
let target;
let targetView;
let position = 0;
let safeEnd;
let bundledStrings = null;
const MAX_BUNDLE_SIZE = 0xf000;
const hasNonLatin = /[\u0080-\uFFFF]/;
const RECORD_SYMBOL = Symbol('record-id');
class Encoder extends Decoder {
	constructor(options) {
		super(options);
		this.offset = 0;
		let start;
		let sharedStructures;
		let hasSharedUpdate;
		let structures;
		let referenceMap;
		options = options || {};
		let encodeUtf8 = ByteArray.prototype.utf8Write ? function(string, position, maxBytes) {
			return target.utf8Write(string, position, maxBytes)
		} : (textEncoder && textEncoder.encodeInto) ?
			function(string, position) {
				return textEncoder.encodeInto(string, target.subarray(position)).written
			} : false;

		let encoder = this;
		let hasSharedStructures = options.structures || options.saveStructures;
		let maxSharedStructures = options.maxSharedStructures;
		if (maxSharedStructures == null)
			maxSharedStructures = hasSharedStructures ? 128 : 0;
		if (maxSharedStructures > 8190)
			throw new Error('Maximum maxSharedStructure is 8190')
		let isSequential = options.sequential;
		if (isSequential) {
			maxSharedStructures = 0;
		}
		if (!this.structures)
			this.structures = [];
		if (this.saveStructures)
			this.saveShared = this.saveStructures;
		let samplingPackedValues, packedObjectMap, sharedValues = options.sharedValues;
		let sharedPackedObjectMap;
		if (sharedValues) {
			sharedPackedObjectMap = Object.create(null);
			for (let i = 0, l = sharedValues.length; i < l; i++) {
				sharedPackedObjectMap[sharedValues[i]] = i;
			}
		}
		let recordIdsToRemove = [];
		let transitionsCount = 0;
		let serializationsSinceTransitionRebuild = 0;
		
		this.mapEncode = function(value, encodeOptions) {
			// Experimental support for premapping keys using _keyMap instad of keyMap - not optiimised yet)
			if (this._keyMap && !this._mapped) {
				//console.log('encoding ', value)
				switch (value.constructor.name) {
					case 'Array': 
						value = value.map(r => this.encodeKeys(r));
						break
					//case 'Map': 
					//	value = this.encodeKeys(value)
					//	break
				}
				//this._mapped = true
			}
			return this.encode(value, encodeOptions)
		};
		
		this.encode = function(value, encodeOptions)	{
			if (!target) {
				target = new ByteArrayAllocate(8192);
				targetView = new DataView(target.buffer, 0, 8192);
				position = 0;
			}
			safeEnd = target.length - 10;
			if (safeEnd - position < 0x800) {
				// don't start too close to the end, 
				target = new ByteArrayAllocate(target.length);
				targetView = new DataView(target.buffer, 0, target.length);
				safeEnd = target.length - 10;
				position = 0;
			} else if (encodeOptions === REUSE_BUFFER_MODE)
				position = (position + 7) & 0x7ffffff8; // Word align to make any future copying of this buffer faster
			start = position;
			if (encoder.useSelfDescribedHeader) {
				targetView.setUint32(position, 0xd9d9f700); // tag two byte, then self-descriptive tag
				position += 3;
			}
			referenceMap = encoder.structuredClone ? new Map() : null;
			if (encoder.bundleStrings && typeof value !== 'string') {
				bundledStrings = [];
				bundledStrings.size = Infinity; // force a new bundle start on first string
			} else
				bundledStrings = null;

			sharedStructures = encoder.structures;
			if (sharedStructures) {
				if (sharedStructures.uninitialized) {
					let sharedData = encoder.getShared() || {};
					encoder.structures = sharedStructures = sharedData.structures || [];
					encoder.sharedVersion = sharedData.version;
					let sharedValues = encoder.sharedValues = sharedData.packedValues;
					if (sharedValues) {
						sharedPackedObjectMap = {};
						for (let i = 0, l = sharedValues.length; i < l; i++)
							sharedPackedObjectMap[sharedValues[i]] = i;
					}
				}
				let sharedStructuresLength = sharedStructures.length;
				if (sharedStructuresLength > maxSharedStructures && !isSequential)
					sharedStructuresLength = maxSharedStructures;
				if (!sharedStructures.transitions) {
					// rebuild our structure transitions
					sharedStructures.transitions = Object.create(null);
					for (let i = 0; i < sharedStructuresLength; i++) {
						let keys = sharedStructures[i];
						//console.log('shared struct keys:', keys)
						if (!keys)
							continue
						let nextTransition, transition = sharedStructures.transitions;
						for (let j = 0, l = keys.length; j < l; j++) {
							if (transition[RECORD_SYMBOL] === undefined)
								transition[RECORD_SYMBOL] = i;
							let key = keys[j];
							nextTransition = transition[key];
							if (!nextTransition) {
								nextTransition = transition[key] = Object.create(null);
							}
							transition = nextTransition;
						}
						transition[RECORD_SYMBOL] = i | 0x100000;
					}
				}
				if (!isSequential)
					sharedStructures.nextId = sharedStructuresLength;
			}
			if (hasSharedUpdate)
				hasSharedUpdate = false;
			structures = sharedStructures || [];
			packedObjectMap = sharedPackedObjectMap;
			if (options.pack) {
				let packedValues = new Map();
				packedValues.values = [];
				packedValues.encoder = encoder;
				packedValues.maxValues = options.maxPrivatePackedValues || (sharedPackedObjectMap ? 16 : Infinity);
				packedValues.objectMap = sharedPackedObjectMap || false;
				packedValues.samplingPackedValues = samplingPackedValues;
				findRepetitiveStrings(value, packedValues);
				if (packedValues.values.length > 0) {
					target[position++] = 0xd8; // one-byte tag
					target[position++] = 51; // tag 51 for packed shared structures https://www.potaroo.net/ietf/ids/draft-ietf-cbor-packed-03.txt
					writeArrayHeader(4);
					let valuesArray = packedValues.values;
					encode(valuesArray);
					writeArrayHeader(0); // prefixes
					writeArrayHeader(0); // suffixes
					packedObjectMap = Object.create(sharedPackedObjectMap || null);
					for (let i = 0, l = valuesArray.length; i < l; i++) {
						packedObjectMap[valuesArray[i]] = i;
					}
				}
			}
			throwOnIterable = encodeOptions & THROW_ON_ITERABLE;
			try {
				if (throwOnIterable)
					return;
				encode(value);
				if (bundledStrings) {
					writeBundles(start, encode);
				}
				encoder.offset = position; // update the offset so next serialization doesn't write over our buffer, but can continue writing to same buffer sequentially
				if (referenceMap && referenceMap.idsToInsert) {
					position += referenceMap.idsToInsert.length * 2;
					if (position > safeEnd)
						makeRoom(position);
					encoder.offset = position;
					let serialized = insertIds(target.subarray(start, position), referenceMap.idsToInsert);
					referenceMap = null;
					return serialized
				}
				if (encodeOptions & REUSE_BUFFER_MODE) {
					target.start = start;
					target.end = position;
					return target
				}
				return target.subarray(start, position) // position can change if we call encode again in saveShared, so we get the buffer now
			} finally {
				if (sharedStructures) {
					if (serializationsSinceTransitionRebuild < 10)
						serializationsSinceTransitionRebuild++;
					if (sharedStructures.length > maxSharedStructures)
						sharedStructures.length = maxSharedStructures;
					if (transitionsCount > 10000) {
						// force a rebuild occasionally after a lot of transitions so it can get cleaned up
						sharedStructures.transitions = null;
						serializationsSinceTransitionRebuild = 0;
						transitionsCount = 0;
						if (recordIdsToRemove.length > 0)
							recordIdsToRemove = [];
					} else if (recordIdsToRemove.length > 0 && !isSequential) {
						for (let i = 0, l = recordIdsToRemove.length; i < l; i++) {
							recordIdsToRemove[i][RECORD_SYMBOL] = undefined;
						}
						recordIdsToRemove = [];
						//sharedStructures.nextId = maxSharedStructures
					}
				}
				if (hasSharedUpdate && encoder.saveShared) {
					if (encoder.structures.length > maxSharedStructures) {
						encoder.structures = encoder.structures.slice(0, maxSharedStructures);
					}
					// we can't rely on start/end with REUSE_BUFFER_MODE since they will (probably) change when we save
					let returnBuffer = target.subarray(start, position);
					if (encoder.updateSharedData() === false)
						return encoder.encode(value) // re-encode if it fails
					return returnBuffer
				}
				if (encodeOptions & RESET_BUFFER_MODE)
					position = start;
			}
		};
		this.findCommonStringsToPack = () => {
			samplingPackedValues = new Map();
			if (!sharedPackedObjectMap)
				sharedPackedObjectMap = Object.create(null);
			return (options) => {
				let threshold = options && options.threshold || 4;
				let position = this.pack ? options.maxPrivatePackedValues || 16 : 0;
				if (!sharedValues)
					sharedValues = this.sharedValues = [];
				for (let [ key, status ] of samplingPackedValues) {
					if (status.count > threshold) {
						sharedPackedObjectMap[key] = position++;
						sharedValues.push(key);
						hasSharedUpdate = true;
					}
				}
				while (this.saveShared && this.updateSharedData() === false) {}
				samplingPackedValues = null;
			}
		};
		const encode = (value) => {
			if (position > safeEnd)
				target = makeRoom(position);

			var type = typeof value;
			var length;
			if (type === 'string') {
				if (packedObjectMap) {
					let packedPosition = packedObjectMap[value];
					if (packedPosition >= 0) {
						if (packedPosition < 16)
							target[position++] = packedPosition + 0xe0; // simple values, defined in https://www.potaroo.net/ietf/ids/draft-ietf-cbor-packed-03.txt
						else {
							target[position++] = 0xc6; // tag 6 defined in https://www.potaroo.net/ietf/ids/draft-ietf-cbor-packed-03.txt
							if (packedPosition & 1)
								encode((15 - packedPosition) >> 1);
							else
								encode((packedPosition - 16) >> 1);
						}
						return
/*						} else if (packedStatus.serializationId != serializationId) {
							packedStatus.serializationId = serializationId
							packedStatus.count = 1
							if (options.sharedPack) {
								let sharedCount = packedStatus.sharedCount = (packedStatus.sharedCount || 0) + 1
								if (shareCount > (options.sharedPack.threshold || 5)) {
									let sharedPosition = packedStatus.position = packedStatus.nextSharedPosition
									hasSharedUpdate = true
									if (sharedPosition < 16)
										target[position++] = sharedPosition + 0xc0

								}
							}
						} // else any in-doc incrementation?*/
					} else if (samplingPackedValues && !options.pack) {
						let status = samplingPackedValues.get(value);
						if (status)
							status.count++;
						else
							samplingPackedValues.set(value, {
								count: 1,
							});
					}
				}
				let strLength = value.length;
				if (bundledStrings && strLength >= 4 && strLength < 0x400) {
					if ((bundledStrings.size += strLength) > MAX_BUNDLE_SIZE) {
						let extStart;
						let maxBytes = (bundledStrings[0] ? bundledStrings[0].length * 3 + bundledStrings[1].length : 0) + 10;
						if (position + maxBytes > safeEnd)
							target = makeRoom(position + maxBytes);
						target[position++] = 0xd9; // tag 16-bit
						target[position++] = 0xdf; // tag 0xdff9
						target[position++] = 0xf9;
						// TODO: If we only have one bundle with any string data, only write one string bundle
						target[position++] = bundledStrings.position ? 0x84 : 0x82; // array of 4 or 2 elements depending on if we write bundles
						target[position++] = 0x1a; // 32-bit unsigned int
						extStart = position - start;
						position += 4; // reserve for writing bundle reference
						if (bundledStrings.position) {
							writeBundles(start, encode); // write the last bundles
						}
						bundledStrings = ['', '']; // create new ones
						bundledStrings.size = 0;
						bundledStrings.position = extStart;
					}
					let twoByte = hasNonLatin.test(value);
					bundledStrings[twoByte ? 0 : 1] += value;
					target[position++] = twoByte ? 0xce : 0xcf;
					encode(strLength);
					return
				}
				let headerSize;
				// first we estimate the header size, so we can write to the correct location
				if (strLength < 0x20) {
					headerSize = 1;
				} else if (strLength < 0x100) {
					headerSize = 2;
				} else if (strLength < 0x10000) {
					headerSize = 3;
				} else {
					headerSize = 5;
				}
				let maxBytes = strLength * 3;
				if (position + maxBytes > safeEnd)
					target = makeRoom(position + maxBytes);

				if (strLength < 0x40 || !encodeUtf8) {
					let i, c1, c2, strPosition = position + headerSize;
					for (i = 0; i < strLength; i++) {
						c1 = value.charCodeAt(i);
						if (c1 < 0x80) {
							target[strPosition++] = c1;
						} else if (c1 < 0x800) {
							target[strPosition++] = c1 >> 6 | 0xc0;
							target[strPosition++] = c1 & 0x3f | 0x80;
						} else if (
							(c1 & 0xfc00) === 0xd800 &&
							((c2 = value.charCodeAt(i + 1)) & 0xfc00) === 0xdc00
						) {
							c1 = 0x10000 + ((c1 & 0x03ff) << 10) + (c2 & 0x03ff);
							i++;
							target[strPosition++] = c1 >> 18 | 0xf0;
							target[strPosition++] = c1 >> 12 & 0x3f | 0x80;
							target[strPosition++] = c1 >> 6 & 0x3f | 0x80;
							target[strPosition++] = c1 & 0x3f | 0x80;
						} else {
							target[strPosition++] = c1 >> 12 | 0xe0;
							target[strPosition++] = c1 >> 6 & 0x3f | 0x80;
							target[strPosition++] = c1 & 0x3f | 0x80;
						}
					}
					length = strPosition - position - headerSize;
				} else {
					length = encodeUtf8(value, position + headerSize, maxBytes);
				}

				if (length < 0x18) {
					target[position++] = 0x60 | length;
				} else if (length < 0x100) {
					if (headerSize < 2) {
						target.copyWithin(position + 2, position + 1, position + 1 + length);
					}
					target[position++] = 0x78;
					target[position++] = length;
				} else if (length < 0x10000) {
					if (headerSize < 3) {
						target.copyWithin(position + 3, position + 2, position + 2 + length);
					}
					target[position++] = 0x79;
					target[position++] = length >> 8;
					target[position++] = length & 0xff;
				} else {
					if (headerSize < 5) {
						target.copyWithin(position + 5, position + 3, position + 3 + length);
					}
					target[position++] = 0x7a;
					targetView.setUint32(position, length);
					position += 4;
				}
				position += length;
			} else if (type === 'number') {
				if (!this.alwaysUseFloat && value >>> 0 === value) {// positive integer, 32-bit or less
					// positive uint
					if (value < 0x18) {
						target[position++] = value;
					} else if (value < 0x100) {
						target[position++] = 0x18;
						target[position++] = value;
					} else if (value < 0x10000) {
						target[position++] = 0x19;
						target[position++] = value >> 8;
						target[position++] = value & 0xff;
					} else {
						target[position++] = 0x1a;
						targetView.setUint32(position, value);
						position += 4;
					}
				} else if (!this.alwaysUseFloat && value >> 0 === value) { // negative integer
					if (value >= -0x18) {
						target[position++] = 0x1f - value;
					} else if (value >= -0x100) {
						target[position++] = 0x38;
						target[position++] = ~value;
					} else if (value >= -0x10000) {
						target[position++] = 0x39;
						targetView.setUint16(position, ~value);
						position += 2;
					} else {
						target[position++] = 0x3a;
						targetView.setUint32(position, ~value);
						position += 4;
					}
				} else {
					let useFloat32;
					if ((useFloat32 = this.useFloat32) > 0 && value < 0x100000000 && value >= -0x80000000) {
						target[position++] = 0xfa;
						targetView.setFloat32(position, value);
						let xShifted;
						if (useFloat32 < 4 ||
								// this checks for rounding of numbers that were encoded in 32-bit float to nearest significant decimal digit that could be preserved
								((xShifted = value * mult10[((target[position] & 0x7f) << 1) | (target[position + 1] >> 7)]) >> 0) === xShifted) {
							position += 4;
							return
						} else
							position--; // move back into position for writing a double
					}
					target[position++] = 0xfb;
					targetView.setFloat64(position, value);
					position += 8;
				}
			} else if (type === 'object') {
				if (!value)
					target[position++] = 0xf6;
				else {
					if (referenceMap) {
						let referee = referenceMap.get(value);
						if (referee) {
							target[position++] = 0xd8;
							target[position++] = 29; // http://cbor.schmorp.de/value-sharing
							target[position++] = 0x19; // 16-bit uint
							if (!referee.references) {
								let idsToInsert = referenceMap.idsToInsert || (referenceMap.idsToInsert = []);
								referee.references = [];
								idsToInsert.push(referee);
							}
							referee.references.push(position - start);
							position += 2; // TODO: also support 32-bit
							return
						} else 
							referenceMap.set(value, { offset: position - start });
					}
					let constructor = value.constructor;
					if (constructor === Object) {
						writeObject(value);
					} else if (constructor === Array) {
						length = value.length;
						if (length < 0x18) {
							target[position++] = 0x80 | length;
						} else {
							writeArrayHeader(length);
						}
						for (let i = 0; i < length; i++) {
							encode(value[i]);
						}
					} else if (constructor === Map) {
						if (this.mapsAsObjects ? this.useTag259ForMaps !== false : this.useTag259ForMaps) {
							// use Tag 259 (https://github.com/shanewholloway/js-cbor-codec/blob/master/docs/CBOR-259-spec--explicit-maps.md) for maps if the user wants it that way
							target[position++] = 0xd9;
							target[position++] = 1;
							target[position++] = 3;
						}
						length = value.size;
						if (length < 0x18) {
							target[position++] = 0xa0 | length;
						} else if (length < 0x100) {
							target[position++] = 0xb8;
							target[position++] = length;
						} else if (length < 0x10000) {
							target[position++] = 0xb9;
							target[position++] = length >> 8;
							target[position++] = length & 0xff;
						} else {
							target[position++] = 0xba;
							targetView.setUint32(position, length);
							position += 4;
						}
						if (encoder.keyMap) { 
							for (let [ key, entryValue ] of value) {
								encode(encoder.encodeKey(key));
								encode(entryValue);
							} 
						} else { 
							for (let [ key, entryValue ] of value) {
								encode(key); 
								encode(entryValue);
							} 	
						}
					} else {
						for (let i = 0, l = extensions.length; i < l; i++) {
							let extensionClass = extensionClasses[i];
							if (value instanceof extensionClass) {
								let extension = extensions[i];
								let tag = extension.tag;
								if (tag == undefined)
									tag = extension.getTag && extension.getTag.call(this, value);
								if (tag < 0x18) {
									target[position++] = 0xc0 | tag;
								} else if (tag < 0x100) {
									target[position++] = 0xd8;
									target[position++] = tag;
								} else if (tag < 0x10000) {
									target[position++] = 0xd9;
									target[position++] = tag >> 8;
									target[position++] = tag & 0xff;
								} else if (tag > -1) {
									target[position++] = 0xda;
									targetView.setUint32(position, tag);
									position += 4;
								} // else undefined, don't write tag
								extension.encode.call(this, value, encode, makeRoom);
								return
							}
						}
						if (value[Symbol.iterator]) {
							if (throwOnIterable) {
								let error = new Error('Iterable should be serialized as iterator');
								error.iteratorNotHandled = true;
								throw error;
							}
							target[position++] = 0x9f; // indefinite length array
							for (let entry of value) {
								encode(entry);
							}
							target[position++] = 0xff; // stop-code
							return
						}
						if (value[Symbol.asyncIterator] || isBlob(value)) {
							let error = new Error('Iterable/blob should be serialized as iterator');
							error.iteratorNotHandled = true;
							throw error;
						}
						if (this.useToJSON && value.toJSON) {
							const json = value.toJSON();
							// if for some reason value.toJSON returns itself it'll loop forever
							if (json !== value)
								return encode(json)
						}

						// no extension found, write as a plain object
						writeObject(value);
					}
				}
			} else if (type === 'boolean') {
				target[position++] = value ? 0xf5 : 0xf4;
			} else if (type === 'bigint') {
				if (value < (BigInt(1)<<BigInt(64)) && value >= 0) {
					// use an unsigned int as long as it fits
					target[position++] = 0x1b;
					targetView.setBigUint64(position, value);
				} else if (value > -(BigInt(1)<<BigInt(64)) && value < 0) {
					// if we can fit an unsigned int, use that
					target[position++] = 0x3b;
					targetView.setBigUint64(position, -value - BigInt(1));
				} else {
					// overflow
					if (this.largeBigIntToFloat) {
						target[position++] = 0xfb;
						targetView.setFloat64(position, Number(value));
					} else {
						if (value >= BigInt(0))
							target[position++] = 0xc2; // tag 2
						else {
							target[position++] = 0xc3; // tag 2
							value = BigInt(-1) - value;
						}
						let bytes = [];
						while (value) {
							bytes.push(Number(value & BigInt(0xff)));
							value >>= BigInt(8);
						}
						writeBuffer(new Uint8Array(bytes.reverse()), makeRoom);
						return;
					}
				}
				position += 8;
			} else if (type === 'undefined') {
				target[position++] = 0xf7;
			} else {
				throw new Error('Unknown type: ' + type)
			}
		};

		const writeObject = this.useRecords === false ? this.variableMapSize ? (object) => {
			// this method is slightly slower, but generates "preferred serialization" (optimally small for smaller objects)
			let keys = Object.keys(object);
			let vals = Object.values(object);
			let length = keys.length;
			if (length < 0x18) {
				target[position++] = 0xa0 | length;
			} else if (length < 0x100) {
				target[position++] = 0xb8;
				target[position++] = length;
			} else if (length < 0x10000) {
				target[position++] = 0xb9;
				target[position++] = length >> 8;
				target[position++] = length & 0xff;
			} else {
				target[position++] = 0xba;
				targetView.setUint32(position, length);
				position += 4;
			}
			if (encoder.keyMap) { 
				for (let i = 0; i < length; i++) {
					encode(encoder.encodeKey(keys[i]));
					encode(vals[i]);
				}
			} else {
				for (let i = 0; i < length; i++) {
					encode(keys[i]);
					encode(vals[i]);
				}
			}
		} :
		(object) => {
			target[position++] = 0xb9; // always use map 16, so we can preallocate and set the length afterwards
			let objectOffset = position - start;
			position += 2;
			let size = 0;
			if (encoder.keyMap) {
				for (let key in object) if (typeof object.hasOwnProperty !== 'function' || object.hasOwnProperty(key)) {
					encode(encoder.encodeKey(key));
					encode(object[key]);
					size++;
				}
			} else { 
				for (let key in object) if (typeof object.hasOwnProperty !== 'function' || object.hasOwnProperty(key)) {
						encode(key);
						encode(object[key]);
					size++;
				}
			}
			target[objectOffset++ + start] = size >> 8;
			target[objectOffset + start] = size & 0xff;
		} :
		(object, skipValues) => {
			let nextTransition, transition = structures.transitions || (structures.transitions = Object.create(null));
			let newTransitions = 0;
			let length = 0;
			let parentRecordId;
			let keys;
			if (this.keyMap) {
				keys = Object.keys(object).map(k => this.encodeKey(k));
				length = keys.length;
				for (let i = 0; i < length; i++) {
					let key = keys[i];
					nextTransition = transition[key];
					if (!nextTransition) {
						nextTransition = transition[key] = Object.create(null);
						newTransitions++;
					}
					transition = nextTransition;
				}				
			} else {
				for (let key in object) if (typeof object.hasOwnProperty !== 'function' || object.hasOwnProperty(key)) {
					nextTransition = transition[key];
					if (!nextTransition) {
						if (transition[RECORD_SYMBOL] & 0x100000) {// this indicates it is a brancheable/extendable terminal node, so we will use this record id and extend it
							parentRecordId = transition[RECORD_SYMBOL] & 0xffff;
						}
						nextTransition = transition[key] = Object.create(null);
						newTransitions++;
					}
					transition = nextTransition;
					length++;
				}
			}
			let recordId = transition[RECORD_SYMBOL];
			if (recordId !== undefined) {
				recordId &= 0xffff;
				target[position++] = 0xd9;
				target[position++] = (recordId >> 8) | 0xe0;
				target[position++] = recordId & 0xff;
			} else {
				if (!keys)
					keys = transition.__keys__ || (transition.__keys__ = Object.keys(object));
				if (parentRecordId === undefined) {
					recordId = structures.nextId++;
					if (!recordId) {
						recordId = 0;
						structures.nextId = 1;
					}
					if (recordId >= MAX_STRUCTURES) {// cycle back around
						structures.nextId = (recordId = maxSharedStructures) + 1;
					}
				} else {
					recordId = parentRecordId;
				}
				structures[recordId] = keys;
				if (recordId < maxSharedStructures) {
					target[position++] = 0xd9;
					target[position++] = (recordId >> 8) | 0xe0;
					target[position++] = recordId & 0xff;
					transition = structures.transitions;
					for (let i = 0; i < length; i++) {
						if (transition[RECORD_SYMBOL] === undefined || (transition[RECORD_SYMBOL] & 0x100000))
							transition[RECORD_SYMBOL] = recordId;
						transition = transition[keys[i]];
					}
					transition[RECORD_SYMBOL] = recordId | 0x100000; // indicates it is a extendable terminal
					hasSharedUpdate = true;
				} else {
					transition[RECORD_SYMBOL] = recordId;
					targetView.setUint32(position, 0xd9dfff00); // tag two byte, then record definition id
					position += 3;
					if (newTransitions)
						transitionsCount += serializationsSinceTransitionRebuild * newTransitions;
					// record the removal of the id, we can maintain our shared structure
					if (recordIdsToRemove.length >= MAX_STRUCTURES - maxSharedStructures)
						recordIdsToRemove.shift()[RECORD_SYMBOL] = undefined; // we are cycling back through, and have to remove old ones
					recordIdsToRemove.push(transition);
					writeArrayHeader(length + 2);
					encode(0xe000 + recordId);
					encode(keys);
					if (skipValues) return; // special exit for iterator
					for (let key in object)
						if (typeof object.hasOwnProperty !== 'function' || object.hasOwnProperty(key))
							encode(object[key]);
					return
				}
			}
			if (length < 0x18) { // write the array header
				target[position++] = 0x80 | length;
			} else {
				writeArrayHeader(length);
			}
			if (skipValues) return; // special exit for iterator
			for (let key in object)
				if (typeof object.hasOwnProperty !== 'function' || object.hasOwnProperty(key))
					encode(object[key]);
		};
		const makeRoom = (end) => {
			let newSize;
			if (end > 0x1000000) {
				// special handling for really large buffers
				if ((end - start) > MAX_BUFFER_SIZE)
					throw new Error('Encoded buffer would be larger than maximum buffer size')
				newSize = Math.min(MAX_BUFFER_SIZE,
					Math.round(Math.max((end - start) * (end > 0x4000000 ? 1.25 : 2), 0x400000) / 0x1000) * 0x1000);
			} else // faster handling for smaller buffers
				newSize = ((Math.max((end - start) << 2, target.length - 1) >> 12) + 1) << 12;
			let newBuffer = new ByteArrayAllocate(newSize);
			targetView = new DataView(newBuffer.buffer, 0, newSize);
			if (target.copy)
				target.copy(newBuffer, 0, start, end);
			else
				newBuffer.set(target.slice(start, end));
			position -= start;
			start = 0;
			safeEnd = newBuffer.length - 10;
			return target = newBuffer
		};
		let chunkThreshold = 100;
		let continuedChunkThreshold = 1000;
		this.encodeAsIterable = function(value, options) {
			return startEncoding(value, options, encodeObjectAsIterable);
		};
		this.encodeAsAsyncIterable = function(value, options) {
			return startEncoding(value, options, encodeObjectAsAsyncIterable);
		};

		function* encodeObjectAsIterable(object, iterateProperties, finalIterable) {
			let constructor = object.constructor;
			if (constructor === Object) {
				let useRecords = encoder.useRecords !== false;
				if (useRecords)
					writeObject(object, true); // write the record identifier
				else
					writeEntityLength(Object.keys(object).length, 0xa0);
				for (let key in object) {
					let value = object[key];
					if (!useRecords) encode(key);
					if (value && typeof value === 'object') {
						if (iterateProperties[key])
							yield* encodeObjectAsIterable(value, iterateProperties[key]);
						else
							yield* tryEncode(value, iterateProperties, key);
					} else encode(value);
				}
			} else if (constructor === Array) {
				let length = object.length;
				writeArrayHeader(length);
				for (let i = 0; i < length; i++) {
					let value = object[i];
					if (value && (typeof value === 'object' || position - start > chunkThreshold)) {
						if (iterateProperties.element)
							yield* encodeObjectAsIterable(value, iterateProperties.element);
						else
							yield* tryEncode(value, iterateProperties, 'element');
					} else encode(value);
				}
			} else if (object[Symbol.iterator] && !object.buffer) { // iterator, but exclude typed arrays
				target[position++] = 0x9f; // start indefinite array
				for (let value of object) {
					if (value && (typeof value === 'object' || position - start > chunkThreshold)) {
						if (iterateProperties.element)
							yield* encodeObjectAsIterable(value, iterateProperties.element);
						else
							yield* tryEncode(value, iterateProperties, 'element');
					} else encode(value);
				}
				target[position++] = 0xff; // stop byte
			} else if (isBlob(object)){
				writeEntityLength(object.size, 0x40); // encode as binary data
				yield target.subarray(start, position);
				yield object; // directly return blobs, they have to be encoded asynchronously
				restartEncoding();
			} else if (object[Symbol.asyncIterator]) {
				target[position++] = 0x9f; // start indefinite array
				yield target.subarray(start, position);
				yield object; // directly return async iterators, they have to be encoded asynchronously
				restartEncoding();
				target[position++] = 0xff; // stop byte
			} else {
				encode(object);
			}
			if (finalIterable && position > start) yield target.subarray(start, position);
			else if (position - start > chunkThreshold) {
				yield target.subarray(start, position);
				restartEncoding();
			}
		}
		function* tryEncode(value, iterateProperties, key) {
			let restart = position - start;
			try {
				encode(value);
				if (position - start > chunkThreshold) {
					yield target.subarray(start, position);
					restartEncoding();
				}
			} catch (error) {
				if (error.iteratorNotHandled) {
					iterateProperties[key] = {};
					position = start + restart; // restart our position so we don't have partial data from last encode
					yield* encodeObjectAsIterable.call(this, value, iterateProperties[key]);
				} else throw error;
			}
		}
		function restartEncoding() {
			chunkThreshold = continuedChunkThreshold;
			encoder.encode(null, THROW_ON_ITERABLE); // restart encoding
		}
		function startEncoding(value, options, encodeIterable) {
			if (options && options.chunkThreshold) // explicitly specified chunk sizes
				chunkThreshold = continuedChunkThreshold = options.chunkThreshold;
			else // we start with a smaller threshold to get initial bytes sent quickly
				chunkThreshold = 100;
			if (value && typeof value === 'object') {
				encoder.encode(null, THROW_ON_ITERABLE); // start encoding
				return encodeIterable(value, encoder.iterateProperties || (encoder.iterateProperties = {}), true);
			}
			return [encoder.encode(value)];
		}

		async function* encodeObjectAsAsyncIterable(value, iterateProperties) {
			for (let encodedValue of encodeObjectAsIterable(value, iterateProperties, true)) {
				let constructor = encodedValue.constructor;
				if (constructor === ByteArray || constructor === Uint8Array)
					yield encodedValue;
				else if (isBlob(encodedValue)) {
					let reader = encodedValue.stream().getReader();
					let next;
					while (!(next = await reader.read()).done) {
						yield next.value;
					}
				} else if (encodedValue[Symbol.asyncIterator]) {
					for await (let asyncValue of encodedValue) {
						restartEncoding();
						if (asyncValue)
							yield* encodeObjectAsAsyncIterable(asyncValue, iterateProperties.async || (iterateProperties.async = {}));
						else yield encoder.encode(asyncValue);
					}
				} else {
					yield encodedValue;
				}
			}
		}
	}
	useBuffer(buffer) {
		// this means we are finished using our own buffer and we can write over it safely
		target = buffer;
		targetView = new DataView(target.buffer, target.byteOffset, target.byteLength);
		position = 0;
	}
	clearSharedData() {
		if (this.structures)
			this.structures = [];
		if (this.sharedValues)
			this.sharedValues = undefined;
	}
	updateSharedData() {
		let lastVersion = this.sharedVersion || 0;
		this.sharedVersion = lastVersion + 1;
		let structuresCopy = this.structures.slice(0);
		let sharedData = new SharedData(structuresCopy, this.sharedValues, this.sharedVersion);
		let saveResults = this.saveShared(sharedData,
				existingShared => (existingShared && existingShared.version || 0) == lastVersion);
		if (saveResults === false) {
			// get updated structures and try again if the update failed
			sharedData = this.getShared() || {};
			this.structures = sharedData.structures || [];
			this.sharedValues = sharedData.packedValues;
			this.sharedVersion = sharedData.version;
			this.structures.nextId = this.structures.length;
		} else {
			// restore structures
			structuresCopy.forEach((structure, i) => this.structures[i] = structure);
		}
		// saveShared may fail to write and reload, or may have reloaded to check compatibility and overwrite saved data, either way load the correct shared data
		return saveResults
	}
}
function writeEntityLength(length, majorValue) {
	if (length < 0x18)
		target[position++] = majorValue | length;
	else if (length < 0x100) {
		target[position++] = majorValue | 0x18;
		target[position++] = length;
	} else if (length < 0x10000) {
		target[position++] = majorValue | 0x19;
		target[position++] = length >> 8;
		target[position++] = length & 0xff;
	} else {
		target[position++] = majorValue | 0x1a;
		targetView.setUint32(position, length);
		position += 4;
	}

}
class SharedData {
	constructor(structures, values, version) {
		this.structures = structures;
		this.packedValues = values;
		this.version = version;
	}
}

function writeArrayHeader(length) {
	if (length < 0x18)
		target[position++] = 0x80 | length;
	else if (length < 0x100) {
		target[position++] = 0x98;
		target[position++] = length;
	} else if (length < 0x10000) {
		target[position++] = 0x99;
		target[position++] = length >> 8;
		target[position++] = length & 0xff;
	} else {
		target[position++] = 0x9a;
		targetView.setUint32(position, length);
		position += 4;
	}
}

const BlobConstructor = typeof Blob === 'undefined' ? function(){} : Blob;
function isBlob(object) {
	if (object instanceof BlobConstructor)
		return true;
	let tag = object[Symbol.toStringTag];
	return tag === 'Blob' || tag === 'File';
}
function findRepetitiveStrings(value, packedValues) {
	switch(typeof value) {
		case 'string':
			if (value.length > 3) {
				if (packedValues.objectMap[value] > -1 || packedValues.values.length >= packedValues.maxValues)
					return
				let packedStatus = packedValues.get(value);
				if (packedStatus) {
					if (++packedStatus.count == 2) {
						packedValues.values.push(value);
					}
				} else {
					packedValues.set(value, {
						count: 1,
					});
					if (packedValues.samplingPackedValues) {
						let status = packedValues.samplingPackedValues.get(value);
						if (status)
							status.count++;
						else
							packedValues.samplingPackedValues.set(value, {
								count: 1,
							});
					}
				}
			}
			break
		case 'object':
			if (value) {
				if (value instanceof Array) {
					for (let i = 0, l = value.length; i < l; i++) {
						findRepetitiveStrings(value[i], packedValues);
					}

				} else {
					let includeKeys = !packedValues.encoder.useRecords;
					for (var key in value) {
						if (value.hasOwnProperty(key)) {
							if (includeKeys)
								findRepetitiveStrings(key, packedValues);
							findRepetitiveStrings(value[key], packedValues);
						}
					}
				}
			}
			break
		case 'function': console.log(value);
	}
}
const isLittleEndianMachine = new Uint8Array(new Uint16Array([1]).buffer)[0] == 1;
extensionClasses = [ Date, Set, Error, RegExp, Tag, ArrayBuffer,
	Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array,
	typeof BigUint64Array == 'undefined' ? function() {} : BigUint64Array, Int8Array, Int16Array, Int32Array,
	typeof BigInt64Array == 'undefined' ? function() {} : BigInt64Array,
	Float32Array, Float64Array, SharedData ];

//Object.getPrototypeOf(Uint8Array.prototype).constructor /*TypedArray*/
extensions = [{ // Date
	tag: 1,
	encode(date, encode) {
		let seconds = date.getTime() / 1000;
		if ((this.useTimestamp32 || date.getMilliseconds() === 0) && seconds >= 0 && seconds < 0x100000000) {
			// Timestamp 32
			target[position++] = 0x1a;
			targetView.setUint32(position, seconds);
			position += 4;
		} else {
			// Timestamp float64
			target[position++] = 0xfb;
			targetView.setFloat64(position, seconds);
			position += 8;
		}
	}
}, { // Set
	tag: 258, // https://github.com/input-output-hk/cbor-sets-spec/blob/master/CBOR_SETS.md
	encode(set, encode) {
		let array = Array.from(set);
		encode(array);
	}
}, { // Error
	tag: 27, // http://cbor.schmorp.de/generic-object
	encode(error, encode) {
		encode([ error.name, error.message ]);
	}
}, { // RegExp
	tag: 27, // http://cbor.schmorp.de/generic-object
	encode(regex, encode) {
		encode([ 'RegExp', regex.source, regex.flags ]);
	}
}, { // Tag
	getTag(tag) {
		return tag.tag
	},
	encode(tag, encode) {
		encode(tag.value);
	}
}, { // ArrayBuffer
	encode(arrayBuffer, encode, makeRoom) {
		writeBuffer(arrayBuffer, makeRoom);
	}
}, { // Uint8Array
	getTag(typedArray) {
		if (typedArray.constructor === Uint8Array) {
			if (this.tagUint8Array || hasNodeBuffer && this.tagUint8Array !== false)
				return 64;
		} // else no tag
	},
	encode(typedArray, encode, makeRoom) {
		writeBuffer(typedArray, makeRoom);
	}
},
	typedArrayEncoder(68, 1),
	typedArrayEncoder(69, 2),
	typedArrayEncoder(70, 4),
	typedArrayEncoder(71, 8),
	typedArrayEncoder(72, 1),
	typedArrayEncoder(77, 2),
	typedArrayEncoder(78, 4),
	typedArrayEncoder(79, 8),
	typedArrayEncoder(85, 4),
	typedArrayEncoder(86, 8),
{
	encode(sharedData, encode) { // write SharedData
		let packedValues = sharedData.packedValues || [];
		let sharedStructures = sharedData.structures || [];
		if (packedValues.values.length > 0) {
			target[position++] = 0xd8; // one-byte tag
			target[position++] = 51; // tag 51 for packed shared structures https://www.potaroo.net/ietf/ids/draft-ietf-cbor-packed-03.txt
			writeArrayHeader(4);
			let valuesArray = packedValues.values;
			encode(valuesArray);
			writeArrayHeader(0); // prefixes
			writeArrayHeader(0); // suffixes
			packedObjectMap = Object.create(sharedPackedObjectMap || null);
			for (let i = 0, l = valuesArray.length; i < l; i++) {
				packedObjectMap[valuesArray[i]] = i;
			}
		}
		{
			targetView.setUint32(position, 0xd9dffe00);
			position += 3;
			let definitions = sharedStructures.slice(0);
			definitions.unshift(0xe000);
			definitions.push(new Tag(sharedData.version, 0x53687264));
			encode(definitions);
		}
		}
	}];
function typedArrayEncoder(tag, size) {
	if (!isLittleEndianMachine && size > 1)
		tag -= 4; // the big endian equivalents are 4 less
	return {
		tag: tag,
		encode: function writeExtBuffer(typedArray, encode) {
			let length = typedArray.byteLength;
			let offset = typedArray.byteOffset || 0;
			let buffer = typedArray.buffer || typedArray;
			encode(hasNodeBuffer ? Buffer$1.from(buffer, offset, length) :
				new Uint8Array(buffer, offset, length));
		}
	}
}
function writeBuffer(buffer, makeRoom) {
	let length = buffer.byteLength;
	if (length < 0x18) {
		target[position++] = 0x40 + length;
	} else if (length < 0x100) {
		target[position++] = 0x58;
		target[position++] = length;
	} else if (length < 0x10000) {
		target[position++] = 0x59;
		target[position++] = length >> 8;
		target[position++] = length & 0xff;
	} else {
		target[position++] = 0x5a;
		targetView.setUint32(position, length);
		position += 4;
	}
	if (position + length >= target.length) {
		makeRoom(position + length);
	}
	// if it is already a typed array (has an ArrayBuffer), use that, but if it is an ArrayBuffer itself,
	// must wrap it to set it.
	target.set(buffer.buffer ? buffer : new Uint8Array(buffer), position);
	position += length;
}

function insertIds(serialized, idsToInsert) {
	// insert the ids that need to be referenced for structured clones
	let nextId;
	let distanceToMove = idsToInsert.length * 2;
	let lastEnd = serialized.length - distanceToMove;
	idsToInsert.sort((a, b) => a.offset > b.offset ? 1 : -1);
	for (let id = 0; id < idsToInsert.length; id++) {
		let referee = idsToInsert[id];
		referee.id = id;
		for (let position of referee.references) {
			serialized[position++] = id >> 8;
			serialized[position] = id & 0xff;
		}
	}
	while (nextId = idsToInsert.pop()) {
		let offset = nextId.offset;
		serialized.copyWithin(offset + distanceToMove, offset, lastEnd);
		distanceToMove -= 2;
		let position = offset + distanceToMove;
		serialized[position++] = 0xd8;
		serialized[position++] = 28; // http://cbor.schmorp.de/value-sharing
		lastEnd = offset;
	}
	return serialized
}
function writeBundles(start, encode) {
	targetView.setUint32(bundledStrings.position + start, position - bundledStrings.position - start + 1); // the offset to bundle
	let writeStrings = bundledStrings;
	bundledStrings = null;
	encode(writeStrings[0]);
	encode(writeStrings[1]);
}
let defaultEncoder = new Encoder({ useRecords: false });
defaultEncoder.encode;
defaultEncoder.encodeAsIterable;
defaultEncoder.encodeAsAsyncIterable;
const REUSE_BUFFER_MODE = 512;
const RESET_BUFFER_MODE = 1024;
const THROW_ON_ITERABLE = 2048;

function encode(obj) {
    const encoder = new Encoder({ tagUint8Array: false, useRecords: false });
    return encoder.encode(obj);
}
function decode(buf) {
    return decode$1(buf);
}

const arraysAreEqual = (a, b) => a.length === b.length && a.every((element, index) => element === b[index]);

const headsAreSame = (a, b) => {
    return arraysAreEqual(a, b);
};

/* c8 ignore start */
/**
 * If `promise` is resolved before `t` ms elapse, the timeout is cleared and the result of the
 * promise is returned. If the timeout ends first, a `TimeoutError` is thrown.
 */
const withTimeout = async (promise, t) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new TimeoutError(`withTimeout: timed out after ${t}ms`)), t);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    }
    finally {
        clearTimeout(timeoutId);
    }
};
class TimeoutError extends Error {
    constructor(message) {
        super(message);
        this.name = "TimeoutError";
    }
}
/* c8 ignore end */

/**
 * A DocHandle is a wrapper around a single Automerge document that lets us listen for changes and
 * notify the network and storage of new changes.
 *
 * @remarks
 * A `DocHandle` represents a document which is being managed by a {@link Repo}. You shouldn't ever
 * instantiate this yourself. To obtain `DocHandle` use {@link Repo.find} or {@link Repo.create}.
 *
 * To modify the underlying document use either {@link DocHandle.change} or
 * {@link DocHandle.changeAt}. These methods will notify the `Repo` that some change has occured and
 * the `Repo` will save any new changes to the attached {@link StorageAdapter} and send sync
 * messages to connected peers.
 */
class DocHandle extends EventEmitter {
    documentId;
    #log;
    /** The XState actor running our state machine.  */
    #machine;
    /** The last known state of our document. */
    #prevDocState;
    /** How long to wait before giving up on a document. (Note that a document will be marked
     * unavailable much sooner if all known peers respond that they don't have it.) */
    #timeoutDelay = 60_000;
    /** A dictionary mapping each peer to the last heads we know they have. */
    #remoteHeads = {};
    /** @hidden */
    constructor(documentId, options = {}) {
        super();
        this.documentId = documentId;
        if ("timeoutDelay" in options && options.timeoutDelay) {
            this.#timeoutDelay = options.timeoutDelay;
        }
        let doc;
        const isNew = "isNew" in options && options.isNew;
        if (isNew) {
            // T should really be constrained to extend `Record<string, unknown>` (an automerge doc can't be
            // e.g. a primitive, an array, etc. - it must be an object). But adding that constraint creates
            // a bunch of other problems elsewhere so for now we'll just cast it here to make Automerge happy.
            doc = from(options.initialValue);
            doc = emptyChange(doc);
        }
        else {
            doc = init();
        }
        this.#log = debug(`automerge-repo:dochandle:${this.documentId.slice(0, 5)}`);
        const delay = this.#timeoutDelay;
        const machine = setup({
            types: {
                context: {},
                events: {},
            },
            actions: {
                /** Update the doc using the given callback and put the modified doc in context */
                onUpdate: assign(({ context, event }) => {
                    const oldDoc = context.doc;
                    assertEvent(event, UPDATE);
                    const { callback } = event.payload;
                    const doc = callback(oldDoc);
                    return { doc };
                }),
                onDelete: assign(() => {
                    this.emit("delete", { handle: this });
                    return { doc: undefined };
                }),
                onUnavailable: () => {
                    this.emit("unavailable", { handle: this });
                },
            },
        }).createMachine({
            /** @xstate-layout N4IgpgJg5mDOIC5QAoC2BDAxgCwJYDswBKAYgFUAFAEQEEAVAUQG0AGAXUVAAcB7WXAC64e+TiAAeiAOwAOAKwA6ACxSAzKqks1ATjlTdAGhABPRAFolAJksKN2y1KtKAbFLla5AX09G0WPISkVAwAMgyMrBxIILz8QiJikggAjCzOijKqLEqqybJyLizaRqYIFpbJtro5Uo7J2o5S3r4YOATECrgQADZgJADCAEoM9MzsYrGCwqLRSeoyCtra8pa5adquySXmDjY5ac7JljLJeepKzSB+bYGdPX0AYgCSAHJUkRN8UwmziM7HCgqyVcUnqcmScmcMm2ZV2yiyzkOx1OalUFx8V1aAQ63R46AgBCgJGGAEUyAwAMp0D7RSbxGagJKHFgKOSWJTJGRSCosCpKaEmRCqbQKU5yXINeTaer6LwY67YogKXH4wkkKgAeX6AH1hjQqABNGncL70xKIJQ5RY5BHOJag6wwpRyEWImQVeT1aWrVSXBXtJUqgn4Ik0ADqNCedG1L3CYY1gwA0saYqbpuaEG4pKLksKpFDgcsCjDhTnxTKpTLdH6sQGFOgAO7oKYhl5gAQNngAJwA1iRY3R40ndSNDSm6enfpm5BkWAVkvy7bpuTCKq7ndZnfVeSwuTX-HWu2AAI4AVzgQhD6q12rILxoADVIyEaAAhMLjtM-RmIE4LVSQi4nLLDIGzOCWwLKA0cgyLBoFWNy+43B0R5nheaqajqepjuMtJfgyEh-FoixqMCoKqOyhzgYKCDOq6UIeuCSxHOoSGKgop74OgABuzbdOgABGvTXlho5GrhJpxJOP4pLulT6KoMhpJY2hzsWNF0QobqMV6LG+pc+A8BAcBiP6gSfFJ36EQgKksksKxrHamwwmY7gLKB85QjBzoAWxdZdL0FnfARST8ooLC7qoTnWBU4pyC5ViVMKBQaHUDQuM4fm3EGhJBWaU7-CysEAUp3LpEpWw0WYRw2LmqzgqciIsCxWUdI2zaXlAbYdt2PZ5dJ1n5jY2iJY1ikOIcMJHCyUWHC62hRZkUVNPKta3Kh56wJ1-VWUyzhFc64JWJCtQNBBzhQW4cHwbsrVKpxPF8YJgV4ZZIWIKkiKiiNSkqZYWjzCWaQ5hFh0AcCuR3QoR74qUknBRmzholpv3OkpRQNNRpTzaKTWKbIWR5FDxm9AIkA7e9skUYCWayLILBZGoLkUSKbIyIdpxHPoyTeN4QA */
            // You can use the XState extension for VS Code to visualize this machine.
            // Or, you can see this static visualization (last updated April 2024): https://stately.ai/registry/editor/d7af9b58-c518-44f1-9c36-92a238b04a7a?machineId=91c387e7-0f01-42c9-a21d-293e9bf95bb7
            initial: "idle",
            context: { documentId, doc },
            on: {
                UPDATE: { actions: "onUpdate" },
                DELETE: ".deleted",
            },
            states: {
                idle: {
                    on: {
                        CREATE: "ready",
                        FIND: "loading",
                    },
                },
                loading: {
                    on: {
                        REQUEST: "requesting",
                        DOC_READY: "ready",
                        AWAIT_NETWORK: "awaitingNetwork",
                    },
                    after: { [delay]: "unavailable" },
                },
                awaitingNetwork: {
                    on: { NETWORK_READY: "requesting" },
                },
                requesting: {
                    on: {
                        DOC_UNAVAILABLE: "unavailable",
                        DOC_READY: "ready",
                    },
                    after: { [delay]: "unavailable" },
                },
                unavailable: {
                    entry: "onUnavailable",
                    on: { DOC_READY: "ready" },
                },
                ready: {},
                deleted: { entry: "onDelete", type: "final" },
            },
        });
        // Instantiate the state machine
        this.#machine = createActor(machine);
        // Listen for state transitions
        this.#machine.subscribe(state => {
            const before = this.#prevDocState;
            const after = state.context.doc;
            this.#log(`→ ${state.value} %o`, after);
            // if the document has changed, emit a change event
            this.#checkForChanges(before, after);
        });
        // Start the machine, and send a create or find event to get things going
        this.#machine.start();
        this.#machine.send(isNew ? { type: CREATE } : { type: FIND });
    }
    // PRIVATE
    /** Returns the current document, regardless of state */
    get #doc() {
        return this.#machine?.getSnapshot().context.doc;
    }
    /** Returns the docHandle's state (READY, etc.) */
    get #state() {
        return this.#machine?.getSnapshot().value;
    }
    /** Returns a promise that resolves when the docHandle is in one of the given states */
    #statePromise(awaitStates) {
        const awaitStatesArray = Array.isArray(awaitStates)
            ? awaitStates
            : [awaitStates];
        return waitFor(this.#machine, s => awaitStatesArray.some(state => s.matches(state)), 
        // use a longer delay here so as not to race with other delays
        { timeout: this.#timeoutDelay * 2 });
    }
    /**
     * Called after state transitions. If the document has changed, emits a change event. If we just
     * received the document for the first time, signal that our request has been completed.
     */
    #checkForChanges(before, after) {
        const docChanged = after && before && !headsAreSame(getHeads(after), getHeads(before));
        if (docChanged) {
            this.emit("heads-changed", { handle: this, doc: after });
            const patches = diff(after, getHeads(before), getHeads(after));
            if (patches.length > 0) {
                this.emit("change", {
                    handle: this,
                    doc: after,
                    patches,
                    // TODO: pass along the source (load/change/network)
                    patchInfo: { before, after, source: "change" },
                });
            }
            // If we didn't have the document yet, signal that we now do
            if (!this.isReady())
                this.#machine.send({ type: DOC_READY });
        }
        this.#prevDocState = after;
    }
    // PUBLIC
    /** Our documentId in Automerge URL form.
     */
    get url() {
        return stringifyAutomergeUrl({ documentId: this.documentId });
    }
    /**
     * @returns true if the document is ready for accessing or changes.
     *
     * Note that for documents already stored locally this occurs before synchronization with any
     * peers. We do not currently have an equivalent `whenSynced()`.
     */
    isReady = () => this.inState(["ready"]);
    /**
     * @returns true if the document has been marked as deleted.
     *
     * Deleted documents are removed from local storage and the sync process. It's not currently
     * possible at runtime to undelete a document.
     */
    isDeleted = () => this.inState(["deleted"]);
    /**
     * @returns true if the document is currently unavailable.
     *
     * This will be the case if the document is not found in storage and no peers have shared it with us.
     */
    isUnavailable = () => this.inState(["unavailable"]);
    /**
     * @returns true if the handle is in one of the given states.
     */
    inState = (states) => states.some(s => this.#machine.getSnapshot().matches(s));
    /** @hidden */
    get state() {
        return this.#machine.getSnapshot().value;
    }
    /**
     * @returns a promise that resolves when the document is in one of the given states (if no states
     * are passed, when the document is ready)
     *
     * Use this to block until the document handle has finished loading. The async equivalent to
     * checking `inState()`.
     */
    async whenReady(awaitStates = ["ready"]) {
        await withTimeout(this.#statePromise(awaitStates), this.#timeoutDelay);
    }
    /**
     * @returns the current state of this handle's Automerge document.
     *
     * This is the recommended way to access a handle's document. Note that this waits for the handle
     * to be ready if necessary. If loading (or synchronization) fails, this will never resolve.
     */
    async doc(
    /** states to wait for, such as "LOADING". mostly for internal use. */
    awaitStates = ["ready", "unavailable"]) {
        try {
            // wait for the document to enter one of the desired states
            await this.#statePromise(awaitStates);
        }
        catch (error) {
            // if we timed out, return undefined
            return undefined;
        }
        // Return the document
        return !this.isUnavailable() ? this.#doc : undefined;
    }
    /**
     * Synchronously returns the current state of the Automerge document this handle manages, or
     * undefined. Consider using `await handle.doc()` instead. Check `isReady()`, or use `whenReady()`
     * if you want to make sure loading is complete first.
     *
     * Not to be confused with the SyncState of the document, which describes the state of the
     * synchronization process.
     *
     * Note that `undefined` is not a valid Automerge document, so the return from this function is
     * unambigous.
     *
     * @returns the current document, or undefined if the document is not ready.
     */
    docSync() {
        if (!this.isReady())
            return undefined;
        else
            return this.#doc;
    }
    /**
     * Returns the current "heads" of the document, akin to a git commit.
     * This precisely defines the state of a document.
     * @returns the current document's heads, or undefined if the document is not ready
     */
    heads() {
        if (!this.isReady()) {
            return undefined;
        }
        return getHeads(this.#doc);
    }
    /**
     * `update` is called by the repo when we receive changes from the network
     * Called by the repo when we receive changes from the network.
     * @hidden
     */
    update(callback) {
        this.#machine.send({ type: UPDATE, payload: { callback } });
    }
    /**
     * Called by the repo either when a doc handle changes or we receive new remote heads.
     * @hidden
     */
    setRemoteHeads(storageId, heads) {
        this.#remoteHeads[storageId] = heads;
        this.emit("remote-heads", { storageId, heads });
    }
    /** Returns the heads of the storageId. */
    getRemoteHeads(storageId) {
        return this.#remoteHeads[storageId];
    }
    /**
     * All changes to an Automerge document should be made through this method.
     * Inside the callback, the document should be treated as mutable: all edits will be recorded
     * using a Proxy and translated into operations as part of a single recorded "change".
     *
     * Note that assignment via ES6 spread operators will result in *replacing* the object
     * instead of mutating it which will prevent clean merges. This may be what you want, but
     * `doc.foo = { ...doc.foo, bar: "baz" }` is not equivalent to `doc.foo.bar = "baz"`.
     *
     * Local changes will be stored (by the StorageSubsystem) and synchronized (by the
     * DocSynchronizer) to any peers you are sharing it with.
     *
     * @param callback - A function that takes the current document and mutates it.
     *
     */
    change(callback, options = {}) {
        if (!this.isReady()) {
            throw new Error(`DocHandle#${this.documentId} is not ready. Check \`handle.isReady()\` before accessing the document.`);
        }
        this.#machine.send({
            type: UPDATE,
            payload: { callback: doc => change(doc, options, callback) },
        });
    }
    /**
     * Makes a change as if the document were at `heads`.
     *
     * @returns A set of heads representing the concurrent change that was made.
     */
    changeAt(heads, callback, options = {}) {
        if (!this.isReady()) {
            throw new Error(`DocHandle#${this.documentId} is not ready. Check \`handle.isReady()\` before accessing the document.`);
        }
        let resultHeads = undefined;
        this.#machine.send({
            type: UPDATE,
            payload: {
                callback: doc => {
                    const result = changeAt(doc, heads, options, callback);
                    resultHeads = result.newHeads || undefined;
                    return result.newDoc;
                },
            },
        });
        // the callback above will always run before we get here, so this should always contain the new heads
        return resultHeads;
    }
    /**
     * Merges another document into this document. Any peers we are sharing changes with will be
     * notified of the changes resulting from the merge.
     *
     * @returns the merged document.
     *
     * @throws if either document is not ready or if `otherHandle` is unavailable.
     */
    merge(
    /** the handle of the document to merge into this one */
    otherHandle) {
        if (!this.isReady() || !otherHandle.isReady()) {
            throw new Error("Both handles must be ready to merge");
        }
        const mergingDoc = otherHandle.docSync();
        if (!mergingDoc) {
            throw new Error("The document to be merged in is falsy, aborting.");
        }
        this.update(doc => {
            return merge(doc, mergingDoc);
        });
    }
    /**
     * Used in testing to mark this document as unavailable.
     * @hidden
     */
    unavailable() {
        this.#machine.send({ type: DOC_UNAVAILABLE });
    }
    /** Called by the repo when the document is not found in storage.
     * @hidden
     * */
    request() {
        if (this.#state === "loading")
            this.#machine.send({ type: REQUEST });
    }
    /** @hidden */
    awaitNetwork() {
        if (this.#state === "loading")
            this.#machine.send({ type: AWAIT_NETWORK });
    }
    /** @hidden */
    networkReady() {
        if (this.#state === "awaitingNetwork")
            this.#machine.send({ type: NETWORK_READY });
    }
    /** Called by the repo when the document is deleted. */
    delete() {
        this.#machine.send({ type: DELETE });
    }
    /**
     * Sends an arbitrary ephemeral message out to all reachable peers who would receive sync messages
     * from you. It has no guarantee of delivery, and is not persisted to the underlying automerge doc
     * in any way. Messages will have a sending PeerId but this is *not* a useful user identifier (a
     * user could have multiple tabs open and would appear as multiple PeerIds). Every message source
     * must have a unique PeerId.
     */
    broadcast(message) {
        this.emit("ephemeral-message-outbound", {
            handle: this,
            data: encode(message),
        });
    }
}
// STATE MACHINE TYPES & CONSTANTS
// state
/**
 * Possible internal states for a DocHandle
 */
const HandleState = {
    /** The handle has been created but not yet loaded or requested */
    IDLE: "idle",
    /** We are waiting for storage to finish loading */
    LOADING: "loading",
    /** We are waiting for the network to be come ready */
    AWAITING_NETWORK: "awaitingNetwork",
    /** We are waiting for someone in the network to respond to a sync request */
    REQUESTING: "requesting",
    /** The document is available */
    READY: "ready",
    /** The document has been deleted from the repo */
    DELETED: "deleted",
    /** The document was not available in storage or from any connected peers */
    UNAVAILABLE: "unavailable",
};
const { IDLE, LOADING, AWAITING_NETWORK, REQUESTING, READY, DELETED, UNAVAILABLE, } = HandleState;
const CREATE = "CREATE";
const FIND = "FIND";
const REQUEST = "REQUEST";
const DOC_READY = "DOC_READY";
const AWAIT_NETWORK = "AWAIT_NETWORK";
const NETWORK_READY = "NETWORK_READY";
const UPDATE = "UPDATE";
const DELETE = "DELETE";
const DOC_UNAVAILABLE = "DOC_UNAVAILABLE";

class RemoteHeadsSubscriptions extends EventEmitter {
    // Storage IDs we have received remote heads from
    #knownHeads = new Map();
    // Storage IDs we have subscribed to via Repo.subscribeToRemoteHeads
    #ourSubscriptions = new Set();
    // Storage IDs other peers have subscribed to by sending us a control message
    #theirSubscriptions = new Map();
    // Peers we will always share remote heads with even if they are not subscribed
    #generousPeers = new Set();
    // Documents each peer has open, we need this information so we only send remote heads of documents that the peer knows
    #subscribedDocsByPeer = new Map();
    #log = debug("automerge-repo:remote-heads-subscriptions");
    subscribeToRemotes(remotes) {
        this.#log("subscribeToRemotes", remotes);
        const remotesToAdd = [];
        for (const remote of remotes) {
            if (!this.#ourSubscriptions.has(remote)) {
                this.#ourSubscriptions.add(remote);
                remotesToAdd.push(remote);
            }
        }
        if (remotesToAdd.length > 0) {
            this.emit("change-remote-subs", {
                add: remotesToAdd,
                peers: Array.from(this.#generousPeers),
            });
        }
    }
    unsubscribeFromRemotes(remotes) {
        this.#log("subscribeToRemotes", remotes);
        const remotesToRemove = [];
        for (const remote of remotes) {
            if (this.#ourSubscriptions.has(remote)) {
                this.#ourSubscriptions.delete(remote);
                if (!this.#theirSubscriptions.has(remote)) {
                    remotesToRemove.push(remote);
                }
            }
        }
        if (remotesToRemove.length > 0) {
            this.emit("change-remote-subs", {
                remove: remotesToRemove,
                peers: Array.from(this.#generousPeers),
            });
        }
    }
    handleControlMessage(control) {
        const remotesToAdd = [];
        const remotesToRemove = [];
        const addedRemotesWeKnow = [];
        this.#log("handleControlMessage", control);
        if (control.add) {
            for (const remote of control.add) {
                let theirSubs = this.#theirSubscriptions.get(remote);
                if (this.#ourSubscriptions.has(remote) || theirSubs) {
                    addedRemotesWeKnow.push(remote);
                }
                if (!theirSubs) {
                    theirSubs = new Set();
                    this.#theirSubscriptions.set(remote, theirSubs);
                    if (!this.#ourSubscriptions.has(remote)) {
                        remotesToAdd.push(remote);
                    }
                }
                theirSubs.add(control.senderId);
            }
        }
        if (control.remove) {
            for (const remote of control.remove) {
                const theirSubs = this.#theirSubscriptions.get(remote);
                if (theirSubs) {
                    theirSubs.delete(control.senderId);
                    // if no one is subscribed anymore remove remote
                    if (theirSubs.size == 0 && !this.#ourSubscriptions.has(remote)) {
                        remotesToRemove.push(remote);
                    }
                }
            }
        }
        if (remotesToAdd.length > 0 || remotesToRemove.length > 0) {
            this.emit("change-remote-subs", {
                peers: Array.from(this.#generousPeers),
                add: remotesToAdd,
                remove: remotesToRemove,
            });
        }
        // send all our stored heads of documents the peer knows for the remotes they've added
        for (const remote of addedRemotesWeKnow) {
            const subscribedDocs = this.#subscribedDocsByPeer.get(control.senderId);
            if (subscribedDocs) {
                for (const documentId of subscribedDocs) {
                    const knownHeads = this.#knownHeads.get(documentId);
                    if (!knownHeads) {
                        continue;
                    }
                    const lastHeads = knownHeads.get(remote);
                    if (lastHeads) {
                        this.emit("notify-remote-heads", {
                            targetId: control.senderId,
                            documentId,
                            heads: lastHeads.heads,
                            timestamp: lastHeads.timestamp,
                            storageId: remote,
                        });
                    }
                }
            }
        }
    }
    /** A peer we are not directly connected to has changed their heads */
    handleRemoteHeads(msg) {
        this.#log("handleRemoteHeads", msg);
        const changedHeads = this.#changedHeads(msg);
        // Emit a remote-heads-changed event to update local dochandles
        for (const event of changedHeads) {
            if (this.#ourSubscriptions.has(event.storageId)) {
                this.emit("remote-heads-changed", event);
            }
        }
        // Notify generous peers of these changes regardless of if they are subscribed to us
        for (const event of changedHeads) {
            for (const peer of this.#generousPeers) {
                // don't emit event to sender if sender is a generous peer
                if (peer === msg.senderId) {
                    continue;
                }
                this.emit("notify-remote-heads", {
                    targetId: peer,
                    documentId: event.documentId,
                    heads: event.remoteHeads,
                    timestamp: event.timestamp,
                    storageId: event.storageId,
                });
            }
        }
        // Notify subscribers of these changes
        for (const event of changedHeads) {
            const theirSubs = this.#theirSubscriptions.get(event.storageId);
            if (theirSubs) {
                for (const peerId of theirSubs) {
                    if (this.#isPeerSubscribedToDoc(peerId, event.documentId)) {
                        this.emit("notify-remote-heads", {
                            targetId: peerId,
                            documentId: event.documentId,
                            heads: event.remoteHeads,
                            timestamp: event.timestamp,
                            storageId: event.storageId,
                        });
                    }
                }
            }
        }
    }
    /** A peer we are directly connected to has updated their heads */
    handleImmediateRemoteHeadsChanged(documentId, storageId, heads) {
        this.#log("handleLocalHeadsChanged", documentId, storageId, heads);
        const remote = this.#knownHeads.get(documentId);
        const timestamp = Date.now();
        if (!remote) {
            this.#knownHeads.set(documentId, new Map([[storageId, { heads, timestamp }]]));
        }
        else {
            const docRemote = remote.get(storageId);
            if (!docRemote || docRemote.timestamp < Date.now()) {
                remote.set(storageId, { heads, timestamp: Date.now() });
            }
        }
        const theirSubs = this.#theirSubscriptions.get(storageId);
        if (theirSubs) {
            for (const peerId of theirSubs) {
                if (this.#isPeerSubscribedToDoc(peerId, documentId)) {
                    this.emit("notify-remote-heads", {
                        targetId: peerId,
                        documentId: documentId,
                        heads: heads,
                        timestamp: timestamp,
                        storageId: storageId,
                    });
                }
            }
        }
    }
    addGenerousPeer(peerId) {
        this.#log("addGenerousPeer", peerId);
        this.#generousPeers.add(peerId);
        if (this.#ourSubscriptions.size > 0) {
            this.emit("change-remote-subs", {
                add: Array.from(this.#ourSubscriptions),
                peers: [peerId],
            });
        }
        for (const [documentId, remote] of this.#knownHeads) {
            for (const [storageId, { heads, timestamp }] of remote) {
                this.emit("notify-remote-heads", {
                    targetId: peerId,
                    documentId: documentId,
                    heads: heads,
                    timestamp: timestamp,
                    storageId: storageId,
                });
            }
        }
    }
    removePeer(peerId) {
        this.#log("removePeer", peerId);
        const remotesToRemove = [];
        this.#generousPeers.delete(peerId);
        this.#subscribedDocsByPeer.delete(peerId);
        for (const [storageId, peerIds] of this.#theirSubscriptions) {
            if (peerIds.has(peerId)) {
                peerIds.delete(peerId);
                if (peerIds.size == 0) {
                    remotesToRemove.push(storageId);
                    this.#theirSubscriptions.delete(storageId);
                }
            }
        }
        if (remotesToRemove.length > 0) {
            this.emit("change-remote-subs", {
                remove: remotesToRemove,
                peers: Array.from(this.#generousPeers),
            });
        }
    }
    subscribePeerToDoc(peerId, documentId) {
        let subscribedDocs = this.#subscribedDocsByPeer.get(peerId);
        if (!subscribedDocs) {
            subscribedDocs = new Set();
            this.#subscribedDocsByPeer.set(peerId, subscribedDocs);
        }
        subscribedDocs.add(documentId);
        const remoteHeads = this.#knownHeads.get(documentId);
        if (remoteHeads) {
            for (const [storageId, lastHeads] of remoteHeads) {
                const subscribedPeers = this.#theirSubscriptions.get(storageId);
                if (subscribedPeers && subscribedPeers.has(peerId)) {
                    this.emit("notify-remote-heads", {
                        targetId: peerId,
                        documentId,
                        heads: lastHeads.heads,
                        timestamp: lastHeads.timestamp,
                        storageId,
                    });
                }
            }
        }
    }
    #isPeerSubscribedToDoc(peerId, documentId) {
        const subscribedDocs = this.#subscribedDocsByPeer.get(peerId);
        return subscribedDocs && subscribedDocs.has(documentId);
    }
    /** Returns the (document, storageId) pairs which have changed after processing msg */
    #changedHeads(msg) {
        const changedHeads = [];
        const { documentId, newHeads } = msg;
        for (const [storageId, { heads, timestamp }] of Object.entries(newHeads)) {
            if (!this.#ourSubscriptions.has(storageId) &&
                !this.#theirSubscriptions.has(storageId)) {
                continue;
            }
            let remote = this.#knownHeads.get(documentId);
            if (!remote) {
                remote = new Map();
                this.#knownHeads.set(documentId, remote);
            }
            const docRemote = remote.get(storageId);
            if (docRemote && docRemote.timestamp >= timestamp) {
                continue;
            }
            else {
                remote.set(storageId, { timestamp, heads });
                changedHeads.push({
                    documentId,
                    storageId: storageId,
                    remoteHeads: heads,
                    timestamp,
                });
            }
        }
        return changedHeads;
    }
}

/** Throttle
 * Returns a function with a built in throttle timer that runs after `delay` ms.
 *
 * This function differs from a conventional `throttle` in that it ensures the final
 * call will also execute and delays sending the first one until `delay` ms to allow
 * additional work to accumulate.
 *
 * Here's a diagram:
 *
 * calls +----++++++-----++----
 * dlay  ^--v ^--v^--v   ^--v
 * execs ---+----+---+------+--
 *
 * The goal in this design is to create batches of changes without flooding
 * communication or storage systems while still feeling responsive.
 * (By default we communicate at 10hz / every 100ms.)
 *
 * Note that the args go inside the parameter and you should be careful not to
 * recreate the function on each usage. (In React, see useMemo().)
 *
 *
 * Example usage:
 * const callback = debounce((ev) => { doSomethingExpensiveOrOccasional() }, 100)
 * target.addEventListener('frequent-event', callback);
 *
 */
const throttle = (fn, delay) => {
    let lastCall = Date.now();
    let wait;
    let timeout;
    return function (...args) {
        wait = lastCall + delay - Date.now();
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            fn(...args);
            lastCall = Date.now();
        }, wait);
    };
};

// TYPE GUARDS
const isRepoMessage = (message) => isSyncMessage(message) ||
    isEphemeralMessage(message) ||
    isRequestMessage(message) ||
    isDocumentUnavailableMessage(message) ||
    isRemoteSubscriptionControlMessage(message) ||
    isRemoteHeadsChanged(message);
// prettier-ignore
const isDocumentUnavailableMessage = (msg) => msg.type === "doc-unavailable";
const isRequestMessage = (msg) => msg.type === "request";
const isSyncMessage = (msg) => msg.type === "sync";
const isEphemeralMessage = (msg) => msg.type === "ephemeral";
// prettier-ignore
const isRemoteSubscriptionControlMessage = (msg) => msg.type === "remote-subscription-change";
const isRemoteHeadsChanged = (msg) => msg.type === "remote-heads-changed";

const getEphemeralMessageSource = (message) => `${message.senderId}:${message.sessionId}`;
class NetworkSubsystem extends EventEmitter {
    peerId;
    peerMetadata;
    #log;
    #adaptersByPeer = {};
    #count = 0;
    #sessionId = Math.random().toString(36).slice(2);
    #ephemeralSessionCounts = {};
    #readyAdapterCount = 0;
    #adapters = [];
    constructor(adapters, peerId = randomPeerId(), peerMetadata) {
        super();
        this.peerId = peerId;
        this.peerMetadata = peerMetadata;
        this.#log = debug(`automerge-repo:network:${this.peerId}`);
        adapters.forEach(a => this.addNetworkAdapter(a));
    }
    addNetworkAdapter(networkAdapter) {
        this.#adapters.push(networkAdapter);
        networkAdapter.once("ready", () => {
            this.#readyAdapterCount++;
            this.#log("Adapters ready: ", this.#readyAdapterCount, "/", this.#adapters.length);
            if (this.#readyAdapterCount === this.#adapters.length) {
                this.emit("ready");
            }
        });
        networkAdapter.on("peer-candidate", ({ peerId, peerMetadata }) => {
            this.#log(`peer candidate: ${peerId} `);
            // TODO: This is where authentication would happen
            if (!this.#adaptersByPeer[peerId]) {
                // TODO: handle losing a server here
                this.#adaptersByPeer[peerId] = networkAdapter;
            }
            this.emit("peer", { peerId, peerMetadata });
        });
        networkAdapter.on("peer-disconnected", ({ peerId }) => {
            this.#log(`peer disconnected: ${peerId} `);
            delete this.#adaptersByPeer[peerId];
            this.emit("peer-disconnected", { peerId });
        });
        networkAdapter.on("message", msg => {
            if (!isRepoMessage(msg)) {
                this.#log(`invalid message: ${JSON.stringify(msg)}`);
                return;
            }
            this.#log(`message from ${msg.senderId}`);
            if (isEphemeralMessage(msg)) {
                const source = getEphemeralMessageSource(msg);
                if (this.#ephemeralSessionCounts[source] === undefined ||
                    msg.count > this.#ephemeralSessionCounts[source]) {
                    this.#ephemeralSessionCounts[source] = msg.count;
                    this.emit("message", msg);
                }
                return;
            }
            this.emit("message", msg);
        });
        networkAdapter.on("close", () => {
            this.#log("adapter closed");
            Object.entries(this.#adaptersByPeer).forEach(([peerId, other]) => {
                if (other === networkAdapter) {
                    delete this.#adaptersByPeer[peerId];
                }
            });
        });
        this.peerMetadata
            .then(peerMetadata => {
            networkAdapter.connect(this.peerId, peerMetadata);
        })
            .catch(err => {
            this.#log("error connecting to network", err);
        });
    }
    send(message) {
        const peer = this.#adaptersByPeer[message.targetId];
        if (!peer) {
            this.#log(`Tried to send message but peer not found: ${message.targetId}`);
            return;
        }
        /** Messages come in without a senderId and other required information; this is where we make
         * sure they have everything they need.
         */
        const prepareMessage = (message) => {
            if (message.type === "ephemeral") {
                if ("count" in message) {
                    // existing ephemeral message from another peer; pass on without changes
                    return message;
                }
                else {
                    // new ephemeral message from us; add our senderId as well as a counter and session id
                    return {
                        ...message,
                        count: ++this.#count,
                        sessionId: this.#sessionId,
                        senderId: this.peerId,
                    };
                }
            }
            else {
                // other message type; just add our senderId
                return {
                    ...message,
                    senderId: this.peerId,
                };
            }
        };
        const outbound = prepareMessage(message);
        this.#log("sending message %o", outbound);
        peer.send(outbound);
    }
    isReady = () => {
        return this.#readyAdapterCount === this.#adapters.length;
    };
    whenReady = async () => {
        if (this.isReady()) {
            return;
        }
        else {
            return new Promise(resolve => {
                this.once("ready", () => {
                    resolve();
                });
            });
        }
    };
}
function randomPeerId() {
    return `user-${Math.round(Math.random() * 100000)}`;
}

function mergeArrays(myArrays) {
    // Get the total length of all arrays.
    let length = 0;
    myArrays.forEach(item => {
        length += item.length;
    });
    // Create a new array with total length and merge all source arrays.
    const mergedArray = new Uint8Array(length);
    let offset = 0;
    myArrays.forEach(item => {
        mergedArray.set(item, offset);
        offset += item.length;
    });
    return mergedArray;
}

var sha256$1 = {exports: {}};

var sha256 = sha256$1.exports;

var hasRequiredSha256;

function requireSha256 () {
	if (hasRequiredSha256) return sha256$1.exports;
	hasRequiredSha256 = 1;
	(function (module) {
		(function (root, factory) {
		    // Hack to make all exports of this module sha256 function object properties.
		    var exports = {};
		    factory(exports);
		    var sha256 = exports["default"];
		    for (var k in exports) {
		        sha256[k] = exports[k];
		    }
		        
		    {
		        module.exports = sha256;
		    }
		})(sha256, function(exports) {
		exports.__esModule = true;
		// SHA-256 (+ HMAC and PBKDF2) for JavaScript.
		//
		// Written in 2014-2016 by Dmitry Chestnykh.
		// Public domain, no warranty.
		//
		// Functions (accept and return Uint8Arrays):
		//
		//   sha256(message) -> hash
		//   sha256.hmac(key, message) -> mac
		//   sha256.pbkdf2(password, salt, rounds, dkLen) -> dk
		//
		//  Classes:
		//
		//   new sha256.Hash()
		//   new sha256.HMAC(key)
		//
		exports.digestLength = 32;
		exports.blockSize = 64;
		// SHA-256 constants
		var K = new Uint32Array([
		    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b,
		    0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
		    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7,
		    0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
		    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152,
		    0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
		    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
		    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
		    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
		    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
		    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
		    0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
		    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
		]);
		function hashBlocks(w, v, p, pos, len) {
		    var a, b, c, d, e, f, g, h, u, i, j, t1, t2;
		    while (len >= 64) {
		        a = v[0];
		        b = v[1];
		        c = v[2];
		        d = v[3];
		        e = v[4];
		        f = v[5];
		        g = v[6];
		        h = v[7];
		        for (i = 0; i < 16; i++) {
		            j = pos + i * 4;
		            w[i] = (((p[j] & 0xff) << 24) | ((p[j + 1] & 0xff) << 16) |
		                ((p[j + 2] & 0xff) << 8) | (p[j + 3] & 0xff));
		        }
		        for (i = 16; i < 64; i++) {
		            u = w[i - 2];
		            t1 = (u >>> 17 | u << (32 - 17)) ^ (u >>> 19 | u << (32 - 19)) ^ (u >>> 10);
		            u = w[i - 15];
		            t2 = (u >>> 7 | u << (32 - 7)) ^ (u >>> 18 | u << (32 - 18)) ^ (u >>> 3);
		            w[i] = (t1 + w[i - 7] | 0) + (t2 + w[i - 16] | 0);
		        }
		        for (i = 0; i < 64; i++) {
		            t1 = (((((e >>> 6 | e << (32 - 6)) ^ (e >>> 11 | e << (32 - 11)) ^
		                (e >>> 25 | e << (32 - 25))) + ((e & f) ^ (~e & g))) | 0) +
		                ((h + ((K[i] + w[i]) | 0)) | 0)) | 0;
		            t2 = (((a >>> 2 | a << (32 - 2)) ^ (a >>> 13 | a << (32 - 13)) ^
		                (a >>> 22 | a << (32 - 22))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
		            h = g;
		            g = f;
		            f = e;
		            e = (d + t1) | 0;
		            d = c;
		            c = b;
		            b = a;
		            a = (t1 + t2) | 0;
		        }
		        v[0] += a;
		        v[1] += b;
		        v[2] += c;
		        v[3] += d;
		        v[4] += e;
		        v[5] += f;
		        v[6] += g;
		        v[7] += h;
		        pos += 64;
		        len -= 64;
		    }
		    return pos;
		}
		// Hash implements SHA256 hash algorithm.
		var Hash = /** @class */ (function () {
		    function Hash() {
		        this.digestLength = exports.digestLength;
		        this.blockSize = exports.blockSize;
		        // Note: Int32Array is used instead of Uint32Array for performance reasons.
		        this.state = new Int32Array(8); // hash state
		        this.temp = new Int32Array(64); // temporary state
		        this.buffer = new Uint8Array(128); // buffer for data to hash
		        this.bufferLength = 0; // number of bytes in buffer
		        this.bytesHashed = 0; // number of total bytes hashed
		        this.finished = false; // indicates whether the hash was finalized
		        this.reset();
		    }
		    // Resets hash state making it possible
		    // to re-use this instance to hash other data.
		    Hash.prototype.reset = function () {
		        this.state[0] = 0x6a09e667;
		        this.state[1] = 0xbb67ae85;
		        this.state[2] = 0x3c6ef372;
		        this.state[3] = 0xa54ff53a;
		        this.state[4] = 0x510e527f;
		        this.state[5] = 0x9b05688c;
		        this.state[6] = 0x1f83d9ab;
		        this.state[7] = 0x5be0cd19;
		        this.bufferLength = 0;
		        this.bytesHashed = 0;
		        this.finished = false;
		        return this;
		    };
		    // Cleans internal buffers and re-initializes hash state.
		    Hash.prototype.clean = function () {
		        for (var i = 0; i < this.buffer.length; i++) {
		            this.buffer[i] = 0;
		        }
		        for (var i = 0; i < this.temp.length; i++) {
		            this.temp[i] = 0;
		        }
		        this.reset();
		    };
		    // Updates hash state with the given data.
		    //
		    // Optionally, length of the data can be specified to hash
		    // fewer bytes than data.length.
		    //
		    // Throws error when trying to update already finalized hash:
		    // instance must be reset to use it again.
		    Hash.prototype.update = function (data, dataLength) {
		        if (dataLength === void 0) { dataLength = data.length; }
		        if (this.finished) {
		            throw new Error("SHA256: can't update because hash was finished.");
		        }
		        var dataPos = 0;
		        this.bytesHashed += dataLength;
		        if (this.bufferLength > 0) {
		            while (this.bufferLength < 64 && dataLength > 0) {
		                this.buffer[this.bufferLength++] = data[dataPos++];
		                dataLength--;
		            }
		            if (this.bufferLength === 64) {
		                hashBlocks(this.temp, this.state, this.buffer, 0, 64);
		                this.bufferLength = 0;
		            }
		        }
		        if (dataLength >= 64) {
		            dataPos = hashBlocks(this.temp, this.state, data, dataPos, dataLength);
		            dataLength %= 64;
		        }
		        while (dataLength > 0) {
		            this.buffer[this.bufferLength++] = data[dataPos++];
		            dataLength--;
		        }
		        return this;
		    };
		    // Finalizes hash state and puts hash into out.
		    //
		    // If hash was already finalized, puts the same value.
		    Hash.prototype.finish = function (out) {
		        if (!this.finished) {
		            var bytesHashed = this.bytesHashed;
		            var left = this.bufferLength;
		            var bitLenHi = (bytesHashed / 0x20000000) | 0;
		            var bitLenLo = bytesHashed << 3;
		            var padLength = (bytesHashed % 64 < 56) ? 64 : 128;
		            this.buffer[left] = 0x80;
		            for (var i = left + 1; i < padLength - 8; i++) {
		                this.buffer[i] = 0;
		            }
		            this.buffer[padLength - 8] = (bitLenHi >>> 24) & 0xff;
		            this.buffer[padLength - 7] = (bitLenHi >>> 16) & 0xff;
		            this.buffer[padLength - 6] = (bitLenHi >>> 8) & 0xff;
		            this.buffer[padLength - 5] = (bitLenHi >>> 0) & 0xff;
		            this.buffer[padLength - 4] = (bitLenLo >>> 24) & 0xff;
		            this.buffer[padLength - 3] = (bitLenLo >>> 16) & 0xff;
		            this.buffer[padLength - 2] = (bitLenLo >>> 8) & 0xff;
		            this.buffer[padLength - 1] = (bitLenLo >>> 0) & 0xff;
		            hashBlocks(this.temp, this.state, this.buffer, 0, padLength);
		            this.finished = true;
		        }
		        for (var i = 0; i < 8; i++) {
		            out[i * 4 + 0] = (this.state[i] >>> 24) & 0xff;
		            out[i * 4 + 1] = (this.state[i] >>> 16) & 0xff;
		            out[i * 4 + 2] = (this.state[i] >>> 8) & 0xff;
		            out[i * 4 + 3] = (this.state[i] >>> 0) & 0xff;
		        }
		        return this;
		    };
		    // Returns the final hash digest.
		    Hash.prototype.digest = function () {
		        var out = new Uint8Array(this.digestLength);
		        this.finish(out);
		        return out;
		    };
		    // Internal function for use in HMAC for optimization.
		    Hash.prototype._saveState = function (out) {
		        for (var i = 0; i < this.state.length; i++) {
		            out[i] = this.state[i];
		        }
		    };
		    // Internal function for use in HMAC for optimization.
		    Hash.prototype._restoreState = function (from, bytesHashed) {
		        for (var i = 0; i < this.state.length; i++) {
		            this.state[i] = from[i];
		        }
		        this.bytesHashed = bytesHashed;
		        this.finished = false;
		        this.bufferLength = 0;
		    };
		    return Hash;
		}());
		exports.Hash = Hash;
		// HMAC implements HMAC-SHA256 message authentication algorithm.
		var HMAC = /** @class */ (function () {
		    function HMAC(key) {
		        this.inner = new Hash();
		        this.outer = new Hash();
		        this.blockSize = this.inner.blockSize;
		        this.digestLength = this.inner.digestLength;
		        var pad = new Uint8Array(this.blockSize);
		        if (key.length > this.blockSize) {
		            (new Hash()).update(key).finish(pad).clean();
		        }
		        else {
		            for (var i = 0; i < key.length; i++) {
		                pad[i] = key[i];
		            }
		        }
		        for (var i = 0; i < pad.length; i++) {
		            pad[i] ^= 0x36;
		        }
		        this.inner.update(pad);
		        for (var i = 0; i < pad.length; i++) {
		            pad[i] ^= 0x36 ^ 0x5c;
		        }
		        this.outer.update(pad);
		        this.istate = new Uint32Array(8);
		        this.ostate = new Uint32Array(8);
		        this.inner._saveState(this.istate);
		        this.outer._saveState(this.ostate);
		        for (var i = 0; i < pad.length; i++) {
		            pad[i] = 0;
		        }
		    }
		    // Returns HMAC state to the state initialized with key
		    // to make it possible to run HMAC over the other data with the same
		    // key without creating a new instance.
		    HMAC.prototype.reset = function () {
		        this.inner._restoreState(this.istate, this.inner.blockSize);
		        this.outer._restoreState(this.ostate, this.outer.blockSize);
		        return this;
		    };
		    // Cleans HMAC state.
		    HMAC.prototype.clean = function () {
		        for (var i = 0; i < this.istate.length; i++) {
		            this.ostate[i] = this.istate[i] = 0;
		        }
		        this.inner.clean();
		        this.outer.clean();
		    };
		    // Updates state with provided data.
		    HMAC.prototype.update = function (data) {
		        this.inner.update(data);
		        return this;
		    };
		    // Finalizes HMAC and puts the result in out.
		    HMAC.prototype.finish = function (out) {
		        if (this.outer.finished) {
		            this.outer.finish(out);
		        }
		        else {
		            this.inner.finish(out);
		            this.outer.update(out, this.digestLength).finish(out);
		        }
		        return this;
		    };
		    // Returns message authentication code.
		    HMAC.prototype.digest = function () {
		        var out = new Uint8Array(this.digestLength);
		        this.finish(out);
		        return out;
		    };
		    return HMAC;
		}());
		exports.HMAC = HMAC;
		// Returns SHA256 hash of data.
		function hash(data) {
		    var h = (new Hash()).update(data);
		    var digest = h.digest();
		    h.clean();
		    return digest;
		}
		exports.hash = hash;
		// Function hash is both available as module.hash and as default export.
		exports["default"] = hash;
		// Returns HMAC-SHA256 of data under the key.
		function hmac(key, data) {
		    var h = (new HMAC(key)).update(data);
		    var digest = h.digest();
		    h.clean();
		    return digest;
		}
		exports.hmac = hmac;
		// Fills hkdf buffer like this:
		// T(1) = HMAC-Hash(PRK, T(0) | info | 0x01)
		function fillBuffer(buffer, hmac, info, counter) {
		    // Counter is a byte value: check if it overflowed.
		    var num = counter[0];
		    if (num === 0) {
		        throw new Error("hkdf: cannot expand more");
		    }
		    // Prepare HMAC instance for new data with old key.
		    hmac.reset();
		    // Hash in previous output if it was generated
		    // (i.e. counter is greater than 1).
		    if (num > 1) {
		        hmac.update(buffer);
		    }
		    // Hash in info if it exists.
		    if (info) {
		        hmac.update(info);
		    }
		    // Hash in the counter.
		    hmac.update(counter);
		    // Output result to buffer and clean HMAC instance.
		    hmac.finish(buffer);
		    // Increment counter inside typed array, this works properly.
		    counter[0]++;
		}
		var hkdfSalt = new Uint8Array(exports.digestLength); // Filled with zeroes.
		function hkdf(key, salt, info, length) {
		    if (salt === void 0) { salt = hkdfSalt; }
		    if (length === void 0) { length = 32; }
		    var counter = new Uint8Array([1]);
		    // HKDF-Extract uses salt as HMAC key, and key as data.
		    var okm = hmac(salt, key);
		    // Initialize HMAC for expanding with extracted key.
		    // Ensure no collisions with `hmac` function.
		    var hmac_ = new HMAC(okm);
		    // Allocate buffer.
		    var buffer = new Uint8Array(hmac_.digestLength);
		    var bufpos = buffer.length;
		    var out = new Uint8Array(length);
		    for (var i = 0; i < length; i++) {
		        if (bufpos === buffer.length) {
		            fillBuffer(buffer, hmac_, info, counter);
		            bufpos = 0;
		        }
		        out[i] = buffer[bufpos++];
		    }
		    hmac_.clean();
		    buffer.fill(0);
		    counter.fill(0);
		    return out;
		}
		exports.hkdf = hkdf;
		// Derives a key from password and salt using PBKDF2-HMAC-SHA256
		// with the given number of iterations.
		//
		// The number of bytes returned is equal to dkLen.
		//
		// (For better security, avoid dkLen greater than hash length - 32 bytes).
		function pbkdf2(password, salt, iterations, dkLen) {
		    var prf = new HMAC(password);
		    var len = prf.digestLength;
		    var ctr = new Uint8Array(4);
		    var t = new Uint8Array(len);
		    var u = new Uint8Array(len);
		    var dk = new Uint8Array(dkLen);
		    for (var i = 0; i * len < dkLen; i++) {
		        var c = i + 1;
		        ctr[0] = (c >>> 24) & 0xff;
		        ctr[1] = (c >>> 16) & 0xff;
		        ctr[2] = (c >>> 8) & 0xff;
		        ctr[3] = (c >>> 0) & 0xff;
		        prf.reset();
		        prf.update(salt);
		        prf.update(ctr);
		        prf.finish(u);
		        for (var j = 0; j < len; j++) {
		            t[j] = u[j];
		        }
		        for (var j = 2; j <= iterations; j++) {
		            prf.reset();
		            prf.update(u).finish(u);
		            for (var k = 0; k < len; k++) {
		                t[k] ^= u[k];
		            }
		        }
		        for (var j = 0; j < len && i * len + j < dkLen; j++) {
		            dk[i * len + j] = t[j];
		        }
		    }
		    for (var i = 0; i < len; i++) {
		        t[i] = u[i] = 0;
		    }
		    for (var i = 0; i < 4; i++) {
		        ctr[i] = 0;
		    }
		    prf.clean();
		    return dk;
		}
		exports.pbkdf2 = pbkdf2;
		}); 
	} (sha256$1));
	return sha256$1.exports;
}

var sha256Exports = requireSha256();

function keyHash(binary) {
    // calculate hash
    const hash = sha256Exports.hash(binary);
    return bufferToHexString(hash);
}
function headsHash(heads) {
    const encoder = new TextEncoder();
    const headsbinary = mergeArrays(heads.map((h) => encoder.encode(h)));
    return keyHash(headsbinary);
}
function bufferToHexString(data) {
    return Array.from(data, byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Keys for storing Automerge documents are of the form:
 * ```ts
 * [documentId, "snapshot", hash]  // OR
 * [documentId, "incremental", hash]
 * ```
 * This function returns the chunk type ("snapshot" or "incremental") if the key is in one of these
 * forms.
 */
function chunkTypeFromKey(key) {
    if (key.length < 2)
        return null;
    const chunkTypeStr = key[key.length - 2]; // next-to-last element in key
    if (chunkTypeStr === "snapshot" || chunkTypeStr === "incremental") {
        return chunkTypeStr;
    }
    return null;
}

/**
 * The storage subsystem is responsible for saving and loading Automerge documents to and from
 * storage adapter. It also provides a generic key/value storage interface for other uses.
 */
class StorageSubsystem {
    /** The storage adapter to use for saving and loading documents */
    #storageAdapter;
    /** Record of the latest heads we've loaded or saved for each document  */
    #storedHeads = new Map();
    /** Metadata on the chunks we've already loaded for each document */
    #chunkInfos = new Map();
    /** Flag to avoid compacting when a compaction is already underway */
    #compacting = false;
    #log = debug(`automerge-repo:storage-subsystem`);
    constructor(storageAdapter) {
        this.#storageAdapter = storageAdapter;
    }
    async id() {
        const storedId = await this.#storageAdapter.load(["storage-adapter-id"]);
        let id;
        if (storedId) {
            id = new TextDecoder().decode(storedId);
        }
        else {
            id = v4();
            await this.#storageAdapter.save(["storage-adapter-id"], new TextEncoder().encode(id));
        }
        return id;
    }
    // ARBITRARY KEY/VALUE STORAGE
    // The `load`, `save`, and `remove` methods are for generic key/value storage, as opposed to
    // Automerge documents. For example, they're used by the LocalFirstAuthProvider to persist the
    // encrypted team graph that encodes group membership and permissions.
    //
    // The namespace parameter is to prevent collisions with other users of the storage subsystem.
    // Typically this will be the name of the plug-in, adapter, or other system that is using it. For
    // example, the LocalFirstAuthProvider uses the namespace `LocalFirstAuthProvider`.
    /** Loads a value from storage. */
    async load(
    /** Namespace to prevent collisions with other users of the storage subsystem. */
    namespace, 
    /** Key to load. Typically a UUID or other unique identifier, but could be any string. */
    key) {
        const storageKey = [namespace, key];
        return await this.#storageAdapter.load(storageKey);
    }
    /** Saves a value in storage. */
    async save(
    /** Namespace to prevent collisions with other users of the storage subsystem. */
    namespace, 
    /** Key to load. Typically a UUID or other unique identifier, but could be any string. */
    key, 
    /** Data to save, as a binary blob. */
    data) {
        const storageKey = [namespace, key];
        await this.#storageAdapter.save(storageKey, data);
    }
    /** Removes a value from storage. */
    async remove(
    /** Namespace to prevent collisions with other users of the storage subsystem. */
    namespace, 
    /** Key to remove. Typically a UUID or other unique identifier, but could be any string. */
    key) {
        const storageKey = [namespace, key];
        await this.#storageAdapter.remove(storageKey);
    }
    // AUTOMERGE DOCUMENT STORAGE
    /**
     * Loads the Automerge document with the given ID from storage.
     */
    async loadDoc(documentId) {
        // Load all the chunks for this document
        const chunks = await this.#storageAdapter.loadRange([documentId]);
        const binaries = [];
        const chunkInfos = [];
        for (const chunk of chunks) {
            // chunks might have been deleted in the interim
            if (chunk.data === undefined)
                continue;
            const chunkType = chunkTypeFromKey(chunk.key);
            if (chunkType == null)
                continue;
            chunkInfos.push({
                key: chunk.key,
                type: chunkType,
                size: chunk.data.length,
            });
            binaries.push(chunk.data);
        }
        this.#chunkInfos.set(documentId, chunkInfos);
        // Merge the chunks into a single binary
        const binary = mergeArrays(binaries);
        if (binary.length === 0)
            return null;
        // Load into an Automerge document
        const newDoc = loadIncremental(init(), binary);
        // Record the latest heads for the document
        this.#storedHeads.set(documentId, getHeads(newDoc));
        return newDoc;
    }
    /**
     * Saves the provided Automerge document to storage.
     *
     * @remarks
     * Under the hood this makes incremental saves until the incremental size is greater than the
     * snapshot size, at which point the document is compacted into a single snapshot.
     */
    async saveDoc(documentId, doc) {
        // Don't bother saving if the document hasn't changed
        if (!this.#shouldSave(documentId, doc))
            return;
        const sourceChunks = this.#chunkInfos.get(documentId) ?? [];
        if (this.#shouldCompact(sourceChunks)) {
            await this.#saveTotal(documentId, doc, sourceChunks);
        }
        else {
            await this.#saveIncremental(documentId, doc);
        }
        this.#storedHeads.set(documentId, getHeads(doc));
    }
    /**
     * Removes the Automerge document with the given ID from storage
     */
    async removeDoc(documentId) {
        await this.#storageAdapter.removeRange([documentId, "snapshot"]);
        await this.#storageAdapter.removeRange([documentId, "incremental"]);
        await this.#storageAdapter.removeRange([documentId, "sync-state"]);
    }
    /**
     * Saves just the incremental changes since the last save.
     */
    async #saveIncremental(documentId, doc) {
        const binary = saveSince(doc, this.#storedHeads.get(documentId) ?? []);
        if (binary && binary.length > 0) {
            const key = [documentId, "incremental", keyHash(binary)];
            this.#log(`Saving incremental ${key} for document ${documentId}`);
            await this.#storageAdapter.save(key, binary);
            if (!this.#chunkInfos.has(documentId)) {
                this.#chunkInfos.set(documentId, []);
            }
            this.#chunkInfos.get(documentId).push({
                key,
                type: "incremental",
                size: binary.length,
            });
            this.#storedHeads.set(documentId, getHeads(doc));
        }
        else {
            return Promise.resolve();
        }
    }
    /**
     * Compacts the document storage into a single shapshot.
     */
    async #saveTotal(documentId, doc, sourceChunks) {
        this.#compacting = true;
        const binary = save(doc);
        const snapshotHash = headsHash(getHeads(doc));
        const key = [documentId, "snapshot", snapshotHash];
        const oldKeys = new Set(sourceChunks.map(c => c.key).filter(k => k[2] !== snapshotHash));
        this.#log(`Saving snapshot ${key} for document ${documentId}`);
        this.#log(`deleting old chunks ${Array.from(oldKeys)}`);
        await this.#storageAdapter.save(key, binary);
        for (const key of oldKeys) {
            await this.#storageAdapter.remove(key);
        }
        const newChunkInfos = this.#chunkInfos.get(documentId)?.filter(c => !oldKeys.has(c.key)) ?? [];
        newChunkInfos.push({ key, type: "snapshot", size: binary.length });
        this.#chunkInfos.set(documentId, newChunkInfos);
        this.#compacting = false;
    }
    async loadSyncState(documentId, storageId) {
        const key = [documentId, "sync-state", storageId];
        const loaded = await this.#storageAdapter.load(key);
        return loaded ? decodeSyncState$2(loaded) : undefined;
    }
    async saveSyncState(documentId, storageId, syncState) {
        const key = [documentId, "sync-state", storageId];
        await this.#storageAdapter.save(key, encodeSyncState$2(syncState));
    }
    /**
     * Returns true if the document has changed since the last time it was saved.
     */
    #shouldSave(documentId, doc) {
        const oldHeads = this.#storedHeads.get(documentId);
        if (!oldHeads) {
            // we haven't saved this document before
            return true;
        }
        const newHeads = getHeads(doc);
        if (headsAreSame(newHeads, oldHeads)) {
            // the document hasn't changed
            return false;
        }
        return true; // the document has changed
    }
    /**
     * We only compact if the incremental size is greater than the snapshot size.
     */
    #shouldCompact(sourceChunks) {
        if (this.#compacting)
            return false;
        let snapshotSize = 0;
        let incrementalSize = 0;
        for (const chunk of sourceChunks) {
            if (chunk.type === "snapshot") {
                snapshotSize += chunk.size;
            }
            else {
                incrementalSize += chunk.size;
            }
        }
        // if the file is currently small, don't worry, just compact
        // this might seem a bit arbitrary (1k is arbitrary) but is designed to ensure compaction
        // for documents with only a single large change on top of an empty (or nearly empty) document
        // for example: imported NPM modules, images, etc.
        // if we have even more incrementals (so far) than the snapshot, compact
        return snapshotSize < 1024 || incrementalSize >= snapshotSize;
    }
}

class Synchronizer extends EventEmitter {
}

/**
 * DocSynchronizer takes a handle to an Automerge document, and receives & dispatches sync messages
 * to bring it inline with all other peers' versions.
 */
class DocSynchronizer extends Synchronizer {
    #log;
    syncDebounceRate = 100;
    /** Active peers */
    #peers = [];
    #pendingSyncStateCallbacks = {};
    #peerDocumentStatuses = {};
    /** Sync state for each peer we've communicated with (including inactive peers) */
    #syncStates = {};
    #pendingSyncMessages = [];
    #syncStarted = false;
    #handle;
    #onLoadSyncState;
    constructor({ handle, onLoadSyncState }) {
        super();
        this.#handle = handle;
        this.#onLoadSyncState =
            onLoadSyncState ?? (() => Promise.resolve(undefined));
        const docId = handle.documentId.slice(0, 5);
        this.#log = debug(`automerge-repo:docsync:${docId}`);
        handle.on("change", throttle(() => this.#syncWithPeers(), this.syncDebounceRate));
        handle.on("ephemeral-message-outbound", payload => this.#broadcastToPeers(payload));
        // Process pending sync messages immediately after the handle becomes ready.
        void (async () => {
            await handle.doc([READY, REQUESTING]);
            this.#processAllPendingSyncMessages();
        })();
    }
    get peerStates() {
        return this.#peerDocumentStatuses;
    }
    get documentId() {
        return this.#handle.documentId;
    }
    /// PRIVATE
    async #syncWithPeers() {
        this.#log(`syncWithPeers`);
        const doc = await this.#handle.doc();
        if (doc === undefined)
            return;
        this.#peers.forEach(peerId => this.#sendSyncMessage(peerId, doc));
    }
    async #broadcastToPeers({ data, }) {
        this.#log(`broadcastToPeers`, this.#peers);
        this.#peers.forEach(peerId => this.#sendEphemeralMessage(peerId, data));
    }
    #sendEphemeralMessage(peerId, data) {
        this.#log(`sendEphemeralMessage ->${peerId}`);
        const message = {
            type: "ephemeral",
            targetId: peerId,
            documentId: this.#handle.documentId,
            data,
        };
        this.emit("message", message);
    }
    #withSyncState(peerId, callback) {
        this.#addPeer(peerId);
        if (!(peerId in this.#peerDocumentStatuses)) {
            this.#peerDocumentStatuses[peerId] = "unknown";
        }
        const syncState = this.#syncStates[peerId];
        if (syncState) {
            callback(syncState);
            return;
        }
        let pendingCallbacks = this.#pendingSyncStateCallbacks[peerId];
        if (!pendingCallbacks) {
            this.#onLoadSyncState(peerId)
                .then(syncState => {
                this.#initSyncState(peerId, syncState ?? initSyncState$2());
            })
                .catch(err => {
                this.#log(`Error loading sync state for ${peerId}: ${err}`);
            });
            pendingCallbacks = this.#pendingSyncStateCallbacks[peerId] = [];
        }
        pendingCallbacks.push(callback);
    }
    #addPeer(peerId) {
        if (!this.#peers.includes(peerId)) {
            this.#peers.push(peerId);
            this.emit("open-doc", { documentId: this.documentId, peerId });
        }
    }
    #initSyncState(peerId, syncState) {
        const pendingCallbacks = this.#pendingSyncStateCallbacks[peerId];
        if (pendingCallbacks) {
            for (const callback of pendingCallbacks) {
                callback(syncState);
            }
        }
        delete this.#pendingSyncStateCallbacks[peerId];
        this.#syncStates[peerId] = syncState;
    }
    #setSyncState(peerId, syncState) {
        this.#syncStates[peerId] = syncState;
        this.emit("sync-state", {
            peerId,
            syncState,
            documentId: this.#handle.documentId,
        });
    }
    #sendSyncMessage(peerId, doc) {
        this.#log(`sendSyncMessage ->${peerId}`);
        this.#withSyncState(peerId, syncState => {
            const [newSyncState, message] = generateSyncMessage(doc, syncState);
            if (message) {
                this.#setSyncState(peerId, newSyncState);
                const isNew = getHeads(doc).length === 0;
                if (!this.#handle.isReady() &&
                    isNew &&
                    newSyncState.sharedHeads.length === 0 &&
                    !Object.values(this.#peerDocumentStatuses).includes("has") &&
                    this.#peerDocumentStatuses[peerId] === "unknown") {
                    // we don't have the document (or access to it), so we request it
                    this.emit("message", {
                        type: "request",
                        targetId: peerId,
                        documentId: this.#handle.documentId,
                        data: message,
                    });
                }
                else {
                    this.emit("message", {
                        type: "sync",
                        targetId: peerId,
                        data: message,
                        documentId: this.#handle.documentId,
                    });
                }
                // if we have sent heads, then the peer now has or will have the document
                if (!isNew) {
                    this.#peerDocumentStatuses[peerId] = "has";
                }
            }
        });
    }
    /// PUBLIC
    hasPeer(peerId) {
        return this.#peers.includes(peerId);
    }
    beginSync(peerIds) {
        const noPeersWithDocument = peerIds.every(peerId => this.#peerDocumentStatuses[peerId] in ["unavailable", "wants"]);
        // At this point if we don't have anything in our storage, we need to use an empty doc to sync
        // with; but we don't want to surface that state to the front end
        const docPromise = this.#handle
            .doc([READY, REQUESTING, UNAVAILABLE])
            .then(doc => {
            // we register out peers first, then say that sync has started
            this.#syncStarted = true;
            this.#checkDocUnavailable();
            const wasUnavailable = doc === undefined;
            if (wasUnavailable && noPeersWithDocument) {
                return;
            }
            // If the doc is unavailable we still need a blank document to generate
            // the sync message from
            return doc ?? init();
        });
        this.#log(`beginSync: ${peerIds.join(", ")}`);
        peerIds.forEach(peerId => {
            this.#withSyncState(peerId, syncState => {
                // HACK: if we have a sync state already, we round-trip it through the encoding system to make
                // sure state is preserved. This prevents an infinite loop caused by failed attempts to send
                // messages during disconnection.
                // TODO: cover that case with a test and remove this hack
                const reparsedSyncState = decodeSyncState$2(encodeSyncState$2(syncState));
                this.#setSyncState(peerId, reparsedSyncState);
                docPromise
                    .then(doc => {
                    if (doc) {
                        this.#sendSyncMessage(peerId, doc);
                    }
                })
                    .catch(err => {
                    this.#log(`Error loading doc for ${peerId}: ${err}`);
                });
            });
        });
    }
    endSync(peerId) {
        this.#log(`removing peer ${peerId}`);
        this.#peers = this.#peers.filter(p => p !== peerId);
    }
    receiveMessage(message) {
        switch (message.type) {
            case "sync":
            case "request":
                this.receiveSyncMessage(message);
                break;
            case "ephemeral":
                this.receiveEphemeralMessage(message);
                break;
            case "doc-unavailable":
                this.#peerDocumentStatuses[message.senderId] = "unavailable";
                this.#checkDocUnavailable();
                break;
            default:
                throw new Error(`unknown message type: ${message}`);
        }
    }
    receiveEphemeralMessage(message) {
        if (message.documentId !== this.#handle.documentId)
            throw new Error(`channelId doesn't match documentId`);
        const { senderId, data } = message;
        const contents = decode$1(new Uint8Array(data));
        this.#handle.emit("ephemeral-message", {
            handle: this.#handle,
            senderId,
            message: contents,
        });
        this.#peers.forEach(peerId => {
            if (peerId === senderId)
                return;
            this.emit("message", {
                ...message,
                targetId: peerId,
            });
        });
    }
    receiveSyncMessage(message) {
        if (message.documentId !== this.#handle.documentId)
            throw new Error(`channelId doesn't match documentId`);
        // We need to block receiving the syncMessages until we've checked local storage
        if (!this.#handle.inState([READY, REQUESTING, UNAVAILABLE])) {
            this.#pendingSyncMessages.push({ message, received: new Date() });
            return;
        }
        this.#processAllPendingSyncMessages();
        this.#processSyncMessage(message);
    }
    #processSyncMessage(message) {
        if (isRequestMessage(message)) {
            this.#peerDocumentStatuses[message.senderId] = "wants";
        }
        this.#checkDocUnavailable();
        // if the message has heads, then the peer has the document
        if (decodeSyncMessage$2(message.data).heads.length > 0) {
            this.#peerDocumentStatuses[message.senderId] = "has";
        }
        this.#withSyncState(message.senderId, syncState => {
            this.#handle.update(doc => {
                const [newDoc, newSyncState] = receiveSyncMessage(doc, syncState, message.data);
                this.#setSyncState(message.senderId, newSyncState);
                // respond to just this peer (as required)
                this.#sendSyncMessage(message.senderId, doc);
                return newDoc;
            });
            this.#checkDocUnavailable();
        });
    }
    #checkDocUnavailable() {
        // if we know none of the peers have the document, tell all our peers that we don't either
        if (this.#syncStarted &&
            this.#handle.inState([REQUESTING]) &&
            this.#peers.every(peerId => this.#peerDocumentStatuses[peerId] === "unavailable" ||
                this.#peerDocumentStatuses[peerId] === "wants")) {
            this.#peers
                .filter(peerId => this.#peerDocumentStatuses[peerId] === "wants")
                .forEach(peerId => {
                const message = {
                    type: "doc-unavailable",
                    documentId: this.#handle.documentId,
                    targetId: peerId,
                };
                this.emit("message", message);
            });
            this.#handle.unavailable();
        }
    }
    #processAllPendingSyncMessages() {
        for (const message of this.#pendingSyncMessages) {
            this.#processSyncMessage(message.message);
        }
        this.#pendingSyncMessages = [];
    }
}

const log = debug("automerge-repo:collectionsync");
/** A CollectionSynchronizer is responsible for synchronizing a DocCollection with peers. */
class CollectionSynchronizer extends Synchronizer {
    repo;
    /** The set of peers we are connected with */
    #peers = new Set();
    /** A map of documentIds to their synchronizers */
    #docSynchronizers = {};
    /** Used to determine if the document is know to the Collection and a synchronizer exists or is being set up */
    #docSetUp = {};
    constructor(repo) {
        super();
        this.repo = repo;
    }
    /** Returns a synchronizer for the given document, creating one if it doesn't already exist.  */
    #fetchDocSynchronizer(documentId) {
        if (!this.#docSynchronizers[documentId]) {
            const handle = this.repo.find(stringifyAutomergeUrl({ documentId }));
            this.#docSynchronizers[documentId] = this.#initDocSynchronizer(handle);
        }
        return this.#docSynchronizers[documentId];
    }
    /** Creates a new docSynchronizer and sets it up to propagate messages */
    #initDocSynchronizer(handle) {
        const docSynchronizer = new DocSynchronizer({
            handle,
            onLoadSyncState: async (peerId) => {
                if (!this.repo.storageSubsystem) {
                    return;
                }
                const { storageId, isEphemeral } = this.repo.peerMetadataByPeerId[peerId] || {};
                if (!storageId || isEphemeral) {
                    return;
                }
                return this.repo.storageSubsystem.loadSyncState(handle.documentId, storageId);
            },
        });
        docSynchronizer.on("message", event => this.emit("message", event));
        docSynchronizer.on("open-doc", event => this.emit("open-doc", event));
        docSynchronizer.on("sync-state", event => this.emit("sync-state", event));
        return docSynchronizer;
    }
    /** returns an array of peerIds that we share this document generously with */
    async #documentGenerousPeers(documentId) {
        const peers = Array.from(this.#peers);
        const generousPeers = [];
        for (const peerId of peers) {
            const okToShare = await this.repo.sharePolicy(peerId, documentId);
            if (okToShare)
                generousPeers.push(peerId);
        }
        return generousPeers;
    }
    // PUBLIC
    /**
     * When we receive a sync message for a document we haven't got in memory, we
     * register it with the repo and start synchronizing
     */
    async receiveMessage(message) {
        log(`onSyncMessage: ${message.senderId}, ${message.documentId}, ${"data" in message ? message.data.byteLength + "bytes" : ""}`);
        const documentId = message.documentId;
        if (!documentId) {
            throw new Error("received a message with an invalid documentId");
        }
        this.#docSetUp[documentId] = true;
        const docSynchronizer = this.#fetchDocSynchronizer(documentId);
        docSynchronizer.receiveMessage(message);
        // Initiate sync with any new peers
        const peers = await this.#documentGenerousPeers(documentId);
        docSynchronizer.beginSync(peers.filter(peerId => !docSynchronizer.hasPeer(peerId)));
    }
    /**
     * Starts synchronizing the given document with all peers that we share it generously with.
     */
    addDocument(documentId) {
        // HACK: this is a hack to prevent us from adding the same document twice
        if (this.#docSetUp[documentId]) {
            return;
        }
        const docSynchronizer = this.#fetchDocSynchronizer(documentId);
        void this.#documentGenerousPeers(documentId).then(peers => {
            docSynchronizer.beginSync(peers);
        });
    }
    // TODO: implement this
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    removeDocument(documentId) {
        throw new Error("not implemented");
    }
    /** Adds a peer and maybe starts synchronizing with them */
    addPeer(peerId) {
        log(`adding ${peerId} & synchronizing with them`);
        if (this.#peers.has(peerId)) {
            return;
        }
        this.#peers.add(peerId);
        for (const docSynchronizer of Object.values(this.#docSynchronizers)) {
            const { documentId } = docSynchronizer;
            void this.repo.sharePolicy(peerId, documentId).then(okToShare => {
                if (okToShare)
                    docSynchronizer.beginSync([peerId]);
            });
        }
    }
    /** Removes a peer and stops synchronizing with them */
    removePeer(peerId) {
        log(`removing peer ${peerId}`);
        this.#peers.delete(peerId);
        for (const docSynchronizer of Object.values(this.#docSynchronizers)) {
            docSynchronizer.endSync(peerId);
        }
    }
    /** Returns a list of all connected peer ids */
    get peers() {
        return Array.from(this.#peers);
    }
}

/** A Repo is a collection of documents with networking, syncing, and storage capabilities. */
/** The `Repo` is the main entry point of this library
 *
 * @remarks
 * To construct a `Repo` you will need an {@link StorageAdapter} and one or
 * more {@link NetworkAdapter}s. Once you have a `Repo` you can use it to
 * obtain {@link DocHandle}s.
 */
class Repo extends EventEmitter {
    #log;
    /** @hidden */
    networkSubsystem;
    /** @hidden */
    storageSubsystem;
    /** The debounce rate is adjustable on the repo. */
    /** @hidden */
    saveDebounceRate = 100;
    #handleCache = {};
    #synchronizer;
    /** By default, we share generously with all peers. */
    /** @hidden */
    sharePolicy = async () => true;
    /** maps peer id to to persistence information (storageId, isEphemeral), access by collection synchronizer  */
    /** @hidden */
    peerMetadataByPeerId = {};
    #remoteHeadsSubscriptions = new RemoteHeadsSubscriptions();
    #remoteHeadsGossipingEnabled = false;
    constructor({ storage, network = [], peerId, sharePolicy, isEphemeral = storage === undefined, enableRemoteHeadsGossiping = false, } = {}) {
        super();
        this.#remoteHeadsGossipingEnabled = enableRemoteHeadsGossiping;
        this.#log = debug(`automerge-repo:repo`);
        this.sharePolicy = sharePolicy ?? this.sharePolicy;
        // DOC COLLECTION
        // The `document` event is fired by the DocCollection any time we create a new document or look
        // up a document by ID. We listen for it in order to wire up storage and network synchronization.
        this.on("document", async ({ handle, isNew }) => {
            if (storageSubsystem) {
                // Save when the document changes, but no more often than saveDebounceRate.
                const saveFn = ({ handle, doc, }) => {
                    void storageSubsystem.saveDoc(handle.documentId, doc);
                };
                handle.on("heads-changed", throttle(saveFn, this.saveDebounceRate));
                if (isNew) {
                    // this is a new document, immediately save it
                    await storageSubsystem.saveDoc(handle.documentId, handle.docSync());
                }
                else {
                    // Try to load from disk
                    const loadedDoc = await storageSubsystem.loadDoc(handle.documentId);
                    if (loadedDoc) {
                        handle.update(() => loadedDoc);
                    }
                }
            }
            handle.on("unavailable", () => {
                this.#log("document unavailable", { documentId: handle.documentId });
                this.emit("unavailable-document", {
                    documentId: handle.documentId,
                });
            });
            if (this.networkSubsystem.isReady()) {
                handle.request();
            }
            else {
                handle.awaitNetwork();
                this.networkSubsystem
                    .whenReady()
                    .then(() => {
                    handle.networkReady();
                })
                    .catch(err => {
                    this.#log("error waiting for network", { err });
                });
            }
            // Register the document with the synchronizer. This advertises our interest in the document.
            this.#synchronizer.addDocument(handle.documentId);
        });
        this.on("delete-document", ({ documentId }) => {
            // TODO Pass the delete on to the network
            // synchronizer.removeDocument(documentId)
            if (storageSubsystem) {
                storageSubsystem.removeDoc(documentId).catch(err => {
                    this.#log("error deleting document", { documentId, err });
                });
            }
        });
        // SYNCHRONIZER
        // The synchronizer uses the network subsystem to keep documents in sync with peers.
        this.#synchronizer = new CollectionSynchronizer(this);
        // When the synchronizer emits messages, send them to peers
        this.#synchronizer.on("message", message => {
            this.#log(`sending ${message.type} message to ${message.targetId}`);
            networkSubsystem.send(message);
        });
        if (this.#remoteHeadsGossipingEnabled) {
            this.#synchronizer.on("open-doc", ({ peerId, documentId }) => {
                this.#remoteHeadsSubscriptions.subscribePeerToDoc(peerId, documentId);
            });
        }
        // STORAGE
        // The storage subsystem has access to some form of persistence, and deals with save and loading documents.
        const storageSubsystem = storage ? new StorageSubsystem(storage) : undefined;
        this.storageSubsystem = storageSubsystem;
        // NETWORK
        // The network subsystem deals with sending and receiving messages to and from peers.
        const myPeerMetadata = (async () => ({
            storageId: await storageSubsystem?.id(),
            isEphemeral,
        }))();
        const networkSubsystem = new NetworkSubsystem(network, peerId, myPeerMetadata);
        this.networkSubsystem = networkSubsystem;
        // When we get a new peer, register it with the synchronizer
        networkSubsystem.on("peer", async ({ peerId, peerMetadata }) => {
            this.#log("peer connected", { peerId });
            if (peerMetadata) {
                this.peerMetadataByPeerId[peerId] = { ...peerMetadata };
            }
            this.sharePolicy(peerId)
                .then(shouldShare => {
                if (shouldShare && this.#remoteHeadsGossipingEnabled) {
                    this.#remoteHeadsSubscriptions.addGenerousPeer(peerId);
                }
            })
                .catch(err => {
                console.log("error in share policy", { err });
            });
            this.#synchronizer.addPeer(peerId);
        });
        // When a peer disconnects, remove it from the synchronizer
        networkSubsystem.on("peer-disconnected", ({ peerId }) => {
            this.#synchronizer.removePeer(peerId);
            this.#remoteHeadsSubscriptions.removePeer(peerId);
        });
        // Handle incoming messages
        networkSubsystem.on("message", async (msg) => {
            this.#receiveMessage(msg);
        });
        this.#synchronizer.on("sync-state", message => {
            this.#saveSyncState(message);
            const handle = this.#handleCache[message.documentId];
            const { storageId } = this.peerMetadataByPeerId[message.peerId] || {};
            if (!storageId) {
                return;
            }
            const heads = handle.getRemoteHeads(storageId);
            const haveHeadsChanged = message.syncState.theirHeads &&
                (!heads || !headsAreSame(heads, message.syncState.theirHeads));
            if (haveHeadsChanged && message.syncState.theirHeads) {
                handle.setRemoteHeads(storageId, message.syncState.theirHeads);
                if (storageId && this.#remoteHeadsGossipingEnabled) {
                    this.#remoteHeadsSubscriptions.handleImmediateRemoteHeadsChanged(message.documentId, storageId, message.syncState.theirHeads);
                }
            }
        });
        if (this.#remoteHeadsGossipingEnabled) {
            this.#remoteHeadsSubscriptions.on("notify-remote-heads", message => {
                this.networkSubsystem.send({
                    type: "remote-heads-changed",
                    targetId: message.targetId,
                    documentId: message.documentId,
                    newHeads: {
                        [message.storageId]: {
                            heads: message.heads,
                            timestamp: message.timestamp,
                        },
                    },
                });
            });
            this.#remoteHeadsSubscriptions.on("change-remote-subs", message => {
                this.#log("change-remote-subs", message);
                for (const peer of message.peers) {
                    this.networkSubsystem.send({
                        type: "remote-subscription-change",
                        targetId: peer,
                        add: message.add,
                        remove: message.remove,
                    });
                }
            });
            this.#remoteHeadsSubscriptions.on("remote-heads-changed", message => {
                const handle = this.#handleCache[message.documentId];
                handle.setRemoteHeads(message.storageId, message.remoteHeads);
            });
        }
    }
    #receiveMessage(message) {
        switch (message.type) {
            case "remote-subscription-change":
                if (this.#remoteHeadsGossipingEnabled) {
                    this.#remoteHeadsSubscriptions.handleControlMessage(message);
                }
                break;
            case "remote-heads-changed":
                if (this.#remoteHeadsGossipingEnabled) {
                    this.#remoteHeadsSubscriptions.handleRemoteHeads(message);
                }
                break;
            case "sync":
            case "request":
            case "ephemeral":
            case "doc-unavailable":
                this.#synchronizer.receiveMessage(message).catch(err => {
                    console.log("error receiving message", { err });
                });
        }
    }
    #throttledSaveSyncStateHandlers = {};
    /** saves sync state throttled per storage id, if a peer doesn't have a storage id it's sync state is not persisted */
    #saveSyncState(payload) {
        if (!this.storageSubsystem) {
            return;
        }
        const { storageId, isEphemeral } = this.peerMetadataByPeerId[payload.peerId] || {};
        if (!storageId || isEphemeral) {
            return;
        }
        let handler = this.#throttledSaveSyncStateHandlers[storageId];
        if (!handler) {
            handler = this.#throttledSaveSyncStateHandlers[storageId] = throttle(({ documentId, syncState }) => {
                void this.storageSubsystem.saveSyncState(documentId, storageId, syncState);
            }, this.saveDebounceRate);
        }
        handler(payload);
    }
    /** Returns an existing handle if we have it; creates one otherwise. */
    #getHandle({ documentId, isNew, initialValue, }) {
        // If we have the handle cached, return it
        if (this.#handleCache[documentId])
            return this.#handleCache[documentId];
        // If not, create a new handle, cache it, and return it
        if (!documentId)
            throw new Error(`Invalid documentId ${documentId}`);
        const handle = new DocHandle(documentId, { isNew, initialValue });
        this.#handleCache[documentId] = handle;
        return handle;
    }
    /** Returns all the handles we have cached. */
    get handles() {
        return this.#handleCache;
    }
    /** Returns a list of all connected peer ids */
    get peers() {
        return this.#synchronizer.peers;
    }
    getStorageIdOfPeer(peerId) {
        return this.peerMetadataByPeerId[peerId]?.storageId;
    }
    /**
     * Creates a new document and returns a handle to it. The initial value of the document is an
     * empty object `{}` unless an initial value is provided. Its documentId is generated by the
     * system. we emit a `document` event to advertise interest in the document.
     */
    create(initialValue) {
        // Generate a new UUID and store it in the buffer
        const { documentId } = parseAutomergeUrl(generateAutomergeUrl());
        const handle = this.#getHandle({
            documentId,
            isNew: true,
            initialValue,
        });
        this.emit("document", { handle, isNew: true });
        return handle;
    }
    /** Create a new DocHandle by cloning the history of an existing DocHandle.
     *
     * @param clonedHandle - The handle to clone
     *
     * @remarks This is a wrapper around the `clone` function in the Automerge library.
     * The new `DocHandle` will have a new URL but will share history with the original,
     * which means that changes made to the cloned handle can be sensibly merged back
     * into the original.
     *
     * Any peers this `Repo` is connected to for whom `sharePolicy` returns `true` will
     * be notified of the newly created DocHandle.
     *
     * @throws if the cloned handle is not yet ready or if
     * `clonedHandle.docSync()` returns `undefined` (i.e. the handle is unavailable).
     */
    clone(clonedHandle) {
        if (!clonedHandle.isReady()) {
            throw new Error(`Cloned handle is not yet in ready state.
        (Try await handle.waitForReady() first.)`);
        }
        const sourceDoc = clonedHandle.docSync();
        if (!sourceDoc) {
            throw new Error("Cloned handle doesn't have a document.");
        }
        const handle = this.create();
        handle.update(() => {
            // we replace the document with the new cloned one
            return clone(sourceDoc);
        });
        return handle;
    }
    /**
     * Retrieves a document by id. It gets data from the local system, but also emits a `document`
     * event to advertise interest in the document.
     */
    find(
    /** The url or documentId of the handle to retrieve */
    id) {
        const documentId = interpretAsDocumentId(id);
        // If we have the handle cached, return it
        if (this.#handleCache[documentId]) {
            if (this.#handleCache[documentId].isUnavailable()) {
                // this ensures that the event fires after the handle has been returned
                setTimeout(() => {
                    this.#handleCache[documentId].emit("unavailable", {
                        handle: this.#handleCache[documentId],
                    });
                });
            }
            return this.#handleCache[documentId];
        }
        const handle = this.#getHandle({
            documentId,
            isNew: false,
        });
        this.emit("document", { handle, isNew: false });
        return handle;
    }
    delete(
    /** The url or documentId of the handle to delete */
    id) {
        const documentId = interpretAsDocumentId(id);
        const handle = this.#getHandle({ documentId, isNew: false });
        handle.delete();
        delete this.#handleCache[documentId];
        this.emit("delete-document", { documentId });
    }
    /**
     * Exports a document to a binary format.
     * @param id - The url or documentId of the handle to export
     *
     * @returns Promise<Uint8Array | undefined> - A Promise containing the binary document,
     * or undefined if the document is unavailable.
     */
    async export(id) {
        const documentId = interpretAsDocumentId(id);
        const handle = this.#getHandle({ documentId, isNew: false });
        const doc = await handle.doc();
        if (!doc)
            return undefined;
        return save(doc);
    }
    /**
     * Imports document binary into the repo.
     * @param binary - The binary to import
     */
    import(binary) {
        const doc = load$2(binary);
        const handle = this.create();
        handle.update(() => {
            return clone(doc);
        });
        return handle;
    }
    subscribeToRemotes = (remotes) => {
        if (this.#remoteHeadsGossipingEnabled) {
            this.#log("subscribeToRemotes", { remotes });
            this.#remoteHeadsSubscriptions.subscribeToRemotes(remotes);
        }
        else {
            this.#log("WARN: subscribeToRemotes called but remote heads gossiping is not enabled");
        }
    };
    storageId = async () => {
        if (!this.storageSubsystem) {
            return undefined;
        }
        else {
            return this.storageSubsystem.id();
        }
    };
    /**
     * Writes Documents to a disk.
     * @hidden this API is experimental and may change.
     * @param documents - if provided, only writes the specified documents.
     * @returns Promise<void>
     */
    async flush(documents) {
        if (!this.storageSubsystem) {
            return;
        }
        const handles = documents
            ? documents.map(id => this.#handleCache[id])
            : Object.values(this.#handleCache);
        await Promise.all(handles.map(async (handle) => {
            const doc = handle.docSync();
            if (!doc) {
                return;
            }
            return this.storageSubsystem.saveDoc(handle.documentId, doc);
        }));
    }
}

/* c8 ignore start */
/** An interface representing some way to connect to other peers
 *
 * @remarks
 * The {@link Repo} uses one or more `NetworkAdapter`s to connect to other peers.
 * Because the network may take some time to be ready the {@link Repo} will wait
 * until the adapter emits a `ready` event before it starts trying to use it
 *
 * This utility class can be used as a base to build a custom network adapter. It
 * is most useful as a simple way to add the necessary event emitter functionality
 */
class NetworkAdapter extends EventEmitter {
    peerId;
    peerMetadata;
}

const __vite__wasmUrl = ""+new URL('automerge_wasm_bg-BEjDkhWo.wasm', import.meta.url).href+"";

const __vite__initWasm = async (opts = {}, url) => {
    let result;
    if (url.startsWith("data:")) {
        const urlContent = url.replace(/^data:.*?base64,/, "");
        let bytes;
        if (typeof Buffer === "function" && typeof Buffer.from === "function") {
            bytes = Buffer.from(urlContent, "base64");
        }
        else if (typeof atob === "function") {
            const binaryString = atob(urlContent);
            bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
        }
        else {
            throw new Error("Cannot decode base64-encoded data URL");
        }
        result = await WebAssembly.instantiate(bytes, opts);
    }
    else {
        // https://github.com/mdn/webassembly-examples/issues/5
        // WebAssembly.instantiateStreaming requires the server to provide the
        // correct MIME type for .wasm files, which unfortunately doesn't work for
        // a lot of static file servers, so we just work around it by getting the
        // raw buffer.
        // @ts-ignore
        const response = await fetch(url);
        const contentType = response.headers.get("Content-Type") || "";
        if ("instantiateStreaming" in WebAssembly && contentType.startsWith("application/wasm")) {
            result = await WebAssembly.instantiateStreaming(response, opts);
        }
        else {
            const buffer = await response.arrayBuffer();
            result = await WebAssembly.instantiate(buffer, opts);
        }
    }
    return result.instance.exports;
};

let wasm$1;
function __wbg_set_wasm(val) {
    wasm$1 = val;
}


const heap = new Array(128).fill(undefined);

heap.push(undefined, null, true, false);

function getObject(idx) { return heap[idx]; }

let heap_next = heap.length;

function dropObject(idx) {
    if (idx < 132) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

let WASM_VECTOR_LEN = 0;

let cachedUint8Memory0 = null;

function getUint8Memory0() {
    if (cachedUint8Memory0 === null || cachedUint8Memory0.byteLength === 0) {
        cachedUint8Memory0 = new Uint8Array(wasm$1.memory.buffer);
    }
    return cachedUint8Memory0;
}

const lTextEncoder = typeof TextEncoder === 'undefined' ? (0, module.require)('util').TextEncoder : TextEncoder;

let cachedTextEncoder = new lTextEncoder('utf-8');

const encodeString = (typeof cachedTextEncoder.encodeInto === 'function'
    ? function (arg, view) {
    return cachedTextEncoder.encodeInto(arg, view);
}
    : function (arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
        read: arg.length,
        written: buf.length
    };
});

function passStringToWasm0(arg, malloc, realloc) {

    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8Memory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8Memory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }

    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8Memory0().subarray(ptr + offset, ptr + len);
        const ret = encodeString(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

let cachedInt32Memory0 = null;

function getInt32Memory0() {
    if (cachedInt32Memory0 === null || cachedInt32Memory0.byteLength === 0) {
        cachedInt32Memory0 = new Int32Array(wasm$1.memory.buffer);
    }
    return cachedInt32Memory0;
}

const lTextDecoder = typeof TextDecoder === 'undefined' ? (0, module.require)('util').TextDecoder : TextDecoder;

let cachedTextDecoder = new lTextDecoder('utf-8', { ignoreBOM: true, fatal: true });

cachedTextDecoder.decode();

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return cachedTextDecoder.decode(getUint8Memory0().subarray(ptr, ptr + len));
}

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

let cachedFloat64Memory0 = null;

function getFloat64Memory0() {
    if (cachedFloat64Memory0 === null || cachedFloat64Memory0.byteLength === 0) {
        cachedFloat64Memory0 = new Float64Array(wasm$1.memory.buffer);
    }
    return cachedFloat64Memory0;
}

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
    return instance.ptr;
}
/**
* @param {any} options
* @returns {Automerge}
*/
function create$1(options) {
    try {
        const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
        wasm$1.create(retptr, addHeapObject(options));
        var r0 = getInt32Memory0()[retptr / 4 + 0];
        var r1 = getInt32Memory0()[retptr / 4 + 1];
        var r2 = getInt32Memory0()[retptr / 4 + 2];
        if (r2) {
            throw takeObject(r1);
        }
        return Automerge.__wrap(r0);
    } finally {
        wasm$1.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
* @param {Uint8Array} data
* @param {any} options
* @returns {Automerge}
*/
function load$1(data, options) {
    try {
        const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
        wasm$1.load(retptr, addHeapObject(data), addHeapObject(options));
        var r0 = getInt32Memory0()[retptr / 4 + 0];
        var r1 = getInt32Memory0()[retptr / 4 + 1];
        var r2 = getInt32Memory0()[retptr / 4 + 2];
        if (r2) {
            throw takeObject(r1);
        }
        return Automerge.__wrap(r0);
    } finally {
        wasm$1.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
* @param {any} change
* @returns {Uint8Array}
*/
function encodeChange$1(change) {
    try {
        const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
        wasm$1.encodeChange(retptr, addHeapObject(change));
        var r0 = getInt32Memory0()[retptr / 4 + 0];
        var r1 = getInt32Memory0()[retptr / 4 + 1];
        var r2 = getInt32Memory0()[retptr / 4 + 2];
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm$1.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
* @param {Uint8Array} change
* @returns {any}
*/
function decodeChange$1(change) {
    try {
        const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
        wasm$1.decodeChange(retptr, addHeapObject(change));
        var r0 = getInt32Memory0()[retptr / 4 + 0];
        var r1 = getInt32Memory0()[retptr / 4 + 1];
        var r2 = getInt32Memory0()[retptr / 4 + 2];
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm$1.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
* @returns {SyncState}
*/
function initSyncState$1() {
    const ret = wasm$1.initSyncState();
    return SyncState.__wrap(ret);
}

/**
* @param {any} state
* @returns {SyncState}
*/
function importSyncState$1(state) {
    try {
        const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
        wasm$1.importSyncState(retptr, addHeapObject(state));
        var r0 = getInt32Memory0()[retptr / 4 + 0];
        var r1 = getInt32Memory0()[retptr / 4 + 1];
        var r2 = getInt32Memory0()[retptr / 4 + 2];
        if (r2) {
            throw takeObject(r1);
        }
        return SyncState.__wrap(r0);
    } finally {
        wasm$1.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
* @param {SyncState} state
* @returns {any}
*/
function exportSyncState$1(state) {
    _assertClass(state, SyncState);
    const ret = wasm$1.exportSyncState(state.__wbg_ptr);
    return takeObject(ret);
}

/**
* @param {any} message
* @returns {Uint8Array}
*/
function encodeSyncMessage$1(message) {
    try {
        const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
        wasm$1.encodeSyncMessage(retptr, addHeapObject(message));
        var r0 = getInt32Memory0()[retptr / 4 + 0];
        var r1 = getInt32Memory0()[retptr / 4 + 1];
        var r2 = getInt32Memory0()[retptr / 4 + 2];
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm$1.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
* @param {Uint8Array} msg
* @returns {any}
*/
function decodeSyncMessage$1(msg) {
    try {
        const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
        wasm$1.decodeSyncMessage(retptr, addHeapObject(msg));
        var r0 = getInt32Memory0()[retptr / 4 + 0];
        var r1 = getInt32Memory0()[retptr / 4 + 1];
        var r2 = getInt32Memory0()[retptr / 4 + 2];
        if (r2) {
            throw takeObject(r1);
        }
        return takeObject(r0);
    } finally {
        wasm$1.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
* @param {SyncState} state
* @returns {Uint8Array}
*/
function encodeSyncState$1(state) {
    _assertClass(state, SyncState);
    const ret = wasm$1.encodeSyncState(state.__wbg_ptr);
    return takeObject(ret);
}

/**
* @param {Uint8Array} data
* @returns {SyncState}
*/
function decodeSyncState$1(data) {
    try {
        const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
        wasm$1.decodeSyncState(retptr, addHeapObject(data));
        var r0 = getInt32Memory0()[retptr / 4 + 0];
        var r1 = getInt32Memory0()[retptr / 4 + 1];
        var r2 = getInt32Memory0()[retptr / 4 + 2];
        if (r2) {
            throw takeObject(r1);
        }
        return SyncState.__wrap(r0);
    } finally {
        wasm$1.__wbindgen_add_to_stack_pointer(16);
    }
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        wasm$1.__wbindgen_exn_store(addHeapObject(e));
    }
}
/**
* How text is represented in materialized objects on the JS side
*/
const TextRepresentation = Object.freeze({
/**
* As an array of characters and objects
*/
Array:0,"0":"Array",
/**
* As a single JS string
*/
String:1,"1":"String", });

const AutomergeFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm$1.__wbg_automerge_free(ptr >>> 0));
/**
*/
class Automerge {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Automerge.prototype);
        obj.__wbg_ptr = ptr;
        AutomergeFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AutomergeFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_automerge_free(ptr);
    }
    /**
    * @param {string | undefined} actor
    * @param {TextRepresentation} text_rep
    * @returns {Automerge}
    */
    static new(actor, text_rep) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(actor) ? 0 : passStringToWasm0(actor, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
            var len0 = WASM_VECTOR_LEN;
            wasm$1.automerge_new(retptr, ptr0, len0, text_rep);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return Automerge.__wrap(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {string | undefined} [actor]
    * @returns {Automerge}
    */
    clone(actor) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(actor) ? 0 : passStringToWasm0(actor, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
            var len0 = WASM_VECTOR_LEN;
            wasm$1.automerge_clone(retptr, this.__wbg_ptr, ptr0, len0);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return Automerge.__wrap(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {string | undefined} actor
    * @param {any} heads
    * @returns {Automerge}
    */
    fork(actor, heads) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            var ptr0 = isLikeNone(actor) ? 0 : passStringToWasm0(actor, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
            var len0 = WASM_VECTOR_LEN;
            wasm$1.automerge_fork(retptr, this.__wbg_ptr, ptr0, len0, addHeapObject(heads));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return Automerge.__wrap(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @returns {any}
    */
    pendingOps() {
        const ret = wasm$1.automerge_pendingOps(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @param {string | undefined} [message]
    * @param {number | undefined} [time]
    * @returns {any}
    */
    commit(message, time) {
        var ptr0 = isLikeNone(message) ? 0 : passStringToWasm0(message, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.automerge_commit(this.__wbg_ptr, ptr0, len0, !isLikeNone(time), isLikeNone(time) ? 0 : time);
        return takeObject(ret);
    }
    /**
    * @param {Automerge} other
    * @returns {Array<any>}
    */
    merge(other) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            _assertClass(other, Automerge);
            wasm$1.automerge_merge(retptr, this.__wbg_ptr, other.__wbg_ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @returns {number}
    */
    rollback() {
        const ret = wasm$1.automerge_rollback(this.__wbg_ptr);
        return ret;
    }
    /**
    * @param {any} obj
    * @param {Array<any> | undefined} [heads]
    * @returns {Array<any>}
    */
    keys(obj, heads) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_keys(retptr, this.__wbg_ptr, addHeapObject(obj), isLikeNone(heads) ? 0 : addHeapObject(heads));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {Array<any> | undefined} [heads]
    * @returns {string}
    */
    text(obj, heads) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_text(retptr, this.__wbg_ptr, addHeapObject(obj), isLikeNone(heads) ? 0 : addHeapObject(heads));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            var r3 = getInt32Memory0()[retptr / 4 + 3];
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
            wasm$1.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
    * @param {any} obj
    * @param {Array<any> | undefined} [heads]
    * @returns {Array<any>}
    */
    spans(obj, heads) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_spans(retptr, this.__wbg_ptr, addHeapObject(obj), isLikeNone(heads) ? 0 : addHeapObject(heads));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {number} start
    * @param {number} delete_count
    * @param {any} text
    */
    splice(obj, start, delete_count, text) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_splice(retptr, this.__wbg_ptr, addHeapObject(obj), start, delete_count, addHeapObject(text));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {any} new_text
    */
    updateText(obj, new_text) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_updateText(retptr, this.__wbg_ptr, addHeapObject(obj), addHeapObject(new_text));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {any} args
    */
    updateSpans(obj, args) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_updateSpans(retptr, this.__wbg_ptr, addHeapObject(obj), addHeapObject(args));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {any} value
    * @param {any} datatype
    */
    push(obj, value, datatype) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_push(retptr, this.__wbg_ptr, addHeapObject(obj), addHeapObject(value), addHeapObject(datatype));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {any} value
    * @returns {string | undefined}
    */
    pushObject(obj, value) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_pushObject(retptr, this.__wbg_ptr, addHeapObject(obj), addHeapObject(value));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            var r3 = getInt32Memory0()[retptr / 4 + 3];
            if (r3) {
                throw takeObject(r2);
            }
            let v1;
            if (r0 !== 0) {
                v1 = getStringFromWasm0(r0, r1).slice();
                wasm$1.__wbindgen_free(r0, r1 * 1, 1);
            }
            return v1;
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {number} index
    * @param {any} value
    * @param {any} datatype
    */
    insert(obj, index, value, datatype) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_insert(retptr, this.__wbg_ptr, addHeapObject(obj), index, addHeapObject(value), addHeapObject(datatype));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {number} index
    * @param {any} args
    */
    splitBlock(obj, index, args) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_splitBlock(retptr, this.__wbg_ptr, addHeapObject(obj), index, addHeapObject(args));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} text
    * @param {number} index
    */
    joinBlock(text, index) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_joinBlock(retptr, this.__wbg_ptr, addHeapObject(text), index);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} text
    * @param {number} index
    * @param {any} args
    */
    updateBlock(text, index, args) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_updateBlock(retptr, this.__wbg_ptr, addHeapObject(text), index, addHeapObject(args));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} text
    * @param {number} index
    * @param {Array<any> | undefined} [heads]
    * @returns {any}
    */
    getBlock(text, index, heads) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_getBlock(retptr, this.__wbg_ptr, addHeapObject(text), index, isLikeNone(heads) ? 0 : addHeapObject(heads));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {number} index
    * @param {any} value
    * @returns {string | undefined}
    */
    insertObject(obj, index, value) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_insertObject(retptr, this.__wbg_ptr, addHeapObject(obj), index, addHeapObject(value));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            var r3 = getInt32Memory0()[retptr / 4 + 3];
            if (r3) {
                throw takeObject(r2);
            }
            let v1;
            if (r0 !== 0) {
                v1 = getStringFromWasm0(r0, r1).slice();
                wasm$1.__wbindgen_free(r0, r1 * 1, 1);
            }
            return v1;
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {any} prop
    * @param {any} value
    * @param {any} datatype
    */
    put(obj, prop, value, datatype) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_put(retptr, this.__wbg_ptr, addHeapObject(obj), addHeapObject(prop), addHeapObject(value), addHeapObject(datatype));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {any} prop
    * @param {any} value
    * @returns {any}
    */
    putObject(obj, prop, value) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_putObject(retptr, this.__wbg_ptr, addHeapObject(obj), addHeapObject(prop), addHeapObject(value));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {any} prop
    * @param {any} value
    */
    increment(obj, prop, value) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_increment(retptr, this.__wbg_ptr, addHeapObject(obj), addHeapObject(prop), addHeapObject(value));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {any} prop
    * @param {Array<any> | undefined} [heads]
    * @returns {any}
    */
    get(obj, prop, heads) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_get(retptr, this.__wbg_ptr, addHeapObject(obj), addHeapObject(prop), isLikeNone(heads) ? 0 : addHeapObject(heads));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {any} prop
    * @param {Array<any> | undefined} [heads]
    * @returns {any}
    */
    getWithType(obj, prop, heads) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_getWithType(retptr, this.__wbg_ptr, addHeapObject(obj), addHeapObject(prop), isLikeNone(heads) ? 0 : addHeapObject(heads));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {Array<any> | undefined} [heads]
    * @returns {object}
    */
    objInfo(obj, heads) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_objInfo(retptr, this.__wbg_ptr, addHeapObject(obj), isLikeNone(heads) ? 0 : addHeapObject(heads));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {any} arg
    * @param {Array<any> | undefined} [heads]
    * @returns {Array<any>}
    */
    getAll(obj, arg, heads) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_getAll(retptr, this.__wbg_ptr, addHeapObject(obj), addHeapObject(arg), isLikeNone(heads) ? 0 : addHeapObject(heads));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} enable
    * @returns {any}
    */
    enableFreeze(enable) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_enableFreeze(retptr, this.__wbg_ptr, addHeapObject(enable));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} datatype
    * @param {any} export_function
    * @param {any} import_function
    */
    registerDatatype(datatype, export_function, import_function) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_registerDatatype(retptr, this.__wbg_ptr, addHeapObject(datatype), addHeapObject(export_function), addHeapObject(import_function));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} object
    * @param {any} meta
    * @returns {any}
    */
    applyPatches(object, meta) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_applyPatches(retptr, this.__wbg_ptr, addHeapObject(object), addHeapObject(meta));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} object
    * @param {any} meta
    * @returns {any}
    */
    applyAndReturnPatches(object, meta) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_applyAndReturnPatches(retptr, this.__wbg_ptr, addHeapObject(object), addHeapObject(meta));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @returns {Array<any>}
    */
    diffIncremental() {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_diffIncremental(retptr, this.__wbg_ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    */
    updateDiffCursor() {
        wasm$1.automerge_updateDiffCursor(this.__wbg_ptr);
    }
    /**
    */
    resetDiffCursor() {
        wasm$1.automerge_resetDiffCursor(this.__wbg_ptr);
    }
    /**
    * @param {Array<any>} before
    * @param {Array<any>} after
    * @returns {Array<any>}
    */
    diff(before, after) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_diff(retptr, this.__wbg_ptr, addHeapObject(before), addHeapObject(after));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {Array<any>} heads
    */
    isolate(heads) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_isolate(retptr, this.__wbg_ptr, addHeapObject(heads));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    */
    integrate() {
        wasm$1.automerge_integrate(this.__wbg_ptr);
    }
    /**
    * @param {any} obj
    * @param {Array<any> | undefined} [heads]
    * @returns {number}
    */
    length(obj, heads) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_length(retptr, this.__wbg_ptr, addHeapObject(obj), isLikeNone(heads) ? 0 : addHeapObject(heads));
            var r0 = getFloat64Memory0()[retptr / 8 + 0];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            var r3 = getInt32Memory0()[retptr / 4 + 3];
            if (r3) {
                throw takeObject(r2);
            }
            return r0;
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {any} prop
    */
    delete(obj, prop) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_delete(retptr, this.__wbg_ptr, addHeapObject(obj), addHeapObject(prop));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @returns {Uint8Array}
    */
    save() {
        const ret = wasm$1.automerge_save(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {Uint8Array}
    */
    saveIncremental() {
        const ret = wasm$1.automerge_saveIncremental(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @param {Array<any>} heads
    * @returns {Uint8Array}
    */
    saveSince(heads) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_saveSince(retptr, this.__wbg_ptr, addHeapObject(heads));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @returns {Uint8Array}
    */
    saveNoCompress() {
        const ret = wasm$1.automerge_saveNoCompress(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {Uint8Array}
    */
    saveAndVerify() {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_saveAndVerify(retptr, this.__wbg_ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {Uint8Array} data
    * @returns {number}
    */
    loadIncremental(data) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_loadIncremental(retptr, this.__wbg_ptr, addHeapObject(data));
            var r0 = getFloat64Memory0()[retptr / 8 + 0];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            var r3 = getInt32Memory0()[retptr / 4 + 3];
            if (r3) {
                throw takeObject(r2);
            }
            return r0;
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} changes
    */
    applyChanges(changes) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_applyChanges(retptr, this.__wbg_ptr, addHeapObject(changes));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} have_deps
    * @returns {Array<any>}
    */
    getChanges(have_deps) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_getChanges(retptr, this.__wbg_ptr, addHeapObject(have_deps));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} hash
    * @returns {any}
    */
    getChangeByHash(hash) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_getChangeByHash(retptr, this.__wbg_ptr, addHeapObject(hash));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} hash
    * @returns {any}
    */
    getDecodedChangeByHash(hash) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_getDecodedChangeByHash(retptr, this.__wbg_ptr, addHeapObject(hash));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {Automerge} other
    * @returns {Array<any>}
    */
    getChangesAdded(other) {
        _assertClass(other, Automerge);
        const ret = wasm$1.automerge_getChangesAdded(this.__wbg_ptr, other.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {Array<any>}
    */
    getHeads() {
        const ret = wasm$1.automerge_getHeads(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {string}
    */
    getActorId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_getActorId(retptr, this.__wbg_ptr);
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
            wasm$1.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
    * @returns {any}
    */
    getLastLocalChange() {
        const ret = wasm$1.automerge_getLastLocalChange(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    */
    dump() {
        wasm$1.automerge_dump(this.__wbg_ptr);
    }
    /**
    * @param {Array<any> | undefined} [heads]
    * @returns {Array<any>}
    */
    getMissingDeps(heads) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_getMissingDeps(retptr, this.__wbg_ptr, isLikeNone(heads) ? 0 : addHeapObject(heads));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {SyncState} state
    * @param {Uint8Array} message
    */
    receiveSyncMessage(state, message) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            _assertClass(state, SyncState);
            wasm$1.automerge_receiveSyncMessage(retptr, this.__wbg_ptr, state.__wbg_ptr, addHeapObject(message));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {SyncState} state
    * @returns {any}
    */
    generateSyncMessage(state) {
        _assertClass(state, SyncState);
        const ret = wasm$1.automerge_generateSyncMessage(this.__wbg_ptr, state.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @param {any} meta
    * @returns {any}
    */
    toJS(meta) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_toJS(retptr, this.__wbg_ptr, addHeapObject(meta));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {Array<any> | undefined} heads
    * @param {any} meta
    * @returns {any}
    */
    materialize(obj, heads, meta) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_materialize(retptr, this.__wbg_ptr, addHeapObject(obj), isLikeNone(heads) ? 0 : addHeapObject(heads), addHeapObject(meta));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {number} index
    * @param {Array<any> | undefined} [heads]
    * @returns {string}
    */
    getCursor(obj, index, heads) {
        let deferred2_0;
        let deferred2_1;
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_getCursor(retptr, this.__wbg_ptr, addHeapObject(obj), index, isLikeNone(heads) ? 0 : addHeapObject(heads));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            var r3 = getInt32Memory0()[retptr / 4 + 3];
            var ptr1 = r0;
            var len1 = r1;
            if (r3) {
                ptr1 = 0; len1 = 0;
                throw takeObject(r2);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
            wasm$1.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
    * @param {any} obj
    * @param {any} cursor
    * @param {Array<any> | undefined} [heads]
    * @returns {number}
    */
    getCursorPosition(obj, cursor, heads) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_getCursorPosition(retptr, this.__wbg_ptr, addHeapObject(obj), addHeapObject(cursor), isLikeNone(heads) ? 0 : addHeapObject(heads));
            var r0 = getFloat64Memory0()[retptr / 8 + 0];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            var r3 = getInt32Memory0()[retptr / 4 + 3];
            if (r3) {
                throw takeObject(r2);
            }
            return r0;
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {string | undefined} [message]
    * @param {number | undefined} [time]
    * @returns {any}
    */
    emptyChange(message, time) {
        var ptr0 = isLikeNone(message) ? 0 : passStringToWasm0(message, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm$1.automerge_emptyChange(this.__wbg_ptr, ptr0, len0, !isLikeNone(time), isLikeNone(time) ? 0 : time);
        return takeObject(ret);
    }
    /**
    * @param {any} obj
    * @param {any} range
    * @param {any} name
    * @param {any} value
    * @param {any} datatype
    */
    mark(obj, range, name, value, datatype) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_mark(retptr, this.__wbg_ptr, addHeapObject(obj), addHeapObject(range), addHeapObject(name), addHeapObject(value), addHeapObject(datatype));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {any} range
    * @param {any} name
    */
    unmark(obj, range, name) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_unmark(retptr, this.__wbg_ptr, addHeapObject(obj), addHeapObject(range), addHeapObject(name));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {Array<any> | undefined} [heads]
    * @returns {any}
    */
    marks(obj, heads) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_marks(retptr, this.__wbg_ptr, addHeapObject(obj), isLikeNone(heads) ? 0 : addHeapObject(heads));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} obj
    * @param {number} index
    * @param {Array<any> | undefined} [heads]
    * @returns {object}
    */
    marksAt(obj, index, heads) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.automerge_marksAt(retptr, this.__wbg_ptr, addHeapObject(obj), index, isLikeNone(heads) ? 0 : addHeapObject(heads));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            var r2 = getInt32Memory0()[retptr / 4 + 2];
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {SyncState} state
    * @returns {any}
    */
    hasOurChanges(state) {
        _assertClass(state, SyncState);
        const ret = wasm$1.automerge_hasOurChanges(this.__wbg_ptr, state.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {any}
    */
    topoHistoryTraversal() {
        const ret = wasm$1.automerge_topoHistoryTraversal(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {any}
    */
    stats() {
        const ret = wasm$1.automerge_stats(this.__wbg_ptr);
        return takeObject(ret);
    }
}

const SyncStateFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm$1.__wbg_syncstate_free(ptr >>> 0));
/**
*/
class SyncState {

    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(SyncState.prototype);
        obj.__wbg_ptr = ptr;
        SyncStateFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }

    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SyncStateFinalization.unregister(this);
        return ptr;
    }

    free() {
        const ptr = this.__destroy_into_raw();
        wasm$1.__wbg_syncstate_free(ptr);
    }
    /**
    * @returns {any}
    */
    get sharedHeads() {
        const ret = wasm$1.syncstate_sharedHeads(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @returns {any}
    */
    get lastSentHeads() {
        const ret = wasm$1.syncstate_lastSentHeads(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
    * @param {any} heads
    */
    set lastSentHeads(heads) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.syncstate_set_lastSentHeads(retptr, this.__wbg_ptr, addHeapObject(heads));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @param {any} hashes
    */
    set sentHashes(hashes) {
        try {
            const retptr = wasm$1.__wbindgen_add_to_stack_pointer(-16);
            wasm$1.syncstate_set_sentHashes(retptr, this.__wbg_ptr, addHeapObject(hashes));
            var r0 = getInt32Memory0()[retptr / 4 + 0];
            var r1 = getInt32Memory0()[retptr / 4 + 1];
            if (r1) {
                throw takeObject(r0);
            }
        } finally {
            wasm$1.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
    * @returns {SyncState}
    */
    clone() {
        const ret = wasm$1.syncstate_clone(this.__wbg_ptr);
        return SyncState.__wrap(ret);
    }
}

function __wbindgen_object_drop_ref(arg0) {
    takeObject(arg0);
}
function __wbindgen_string_get(arg0, arg1) {
    const obj = getObject(arg1);
    const ret = typeof(obj) === 'string' ? obj : undefined;
    var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    getInt32Memory0()[arg0 / 4 + 1] = len1;
    getInt32Memory0()[arg0 / 4 + 0] = ptr1;
}
function __wbindgen_error_new(arg0, arg1) {
    const ret = new Error(getStringFromWasm0(arg0, arg1));
    return addHeapObject(ret);
}
function __wbindgen_string_new(arg0, arg1) {
    const ret = getStringFromWasm0(arg0, arg1);
    return addHeapObject(ret);
}
function __wbindgen_number_new(arg0) {
    const ret = arg0;
    return addHeapObject(ret);
}
function __wbindgen_object_clone_ref(arg0) {
    const ret = getObject(arg0);
    return addHeapObject(ret);
}
function __wbindgen_number_get(arg0, arg1) {
    const obj = getObject(arg1);
    const ret = typeof(obj) === 'number' ? obj : undefined;
    getFloat64Memory0()[arg0 / 8 + 1] = isLikeNone(ret) ? 0 : ret;
    getInt32Memory0()[arg0 / 4 + 0] = !isLikeNone(ret);
}
function __wbindgen_is_undefined(arg0) {
    const ret = getObject(arg0) === undefined;
    return ret;
}
function __wbindgen_boolean_get(arg0) {
    const v = getObject(arg0);
    const ret = typeof(v) === 'boolean' ? (v ? 1 : 0) : 2;
    return ret;
}
function __wbindgen_is_null(arg0) {
    const ret = getObject(arg0) === null;
    return ret;
}
function __wbindgen_is_string(arg0) {
    const ret = typeof(getObject(arg0)) === 'string';
    return ret;
}
function __wbindgen_is_function(arg0) {
    const ret = typeof(getObject(arg0)) === 'function';
    return ret;
}
function __wbindgen_is_object(arg0) {
    const val = getObject(arg0);
    const ret = typeof(val) === 'object' && val !== null;
    return ret;
}
function __wbindgen_is_array(arg0) {
    const ret = Array.isArray(getObject(arg0));
    return ret;
}
function __wbindgen_json_serialize(arg0, arg1) {
    const obj = getObject(arg1);
    const ret = JSON.stringify(obj === undefined ? null : obj);
    const ptr1 = passStringToWasm0(ret, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getInt32Memory0()[arg0 / 4 + 1] = len1;
    getInt32Memory0()[arg0 / 4 + 0] = ptr1;
}
function __wbg_new_abda76e883ba8a5f() {
    const ret = new Error();
    return addHeapObject(ret);
}
function __wbg_stack_658279fe44541cf6(arg0, arg1) {
    const ret = getObject(arg1).stack;
    const ptr1 = passStringToWasm0(ret, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getInt32Memory0()[arg0 / 4 + 1] = len1;
    getInt32Memory0()[arg0 / 4 + 0] = ptr1;
}
function __wbg_error_f851667af71bcfc6(arg0, arg1) {
    let deferred0_0;
    let deferred0_1;
    try {
        deferred0_0 = arg0;
        deferred0_1 = arg1;
        console.error(getStringFromWasm0(arg0, arg1));
    } finally {
        wasm$1.__wbindgen_free(deferred0_0, deferred0_1, 1);
    }
}
function __wbindgen_jsval_loose_eq(arg0, arg1) {
    const ret = getObject(arg0) == getObject(arg1);
    return ret;
}
function __wbg_String_91fba7ded13ba54c(arg0, arg1) {
    const ret = String(getObject(arg1));
    const ptr1 = passStringToWasm0(ret, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getInt32Memory0()[arg0 / 4 + 1] = len1;
    getInt32Memory0()[arg0 / 4 + 0] = ptr1;
}
function __wbindgen_bigint_from_i64(arg0) {
    const ret = arg0;
    return addHeapObject(ret);
}
function __wbindgen_bigint_from_u64(arg0) {
    const ret = BigInt.asUintN(64, arg0);
    return addHeapObject(ret);
}
function __wbg_set_20cbc34131e76824(arg0, arg1, arg2) {
    getObject(arg0)[takeObject(arg1)] = takeObject(arg2);
}
function __wbg_getRandomValues_3aa56aa6edec874c() { return handleError(function (arg0, arg1) {
    getObject(arg0).getRandomValues(getObject(arg1));
}, arguments) }
function __wbg_randomFillSync_5c9c955aa56b6049() { return handleError(function (arg0, arg1) {
    getObject(arg0).randomFillSync(takeObject(arg1));
}, arguments) }
function __wbg_crypto_1d1f22824a6a080c(arg0) {
    const ret = getObject(arg0).crypto;
    return addHeapObject(ret);
}
function __wbg_process_4a72847cc503995b(arg0) {
    const ret = getObject(arg0).process;
    return addHeapObject(ret);
}
function __wbg_versions_f686565e586dd935(arg0) {
    const ret = getObject(arg0).versions;
    return addHeapObject(ret);
}
function __wbg_node_104a2ff8d6ea03a2(arg0) {
    const ret = getObject(arg0).node;
    return addHeapObject(ret);
}
function __wbg_require_cca90b1a94a0255b() { return handleError(function () {
    const ret = module.require;
    return addHeapObject(ret);
}, arguments) }
function __wbg_msCrypto_eb05e62b530a1508(arg0) {
    const ret = getObject(arg0).msCrypto;
    return addHeapObject(ret);
}
function __wbg_log_5bb5f88f245d7762(arg0) {
    console.log(getObject(arg0));
}
function __wbg_log_1746d5c75ec89963(arg0, arg1) {
    console.log(getObject(arg0), getObject(arg1));
}
function __wbg_get_bd8e338fbd5f5cc8(arg0, arg1) {
    const ret = getObject(arg0)[arg1 >>> 0];
    return addHeapObject(ret);
}
function __wbg_length_cd7af8117672b8b8(arg0) {
    const ret = getObject(arg0).length;
    return ret;
}
function __wbg_new_16b304a2cfa7ff4a() {
    const ret = new Array();
    return addHeapObject(ret);
}
function __wbg_newnoargs_e258087cd0daa0ea(arg0, arg1) {
    const ret = new Function(getStringFromWasm0(arg0, arg1));
    return addHeapObject(ret);
}
function __wbg_next_40fc327bfc8770e6(arg0) {
    const ret = getObject(arg0).next;
    return addHeapObject(ret);
}
function __wbg_next_196c84450b364254() { return handleError(function (arg0) {
    const ret = getObject(arg0).next();
    return addHeapObject(ret);
}, arguments) }
function __wbg_done_298b57d23c0fc80c(arg0) {
    const ret = getObject(arg0).done;
    return ret;
}
function __wbg_value_d93c65011f51a456(arg0) {
    const ret = getObject(arg0).value;
    return addHeapObject(ret);
}
function __wbg_iterator_2cee6dadfd956dfa() {
    const ret = Symbol.iterator;
    return addHeapObject(ret);
}
function __wbg_get_e3c254076557e348() { return handleError(function (arg0, arg1) {
    const ret = Reflect.get(getObject(arg0), getObject(arg1));
    return addHeapObject(ret);
}, arguments) }
function __wbg_call_27c0f87801dedf93() { return handleError(function (arg0, arg1) {
    const ret = getObject(arg0).call(getObject(arg1));
    return addHeapObject(ret);
}, arguments) }
function __wbg_new_72fb9a18b5ae2624() {
    const ret = new Object();
    return addHeapObject(ret);
}
function __wbg_length_dee433d4c85c9387(arg0) {
    const ret = getObject(arg0).length;
    return ret;
}
function __wbg_set_d4638f722068f043(arg0, arg1, arg2) {
    getObject(arg0)[arg1 >>> 0] = takeObject(arg2);
}
function __wbg_from_89e3fc3ba5e6fb48(arg0) {
    const ret = Array.from(getObject(arg0));
    return addHeapObject(ret);
}
function __wbg_isArray_2ab64d95e09ea0ae(arg0) {
    const ret = Array.isArray(getObject(arg0));
    return ret;
}
function __wbg_push_a5b05aedc7234f9f(arg0, arg1) {
    const ret = getObject(arg0).push(getObject(arg1));
    return ret;
}
function __wbg_unshift_e22df4b34bcf5070(arg0, arg1) {
    const ret = getObject(arg0).unshift(getObject(arg1));
    return ret;
}
function __wbg_instanceof_ArrayBuffer_836825be07d4c9d2(arg0) {
    let result;
    try {
        result = getObject(arg0) instanceof ArrayBuffer;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
}
function __wbg_new_28c511d9baebfa89(arg0, arg1) {
    const ret = new Error(getStringFromWasm0(arg0, arg1));
    return addHeapObject(ret);
}
function __wbg_call_b3ca7c6051f9bec1() { return handleError(function (arg0, arg1, arg2) {
    const ret = getObject(arg0).call(getObject(arg1), getObject(arg2));
    return addHeapObject(ret);
}, arguments) }
function __wbg_instanceof_Date_f65cf97fb83fc369(arg0) {
    let result;
    try {
        result = getObject(arg0) instanceof Date;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
}
function __wbg_getTime_2bc4375165f02d15(arg0) {
    const ret = getObject(arg0).getTime();
    return ret;
}
function __wbg_new_cf3ec55744a78578(arg0) {
    const ret = new Date(getObject(arg0));
    return addHeapObject(ret);
}
function __wbg_instanceof_Object_71ca3c0a59266746(arg0) {
    let result;
    try {
        result = getObject(arg0) instanceof Object;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
}
function __wbg_assign_496d2d14fecafbcf(arg0, arg1) {
    const ret = Object.assign(getObject(arg0), getObject(arg1));
    return addHeapObject(ret);
}
function __wbg_defineProperty_cc00e2de8a0f5141(arg0, arg1, arg2) {
    const ret = Object.defineProperty(getObject(arg0), getObject(arg1), getObject(arg2));
    return addHeapObject(ret);
}
function __wbg_entries_95cc2c823b285a09(arg0) {
    const ret = Object.entries(getObject(arg0));
    return addHeapObject(ret);
}
function __wbg_freeze_cc6bc19f75299986(arg0) {
    const ret = Object.freeze(getObject(arg0));
    return addHeapObject(ret);
}
function __wbg_keys_91e412b4b222659f(arg0) {
    const ret = Object.keys(getObject(arg0));
    return addHeapObject(ret);
}
function __wbg_values_9c75e6e2bfbdb70d(arg0) {
    const ret = Object.values(getObject(arg0));
    return addHeapObject(ret);
}
function __wbg_new_dd6a5dd7b538af21(arg0, arg1) {
    const ret = new RangeError(getStringFromWasm0(arg0, arg1));
    return addHeapObject(ret);
}
function __wbg_apply_0a5aa603881e6d79() { return handleError(function (arg0, arg1, arg2) {
    const ret = Reflect.apply(getObject(arg0), getObject(arg1), getObject(arg2));
    return addHeapObject(ret);
}, arguments) }
function __wbg_deleteProperty_13e721a56f19e842() { return handleError(function (arg0, arg1) {
    const ret = Reflect.deleteProperty(getObject(arg0), getObject(arg1));
    return ret;
}, arguments) }
function __wbg_ownKeys_658942b7f28d1fe9() { return handleError(function (arg0) {
    const ret = Reflect.ownKeys(getObject(arg0));
    return addHeapObject(ret);
}, arguments) }
function __wbg_set_1f9b04f170055d33() { return handleError(function (arg0, arg1, arg2) {
    const ret = Reflect.set(getObject(arg0), getObject(arg1), getObject(arg2));
    return ret;
}, arguments) }
function __wbg_buffer_12d079cc21e14bdb(arg0) {
    const ret = getObject(arg0).buffer;
    return addHeapObject(ret);
}
function __wbg_concat_3de229fe4fe90fea(arg0, arg1) {
    const ret = getObject(arg0).concat(getObject(arg1));
    return addHeapObject(ret);
}
function __wbg_slice_52fb626ffdc8da8f(arg0, arg1, arg2) {
    const ret = getObject(arg0).slice(arg1 >>> 0, arg2 >>> 0);
    return addHeapObject(ret);
}
function __wbg_for_27c67e2dbdce22f6(arg0, arg1) {
    const ret = Symbol.for(getStringFromWasm0(arg0, arg1));
    return addHeapObject(ret);
}
function __wbg_toString_7df3c77999517c20(arg0) {
    const ret = getObject(arg0).toString();
    return addHeapObject(ret);
}
function __wbg_self_ce0dbfc45cf2f5be() { return handleError(function () {
    const ret = self.self;
    return addHeapObject(ret);
}, arguments) }
function __wbg_window_c6fb939a7f436783() { return handleError(function () {
    const ret = window.window;
    return addHeapObject(ret);
}, arguments) }
function __wbg_globalThis_d1e6af4856ba331b() { return handleError(function () {
    const ret = globalThis.globalThis;
    return addHeapObject(ret);
}, arguments) }
function __wbg_global_207b558942527489() { return handleError(function () {
    const ret = global.global;
    return addHeapObject(ret);
}, arguments) }
function __wbg_newwithbyteoffsetandlength_aa4a17c33a06e5cb(arg0, arg1, arg2) {
    const ret = new Uint8Array(getObject(arg0), arg1 >>> 0, arg2 >>> 0);
    return addHeapObject(ret);
}
function __wbg_new_63b92bc8671ed464(arg0) {
    const ret = new Uint8Array(getObject(arg0));
    return addHeapObject(ret);
}
function __wbg_set_a47bac70306a19a7(arg0, arg1, arg2) {
    getObject(arg0).set(getObject(arg1), arg2 >>> 0);
}
function __wbg_length_c20a40f15020d68a(arg0) {
    const ret = getObject(arg0).length;
    return ret;
}
function __wbg_instanceof_Uint8Array_2b3bbecd033d19f6(arg0) {
    let result;
    try {
        result = getObject(arg0) instanceof Uint8Array;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
}
function __wbg_newwithlength_e9b4878cebadb3d3(arg0) {
    const ret = new Uint8Array(arg0 >>> 0);
    return addHeapObject(ret);
}
function __wbg_subarray_a1f73cd4b5b42fe1(arg0, arg1, arg2) {
    const ret = getObject(arg0).subarray(arg1 >>> 0, arg2 >>> 0);
    return addHeapObject(ret);
}
function __wbindgen_debug_string(arg0, arg1) {
    const ret = debugString(getObject(arg1));
    const ptr1 = passStringToWasm0(ret, wasm$1.__wbindgen_malloc, wasm$1.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getInt32Memory0()[arg0 / 4 + 1] = len1;
    getInt32Memory0()[arg0 / 4 + 0] = ptr1;
}
function __wbindgen_throw(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
}
function __wbindgen_memory() {
    const ret = wasm$1.memory;
    return addHeapObject(ret);
}

URL = globalThis.URL;
const __vite__wasmModule = await __vite__initWasm({ "./automerge_wasm_bg.js": { "__wbindgen_object_drop_ref": __wbindgen_object_drop_ref,
"__wbindgen_string_get": __wbindgen_string_get,
"__wbindgen_error_new": __wbindgen_error_new,
"__wbindgen_string_new": __wbindgen_string_new,
"__wbindgen_number_new": __wbindgen_number_new,
"__wbindgen_object_clone_ref": __wbindgen_object_clone_ref,
"__wbindgen_number_get": __wbindgen_number_get,
"__wbindgen_is_undefined": __wbindgen_is_undefined,
"__wbindgen_boolean_get": __wbindgen_boolean_get,
"__wbindgen_is_null": __wbindgen_is_null,
"__wbindgen_is_string": __wbindgen_is_string,
"__wbindgen_is_function": __wbindgen_is_function,
"__wbindgen_is_object": __wbindgen_is_object,
"__wbindgen_is_array": __wbindgen_is_array,
"__wbindgen_json_serialize": __wbindgen_json_serialize,
"__wbg_new_abda76e883ba8a5f": __wbg_new_abda76e883ba8a5f,
"__wbg_stack_658279fe44541cf6": __wbg_stack_658279fe44541cf6,
"__wbg_error_f851667af71bcfc6": __wbg_error_f851667af71bcfc6,
"__wbindgen_jsval_loose_eq": __wbindgen_jsval_loose_eq,
"__wbg_String_91fba7ded13ba54c": __wbg_String_91fba7ded13ba54c,
"__wbindgen_bigint_from_i64": __wbindgen_bigint_from_i64,
"__wbindgen_bigint_from_u64": __wbindgen_bigint_from_u64,
"__wbg_set_20cbc34131e76824": __wbg_set_20cbc34131e76824,
"__wbg_getRandomValues_3aa56aa6edec874c": __wbg_getRandomValues_3aa56aa6edec874c,
"__wbg_randomFillSync_5c9c955aa56b6049": __wbg_randomFillSync_5c9c955aa56b6049,
"__wbg_crypto_1d1f22824a6a080c": __wbg_crypto_1d1f22824a6a080c,
"__wbg_process_4a72847cc503995b": __wbg_process_4a72847cc503995b,
"__wbg_versions_f686565e586dd935": __wbg_versions_f686565e586dd935,
"__wbg_node_104a2ff8d6ea03a2": __wbg_node_104a2ff8d6ea03a2,
"__wbg_require_cca90b1a94a0255b": __wbg_require_cca90b1a94a0255b,
"__wbg_msCrypto_eb05e62b530a1508": __wbg_msCrypto_eb05e62b530a1508,
"__wbg_log_5bb5f88f245d7762": __wbg_log_5bb5f88f245d7762,
"__wbg_log_1746d5c75ec89963": __wbg_log_1746d5c75ec89963,
"__wbg_get_bd8e338fbd5f5cc8": __wbg_get_bd8e338fbd5f5cc8,
"__wbg_length_cd7af8117672b8b8": __wbg_length_cd7af8117672b8b8,
"__wbg_new_16b304a2cfa7ff4a": __wbg_new_16b304a2cfa7ff4a,
"__wbg_newnoargs_e258087cd0daa0ea": __wbg_newnoargs_e258087cd0daa0ea,
"__wbg_next_40fc327bfc8770e6": __wbg_next_40fc327bfc8770e6,
"__wbg_next_196c84450b364254": __wbg_next_196c84450b364254,
"__wbg_done_298b57d23c0fc80c": __wbg_done_298b57d23c0fc80c,
"__wbg_value_d93c65011f51a456": __wbg_value_d93c65011f51a456,
"__wbg_iterator_2cee6dadfd956dfa": __wbg_iterator_2cee6dadfd956dfa,
"__wbg_get_e3c254076557e348": __wbg_get_e3c254076557e348,
"__wbg_call_27c0f87801dedf93": __wbg_call_27c0f87801dedf93,
"__wbg_new_72fb9a18b5ae2624": __wbg_new_72fb9a18b5ae2624,
"__wbg_length_dee433d4c85c9387": __wbg_length_dee433d4c85c9387,
"__wbg_set_d4638f722068f043": __wbg_set_d4638f722068f043,
"__wbg_from_89e3fc3ba5e6fb48": __wbg_from_89e3fc3ba5e6fb48,
"__wbg_isArray_2ab64d95e09ea0ae": __wbg_isArray_2ab64d95e09ea0ae,
"__wbg_push_a5b05aedc7234f9f": __wbg_push_a5b05aedc7234f9f,
"__wbg_unshift_e22df4b34bcf5070": __wbg_unshift_e22df4b34bcf5070,
"__wbg_instanceof_ArrayBuffer_836825be07d4c9d2": __wbg_instanceof_ArrayBuffer_836825be07d4c9d2,
"__wbg_new_28c511d9baebfa89": __wbg_new_28c511d9baebfa89,
"__wbg_call_b3ca7c6051f9bec1": __wbg_call_b3ca7c6051f9bec1,
"__wbg_instanceof_Date_f65cf97fb83fc369": __wbg_instanceof_Date_f65cf97fb83fc369,
"__wbg_getTime_2bc4375165f02d15": __wbg_getTime_2bc4375165f02d15,
"__wbg_new_cf3ec55744a78578": __wbg_new_cf3ec55744a78578,
"__wbg_instanceof_Object_71ca3c0a59266746": __wbg_instanceof_Object_71ca3c0a59266746,
"__wbg_assign_496d2d14fecafbcf": __wbg_assign_496d2d14fecafbcf,
"__wbg_defineProperty_cc00e2de8a0f5141": __wbg_defineProperty_cc00e2de8a0f5141,
"__wbg_entries_95cc2c823b285a09": __wbg_entries_95cc2c823b285a09,
"__wbg_freeze_cc6bc19f75299986": __wbg_freeze_cc6bc19f75299986,
"__wbg_keys_91e412b4b222659f": __wbg_keys_91e412b4b222659f,
"__wbg_values_9c75e6e2bfbdb70d": __wbg_values_9c75e6e2bfbdb70d,
"__wbg_new_dd6a5dd7b538af21": __wbg_new_dd6a5dd7b538af21,
"__wbg_apply_0a5aa603881e6d79": __wbg_apply_0a5aa603881e6d79,
"__wbg_deleteProperty_13e721a56f19e842": __wbg_deleteProperty_13e721a56f19e842,
"__wbg_ownKeys_658942b7f28d1fe9": __wbg_ownKeys_658942b7f28d1fe9,
"__wbg_set_1f9b04f170055d33": __wbg_set_1f9b04f170055d33,
"__wbg_buffer_12d079cc21e14bdb": __wbg_buffer_12d079cc21e14bdb,
"__wbg_concat_3de229fe4fe90fea": __wbg_concat_3de229fe4fe90fea,
"__wbg_slice_52fb626ffdc8da8f": __wbg_slice_52fb626ffdc8da8f,
"__wbg_for_27c67e2dbdce22f6": __wbg_for_27c67e2dbdce22f6,
"__wbg_toString_7df3c77999517c20": __wbg_toString_7df3c77999517c20,
"__wbg_self_ce0dbfc45cf2f5be": __wbg_self_ce0dbfc45cf2f5be,
"__wbg_window_c6fb939a7f436783": __wbg_window_c6fb939a7f436783,
"__wbg_globalThis_d1e6af4856ba331b": __wbg_globalThis_d1e6af4856ba331b,
"__wbg_global_207b558942527489": __wbg_global_207b558942527489,
"__wbg_newwithbyteoffsetandlength_aa4a17c33a06e5cb": __wbg_newwithbyteoffsetandlength_aa4a17c33a06e5cb,
"__wbg_new_63b92bc8671ed464": __wbg_new_63b92bc8671ed464,
"__wbg_set_a47bac70306a19a7": __wbg_set_a47bac70306a19a7,
"__wbg_length_c20a40f15020d68a": __wbg_length_c20a40f15020d68a,
"__wbg_instanceof_Uint8Array_2b3bbecd033d19f6": __wbg_instanceof_Uint8Array_2b3bbecd033d19f6,
"__wbg_newwithlength_e9b4878cebadb3d3": __wbg_newwithlength_e9b4878cebadb3d3,
"__wbg_subarray_a1f73cd4b5b42fe1": __wbg_subarray_a1f73cd4b5b42fe1,
"__wbindgen_debug_string": __wbindgen_debug_string,
"__wbindgen_throw": __wbindgen_throw,
"__wbindgen_memory": __wbindgen_memory } }, __vite__wasmUrl);
const memory = __vite__wasmModule.memory;
const __wbg_syncstate_free = __vite__wasmModule.__wbg_syncstate_free;
const syncstate_sharedHeads = __vite__wasmModule.syncstate_sharedHeads;
const syncstate_lastSentHeads = __vite__wasmModule.syncstate_lastSentHeads;
const syncstate_set_lastSentHeads = __vite__wasmModule.syncstate_set_lastSentHeads;
const syncstate_set_sentHashes = __vite__wasmModule.syncstate_set_sentHashes;
const syncstate_clone = __vite__wasmModule.syncstate_clone;
const __wbg_automerge_free = __vite__wasmModule.__wbg_automerge_free;
const automerge_new = __vite__wasmModule.automerge_new;
const automerge_clone = __vite__wasmModule.automerge_clone;
const automerge_fork = __vite__wasmModule.automerge_fork;
const automerge_pendingOps = __vite__wasmModule.automerge_pendingOps;
const automerge_commit = __vite__wasmModule.automerge_commit;
const automerge_merge = __vite__wasmModule.automerge_merge;
const automerge_rollback = __vite__wasmModule.automerge_rollback;
const automerge_keys = __vite__wasmModule.automerge_keys;
const automerge_text = __vite__wasmModule.automerge_text;
const automerge_spans = __vite__wasmModule.automerge_spans;
const automerge_splice = __vite__wasmModule.automerge_splice;
const automerge_updateText = __vite__wasmModule.automerge_updateText;
const automerge_updateSpans = __vite__wasmModule.automerge_updateSpans;
const automerge_push = __vite__wasmModule.automerge_push;
const automerge_pushObject = __vite__wasmModule.automerge_pushObject;
const automerge_insert = __vite__wasmModule.automerge_insert;
const automerge_splitBlock = __vite__wasmModule.automerge_splitBlock;
const automerge_joinBlock = __vite__wasmModule.automerge_joinBlock;
const automerge_updateBlock = __vite__wasmModule.automerge_updateBlock;
const automerge_getBlock = __vite__wasmModule.automerge_getBlock;
const automerge_insertObject = __vite__wasmModule.automerge_insertObject;
const automerge_put = __vite__wasmModule.automerge_put;
const automerge_putObject = __vite__wasmModule.automerge_putObject;
const automerge_increment = __vite__wasmModule.automerge_increment;
const automerge_get = __vite__wasmModule.automerge_get;
const automerge_getWithType = __vite__wasmModule.automerge_getWithType;
const automerge_objInfo = __vite__wasmModule.automerge_objInfo;
const automerge_getAll = __vite__wasmModule.automerge_getAll;
const automerge_enableFreeze = __vite__wasmModule.automerge_enableFreeze;
const automerge_registerDatatype = __vite__wasmModule.automerge_registerDatatype;
const automerge_applyPatches = __vite__wasmModule.automerge_applyPatches;
const automerge_applyAndReturnPatches = __vite__wasmModule.automerge_applyAndReturnPatches;
const automerge_diffIncremental = __vite__wasmModule.automerge_diffIncremental;
const automerge_updateDiffCursor = __vite__wasmModule.automerge_updateDiffCursor;
const automerge_resetDiffCursor = __vite__wasmModule.automerge_resetDiffCursor;
const automerge_diff = __vite__wasmModule.automerge_diff;
const automerge_isolate = __vite__wasmModule.automerge_isolate;
const automerge_integrate = __vite__wasmModule.automerge_integrate;
const automerge_length = __vite__wasmModule.automerge_length;
const automerge_delete = __vite__wasmModule.automerge_delete;
const automerge_save = __vite__wasmModule.automerge_save;
const automerge_saveIncremental = __vite__wasmModule.automerge_saveIncremental;
const automerge_saveSince = __vite__wasmModule.automerge_saveSince;
const automerge_saveNoCompress = __vite__wasmModule.automerge_saveNoCompress;
const automerge_saveAndVerify = __vite__wasmModule.automerge_saveAndVerify;
const automerge_loadIncremental = __vite__wasmModule.automerge_loadIncremental;
const automerge_applyChanges = __vite__wasmModule.automerge_applyChanges;
const automerge_getChanges = __vite__wasmModule.automerge_getChanges;
const automerge_getChangeByHash = __vite__wasmModule.automerge_getChangeByHash;
const automerge_getDecodedChangeByHash = __vite__wasmModule.automerge_getDecodedChangeByHash;
const automerge_getChangesAdded = __vite__wasmModule.automerge_getChangesAdded;
const automerge_getHeads = __vite__wasmModule.automerge_getHeads;
const automerge_getActorId = __vite__wasmModule.automerge_getActorId;
const automerge_getLastLocalChange = __vite__wasmModule.automerge_getLastLocalChange;
const automerge_dump = __vite__wasmModule.automerge_dump;
const automerge_getMissingDeps = __vite__wasmModule.automerge_getMissingDeps;
const automerge_receiveSyncMessage = __vite__wasmModule.automerge_receiveSyncMessage;
const automerge_generateSyncMessage = __vite__wasmModule.automerge_generateSyncMessage;
const automerge_toJS = __vite__wasmModule.automerge_toJS;
const automerge_materialize = __vite__wasmModule.automerge_materialize;
const automerge_getCursor = __vite__wasmModule.automerge_getCursor;
const automerge_getCursorPosition = __vite__wasmModule.automerge_getCursorPosition;
const automerge_emptyChange = __vite__wasmModule.automerge_emptyChange;
const automerge_mark = __vite__wasmModule.automerge_mark;
const automerge_unmark = __vite__wasmModule.automerge_unmark;
const automerge_marks = __vite__wasmModule.automerge_marks;
const automerge_marksAt = __vite__wasmModule.automerge_marksAt;
const automerge_hasOurChanges = __vite__wasmModule.automerge_hasOurChanges;
const automerge_topoHistoryTraversal = __vite__wasmModule.automerge_topoHistoryTraversal;
const automerge_stats = __vite__wasmModule.automerge_stats;
const create = __vite__wasmModule.create;
const load = __vite__wasmModule.load;
const encodeChange = __vite__wasmModule.encodeChange;
const decodeChange = __vite__wasmModule.decodeChange;
const initSyncState = __vite__wasmModule.initSyncState;
const importSyncState = __vite__wasmModule.importSyncState;
const exportSyncState = __vite__wasmModule.exportSyncState;
const encodeSyncMessage = __vite__wasmModule.encodeSyncMessage;
const decodeSyncMessage = __vite__wasmModule.decodeSyncMessage;
const encodeSyncState = __vite__wasmModule.encodeSyncState;
const decodeSyncState = __vite__wasmModule.decodeSyncState;
const __wbindgen_malloc = __vite__wasmModule.__wbindgen_malloc;
const __wbindgen_realloc = __vite__wasmModule.__wbindgen_realloc;
const __wbindgen_add_to_stack_pointer = __vite__wasmModule.__wbindgen_add_to_stack_pointer;
const __wbindgen_free = __vite__wasmModule.__wbindgen_free;
const __wbindgen_exn_store = __vite__wasmModule.__wbindgen_exn_store;

const wasm = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  __wbg_automerge_free,
  __wbg_syncstate_free,
  __wbindgen_add_to_stack_pointer,
  __wbindgen_exn_store,
  __wbindgen_free,
  __wbindgen_malloc,
  __wbindgen_realloc,
  automerge_applyAndReturnPatches,
  automerge_applyChanges,
  automerge_applyPatches,
  automerge_clone,
  automerge_commit,
  automerge_delete,
  automerge_diff,
  automerge_diffIncremental,
  automerge_dump,
  automerge_emptyChange,
  automerge_enableFreeze,
  automerge_fork,
  automerge_generateSyncMessage,
  automerge_get,
  automerge_getActorId,
  automerge_getAll,
  automerge_getBlock,
  automerge_getChangeByHash,
  automerge_getChanges,
  automerge_getChangesAdded,
  automerge_getCursor,
  automerge_getCursorPosition,
  automerge_getDecodedChangeByHash,
  automerge_getHeads,
  automerge_getLastLocalChange,
  automerge_getMissingDeps,
  automerge_getWithType,
  automerge_hasOurChanges,
  automerge_increment,
  automerge_insert,
  automerge_insertObject,
  automerge_integrate,
  automerge_isolate,
  automerge_joinBlock,
  automerge_keys,
  automerge_length,
  automerge_loadIncremental,
  automerge_mark,
  automerge_marks,
  automerge_marksAt,
  automerge_materialize,
  automerge_merge,
  automerge_new,
  automerge_objInfo,
  automerge_pendingOps,
  automerge_push,
  automerge_pushObject,
  automerge_put,
  automerge_putObject,
  automerge_receiveSyncMessage,
  automerge_registerDatatype,
  automerge_resetDiffCursor,
  automerge_rollback,
  automerge_save,
  automerge_saveAndVerify,
  automerge_saveIncremental,
  automerge_saveNoCompress,
  automerge_saveSince,
  automerge_spans,
  automerge_splice,
  automerge_splitBlock,
  automerge_stats,
  automerge_text,
  automerge_toJS,
  automerge_topoHistoryTraversal,
  automerge_unmark,
  automerge_updateBlock,
  automerge_updateDiffCursor,
  automerge_updateSpans,
  automerge_updateText,
  create,
  decodeChange,
  decodeSyncMessage,
  decodeSyncState,
  encodeChange,
  encodeSyncMessage,
  encodeSyncState,
  exportSyncState,
  importSyncState,
  initSyncState,
  load,
  memory,
  syncstate_clone,
  syncstate_lastSentHeads,
  syncstate_set_lastSentHeads,
  syncstate_set_sentHashes,
  syncstate_sharedHeads
}, Symbol.toStringTag, { value: 'Module' }));

__wbg_set_wasm(wasm);

const api = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  Automerge,
  SyncState,
  TextRepresentation,
  __wbg_String_91fba7ded13ba54c,
  __wbg_apply_0a5aa603881e6d79,
  __wbg_assign_496d2d14fecafbcf,
  __wbg_buffer_12d079cc21e14bdb,
  __wbg_call_27c0f87801dedf93,
  __wbg_call_b3ca7c6051f9bec1,
  __wbg_concat_3de229fe4fe90fea,
  __wbg_crypto_1d1f22824a6a080c,
  __wbg_defineProperty_cc00e2de8a0f5141,
  __wbg_deleteProperty_13e721a56f19e842,
  __wbg_done_298b57d23c0fc80c,
  __wbg_entries_95cc2c823b285a09,
  __wbg_error_f851667af71bcfc6,
  __wbg_for_27c67e2dbdce22f6,
  __wbg_freeze_cc6bc19f75299986,
  __wbg_from_89e3fc3ba5e6fb48,
  __wbg_getRandomValues_3aa56aa6edec874c,
  __wbg_getTime_2bc4375165f02d15,
  __wbg_get_bd8e338fbd5f5cc8,
  __wbg_get_e3c254076557e348,
  __wbg_globalThis_d1e6af4856ba331b,
  __wbg_global_207b558942527489,
  __wbg_instanceof_ArrayBuffer_836825be07d4c9d2,
  __wbg_instanceof_Date_f65cf97fb83fc369,
  __wbg_instanceof_Object_71ca3c0a59266746,
  __wbg_instanceof_Uint8Array_2b3bbecd033d19f6,
  __wbg_isArray_2ab64d95e09ea0ae,
  __wbg_iterator_2cee6dadfd956dfa,
  __wbg_keys_91e412b4b222659f,
  __wbg_length_c20a40f15020d68a,
  __wbg_length_cd7af8117672b8b8,
  __wbg_length_dee433d4c85c9387,
  __wbg_log_1746d5c75ec89963,
  __wbg_log_5bb5f88f245d7762,
  __wbg_msCrypto_eb05e62b530a1508,
  __wbg_new_16b304a2cfa7ff4a,
  __wbg_new_28c511d9baebfa89,
  __wbg_new_63b92bc8671ed464,
  __wbg_new_72fb9a18b5ae2624,
  __wbg_new_abda76e883ba8a5f,
  __wbg_new_cf3ec55744a78578,
  __wbg_new_dd6a5dd7b538af21,
  __wbg_newnoargs_e258087cd0daa0ea,
  __wbg_newwithbyteoffsetandlength_aa4a17c33a06e5cb,
  __wbg_newwithlength_e9b4878cebadb3d3,
  __wbg_next_196c84450b364254,
  __wbg_next_40fc327bfc8770e6,
  __wbg_node_104a2ff8d6ea03a2,
  __wbg_ownKeys_658942b7f28d1fe9,
  __wbg_process_4a72847cc503995b,
  __wbg_push_a5b05aedc7234f9f,
  __wbg_randomFillSync_5c9c955aa56b6049,
  __wbg_require_cca90b1a94a0255b,
  __wbg_self_ce0dbfc45cf2f5be,
  __wbg_set_1f9b04f170055d33,
  __wbg_set_20cbc34131e76824,
  __wbg_set_a47bac70306a19a7,
  __wbg_set_d4638f722068f043,
  __wbg_set_wasm,
  __wbg_slice_52fb626ffdc8da8f,
  __wbg_stack_658279fe44541cf6,
  __wbg_subarray_a1f73cd4b5b42fe1,
  __wbg_toString_7df3c77999517c20,
  __wbg_unshift_e22df4b34bcf5070,
  __wbg_value_d93c65011f51a456,
  __wbg_values_9c75e6e2bfbdb70d,
  __wbg_versions_f686565e586dd935,
  __wbg_window_c6fb939a7f436783,
  __wbindgen_bigint_from_i64,
  __wbindgen_bigint_from_u64,
  __wbindgen_boolean_get,
  __wbindgen_debug_string,
  __wbindgen_error_new,
  __wbindgen_is_array,
  __wbindgen_is_function,
  __wbindgen_is_null,
  __wbindgen_is_object,
  __wbindgen_is_string,
  __wbindgen_is_undefined,
  __wbindgen_json_serialize,
  __wbindgen_jsval_loose_eq,
  __wbindgen_memory,
  __wbindgen_number_get,
  __wbindgen_number_new,
  __wbindgen_object_clone_ref,
  __wbindgen_object_drop_ref,
  __wbindgen_string_get,
  __wbindgen_string_new,
  __wbindgen_throw,
  create: create$1,
  decodeChange: decodeChange$1,
  decodeSyncMessage: decodeSyncMessage$1,
  decodeSyncState: decodeSyncState$1,
  encodeChange: encodeChange$1,
  encodeSyncMessage: encodeSyncMessage$1,
  encodeSyncState: encodeSyncState$1,
  exportSyncState: exportSyncState$1,
  importSyncState: importSyncState$1,
  initSyncState: initSyncState$1,
  load: load$1
}, Symbol.toStringTag, { value: 'Module' }));

//@ts-ignore
UseApi(api);

init();

// https://github.com/maxogden/websocket-stream/blob/48dc3ddf943e5ada668c31ccd94e9186f02fafbd/ws-fallback.js

var ws = null;

if (typeof WebSocket !== 'undefined') {
  ws = WebSocket;
} else if (typeof MozWebSocket !== 'undefined') {
  ws = MozWebSocket;
} else if (typeof global !== 'undefined') {
  ws = global.WebSocket || global.MozWebSocket;
} else if (typeof window !== 'undefined') {
  ws = window.WebSocket || window.MozWebSocket;
} else if (typeof self !== 'undefined') {
  ws = self.WebSocket || self.MozWebSocket;
}

const WebSocket$1 = ws;

// TYPE GUARDS
const isPeerMessage = (message) => message.type === "peer";
const isErrorMessage = (message) => message.type === "error";

const ProtocolV1 = "1";

/* c8 ignore start */
function assert(value, message = "Assertion failed") {
    if (value === false || value === null || value === undefined) {
        const error = new Error(trimLines(message));
        error.stack = removeLine(error.stack, "assert.ts");
        throw error;
    }
}
const trimLines = (s) => s
    .split("\n")
    .map(s => s.trim())
    .join("\n");
const removeLine = (s = "", targetText) => s
    .split("\n")
    .filter(line => !line.includes(targetText))
    .join("\n");
/* c8 ignore end */

/**
 * This incantation deals with websocket sending the whole underlying buffer even if we just have a
 * uint8array view on it
 */
const toArrayBuffer = (bytes) => {
    const { buffer, byteOffset, byteLength } = bytes;
    return buffer.slice(byteOffset, byteOffset + byteLength);
};

class WebSocketNetworkAdapter extends NetworkAdapter {
    socket;
}
class BrowserWebSocketClientAdapter extends WebSocketNetworkAdapter {
    url;
    retryInterval;
    #isReady = false;
    #retryIntervalId;
    #log = debug("automerge-repo:websocket:browser");
    remotePeerId; // this adapter only connects to one remote client at a time
    constructor(url, retryInterval = 5000) {
        super();
        this.url = url;
        this.retryInterval = retryInterval;
        this.#log = this.#log.extend(url);
    }
    connect(peerId, peerMetadata) {
        if (!this.socket || !this.peerId) {
            // first time connecting
            this.#log("connecting");
            this.peerId = peerId;
            this.peerMetadata = peerMetadata ?? {};
        }
        else {
            this.#log("reconnecting");
            assert(peerId === this.peerId);
            // Remove the old event listeners before creating a new connection.
            this.socket.removeEventListener("open", this.onOpen);
            this.socket.removeEventListener("close", this.onClose);
            this.socket.removeEventListener("message", this.onMessage);
            this.socket.removeEventListener("error", this.onError);
        }
        // Wire up retries
        if (!this.#retryIntervalId)
            this.#retryIntervalId = setInterval(() => {
                this.connect(peerId, peerMetadata);
            }, this.retryInterval);
        this.socket = new WebSocket$1(this.url);
        this.socket.binaryType = "arraybuffer";
        this.socket.addEventListener("open", this.onOpen);
        this.socket.addEventListener("close", this.onClose);
        this.socket.addEventListener("message", this.onMessage);
        this.socket.addEventListener("error", this.onError);
        // Mark this adapter as ready if we haven't received an ack in 1 second.
        // We might hear back from the other end at some point but we shouldn't
        // hold up marking things as unavailable for any longer
        setTimeout(() => this.#ready(), 1000);
        this.join();
    }
    onOpen = () => {
        this.#log("open");
        clearInterval(this.#retryIntervalId);
        this.#retryIntervalId = undefined;
        this.join();
    };
    // When a socket closes, or disconnects, remove it from the array.
    onClose = () => {
        this.#log("close");
        if (this.remotePeerId)
            this.emit("peer-disconnected", { peerId: this.remotePeerId });
        if (this.retryInterval > 0 && !this.#retryIntervalId)
            // try to reconnect
            setTimeout(() => {
                assert(this.peerId);
                return this.connect(this.peerId, this.peerMetadata);
            }, this.retryInterval);
    };
    onMessage = (event) => {
        this.receiveMessage(event.data);
    };
    /** The websocket error handler signature is different on node and the browser.  */
    onError = (event // node
    ) => {
        if ("error" in event) {
            // (node)
            if (event.error.code !== "ECONNREFUSED") {
                /* c8 ignore next */
                throw event.error;
            }
        }
        this.#log("Connection failed, retrying...");
    };
    #ready() {
        if (this.#isReady)
            return;
        this.#isReady = true;
        this.emit("ready", { network: this });
    }
    join() {
        assert(this.peerId);
        assert(this.socket);
        if (this.socket.readyState === WebSocket$1.OPEN) {
            this.send(joinMessage(this.peerId, this.peerMetadata));
        }
    }
    disconnect() {
        assert(this.peerId);
        assert(this.socket);
        this.send({ type: "leave", senderId: this.peerId });
    }
    send(message) {
        if ("data" in message && message.data?.byteLength === 0)
            throw new Error("Tried to send a zero-length message");
        assert(this.peerId);
        assert(this.socket);
        if (this.socket.readyState !== WebSocket$1.OPEN)
            throw new Error(`Websocket not ready (${this.socket.readyState})`);
        const encoded = encode(message);
        this.socket.send(toArrayBuffer(encoded));
    }
    peerCandidate(remotePeerId, peerMetadata) {
        assert(this.socket);
        this.#ready();
        this.remotePeerId = remotePeerId;
        this.emit("peer-candidate", {
            peerId: remotePeerId,
            peerMetadata,
        });
    }
    receiveMessage(messageBytes) {
        const message = decode(new Uint8Array(messageBytes));
        assert(this.socket);
        if (messageBytes.byteLength === 0)
            throw new Error("received a zero-length message");
        if (isPeerMessage(message)) {
            const { peerMetadata } = message;
            this.#log(`peer: ${message.senderId}`);
            this.peerCandidate(message.senderId, peerMetadata);
        }
        else if (isErrorMessage(message)) {
            this.#log(`error: ${message.message}`);
        }
        else {
            this.emit("message", message);
        }
    }
}
function joinMessage(senderId, peerMetadata) {
    return {
        type: "join",
        senderId,
        peerMetadata,
        supportedProtocolVersions: [ProtocolV1],
    };
}

debug("WebsocketServer");

/**
 * This module provides a storage adapter for IndexedDB.
 *
 * @packageDocumentation
 */
class IndexedDBStorageAdapter {
    database;
    store;
    dbPromise;
    /** Create a new {@link IndexedDBStorageAdapter}.
     * @param database - The name of the database to use. Defaults to "automerge".
     * @param store - The name of the object store to use. Defaults to "documents".
     */
    constructor(database = "automerge", store = "documents") {
        this.database = database;
        this.store = store;
        this.dbPromise = this.createDatabasePromise();
    }
    createDatabasePromise() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.database, 1);
            request.onerror = () => {
                reject(request.error);
            };
            request.onupgradeneeded = event => {
                const db = event.target.result;
                db.createObjectStore(this.store);
            };
            request.onsuccess = event => {
                const db = event.target.result;
                resolve(db);
            };
        });
    }
    async load(keyArray) {
        const db = await this.dbPromise;
        const transaction = db.transaction(this.store);
        const objectStore = transaction.objectStore(this.store);
        const request = objectStore.get(keyArray);
        return new Promise((resolve, reject) => {
            transaction.onerror = () => {
                reject(request.error);
            };
            request.onsuccess = event => {
                const result = event.target.result;
                if (result && typeof result === "object" && "binary" in result) {
                    resolve(result.binary);
                }
                else {
                    resolve(undefined);
                }
            };
        });
    }
    async save(keyArray, binary) {
        const db = await this.dbPromise;
        const transaction = db.transaction(this.store, "readwrite");
        const objectStore = transaction.objectStore(this.store);
        objectStore.put({ key: keyArray, binary: binary }, keyArray);
        return new Promise((resolve, reject) => {
            transaction.onerror = () => {
                reject(transaction.error);
            };
            transaction.oncomplete = () => {
                resolve();
            };
        });
    }
    async remove(keyArray) {
        const db = await this.dbPromise;
        const transaction = db.transaction(this.store, "readwrite");
        const objectStore = transaction.objectStore(this.store);
        objectStore.delete(keyArray);
        return new Promise((resolve, reject) => {
            transaction.onerror = () => {
                reject(transaction.error);
            };
            transaction.oncomplete = () => {
                resolve();
            };
        });
    }
    async loadRange(keyPrefix) {
        const db = await this.dbPromise;
        const lowerBound = keyPrefix;
        const upperBound = [...keyPrefix, "\uffff"];
        const range = IDBKeyRange.bound(lowerBound, upperBound);
        const transaction = db.transaction(this.store);
        const objectStore = transaction.objectStore(this.store);
        const request = objectStore.openCursor(range);
        const result = [];
        return new Promise((resolve, reject) => {
            transaction.onerror = () => {
                reject(request.error);
            };
            request.onsuccess = event => {
                const cursor = event.target.result;
                if (cursor) {
                    result.push({
                        data: cursor.value.binary,
                        key: cursor.key,
                    });
                    cursor.continue();
                }
                else {
                    resolve(result);
                }
            };
        });
    }
    async removeRange(keyPrefix) {
        const db = await this.dbPromise;
        const lowerBound = keyPrefix;
        const upperBound = [...keyPrefix, "\uffff"];
        const range = IDBKeyRange.bound(lowerBound, upperBound);
        const transaction = db.transaction(this.store, "readwrite");
        const objectStore = transaction.objectStore(this.store);
        objectStore.delete(range);
        return new Promise((resolve, reject) => {
            transaction.onerror = () => {
                reject(transaction.error);
            };
            transaction.oncomplete = () => {
                resolve();
            };
        });
    }
}

const $RAW = Symbol("store-raw"),
  $NODE = Symbol("store-node"),
  $HAS = Symbol("store-has"),
  $SELF = Symbol("store-self");
function wrap$1(value) {
  let p = value[$PROXY];
  if (!p) {
    Object.defineProperty(value, $PROXY, {
      value: (p = new Proxy(value, proxyTraps$1))
    });
    if (!Array.isArray(value)) {
      const keys = Object.keys(value),
        desc = Object.getOwnPropertyDescriptors(value);
      for (let i = 0, l = keys.length; i < l; i++) {
        const prop = keys[i];
        if (desc[prop].get) {
          Object.defineProperty(value, prop, {
            enumerable: desc[prop].enumerable,
            get: desc[prop].get.bind(p)
          });
        }
      }
    }
  }
  return p;
}
function isWrappable(obj) {
  let proto;
  return (
    obj != null &&
    typeof obj === "object" &&
    (obj[$PROXY] ||
      !(proto = Object.getPrototypeOf(obj)) ||
      proto === Object.prototype ||
      Array.isArray(obj))
  );
}
function unwrap(item, set = new Set()) {
  let result, unwrapped, v, prop;
  if ((result = item != null && item[$RAW])) return result;
  if (!isWrappable(item) || set.has(item)) return item;
  if (Array.isArray(item)) {
    if (Object.isFrozen(item)) item = item.slice(0);
    else set.add(item);
    for (let i = 0, l = item.length; i < l; i++) {
      v = item[i];
      if ((unwrapped = unwrap(v, set)) !== v) item[i] = unwrapped;
    }
  } else {
    if (Object.isFrozen(item)) item = Object.assign({}, item);
    else set.add(item);
    const keys = Object.keys(item),
      desc = Object.getOwnPropertyDescriptors(item);
    for (let i = 0, l = keys.length; i < l; i++) {
      prop = keys[i];
      if (desc[prop].get) continue;
      v = item[prop];
      if ((unwrapped = unwrap(v, set)) !== v) item[prop] = unwrapped;
    }
  }
  return item;
}
function getNodes(target, symbol) {
  let nodes = target[symbol];
  if (!nodes)
    Object.defineProperty(target, symbol, {
      value: (nodes = Object.create(null))
    });
  return nodes;
}
function getNode(nodes, property, value) {
  if (nodes[property]) return nodes[property];
  const [s, set] = createSignal(value, {
    equals: false,
    internal: true
  });
  s.$ = set;
  return (nodes[property] = s);
}
function proxyDescriptor$1(target, property) {
  const desc = Reflect.getOwnPropertyDescriptor(target, property);
  if (!desc || desc.get || !desc.configurable || property === $PROXY || property === $NODE)
    return desc;
  delete desc.value;
  delete desc.writable;
  desc.get = () => target[$PROXY][property];
  return desc;
}
function trackSelf(target) {
  getListener() && getNode(getNodes(target, $NODE), $SELF)();
}
function ownKeys(target) {
  trackSelf(target);
  return Reflect.ownKeys(target);
}
const proxyTraps$1 = {
  get(target, property, receiver) {
    if (property === $RAW) return target;
    if (property === $PROXY) return receiver;
    if (property === $TRACK) {
      trackSelf(target);
      return receiver;
    }
    const nodes = getNodes(target, $NODE);
    const tracked = nodes[property];
    let value = tracked ? tracked() : target[property];
    if (property === $NODE || property === $HAS || property === "__proto__") return value;
    if (!tracked) {
      const desc = Object.getOwnPropertyDescriptor(target, property);
      if (
        getListener() &&
        (typeof value !== "function" || target.hasOwnProperty(property)) &&
        !(desc && desc.get)
      )
        value = getNode(nodes, property, value)();
    }
    return isWrappable(value) ? wrap$1(value) : value;
  },
  has(target, property) {
    if (
      property === $RAW ||
      property === $PROXY ||
      property === $TRACK ||
      property === $NODE ||
      property === $HAS ||
      property === "__proto__"
    )
      return true;
    getListener() && getNode(getNodes(target, $HAS), property)();
    return property in target;
  },
  set() {
    return true;
  },
  deleteProperty() {
    return true;
  },
  ownKeys: ownKeys,
  getOwnPropertyDescriptor: proxyDescriptor$1
};
function setProperty(state, property, value, deleting = false) {
  if (!deleting && state[property] === value) return;
  const prev = state[property],
    len = state.length;
  if (value === undefined) {
    delete state[property];
    if (state[$HAS] && state[$HAS][property] && prev !== undefined) state[$HAS][property].$();
  } else {
    state[property] = value;
    if (state[$HAS] && state[$HAS][property] && prev === undefined) state[$HAS][property].$();
  }
  let nodes = getNodes(state, $NODE),
    node;
  if ((node = getNode(nodes, property, prev))) node.$(() => value);
  if (Array.isArray(state) && state.length !== len) {
    for (let i = state.length; i < len; i++) (node = nodes[i]) && node.$();
    (node = getNode(nodes, "length", len)) && node.$(state.length);
  }
  (node = nodes[$SELF]) && node.$();
}
function mergeStoreNode(state, value) {
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    setProperty(state, key, value[key]);
  }
}
function updateArray(current, next) {
  if (typeof next === "function") next = next(current);
  next = unwrap(next);
  if (Array.isArray(next)) {
    if (current === next) return;
    let i = 0,
      len = next.length;
    for (; i < len; i++) {
      const value = next[i];
      if (current[i] !== value) setProperty(current, i, value);
    }
    setProperty(current, "length", len);
  } else mergeStoreNode(current, next);
}
function updatePath(current, path, traversed = []) {
  let part,
    prev = current;
  if (path.length > 1) {
    part = path.shift();
    const partType = typeof part,
      isArray = Array.isArray(current);
    if (Array.isArray(part)) {
      for (let i = 0; i < part.length; i++) {
        updatePath(current, [part[i]].concat(path), traversed);
      }
      return;
    } else if (isArray && partType === "function") {
      for (let i = 0; i < current.length; i++) {
        if (part(current[i], i)) updatePath(current, [i].concat(path), traversed);
      }
      return;
    } else if (isArray && partType === "object") {
      const { from = 0, to = current.length - 1, by = 1 } = part;
      for (let i = from; i <= to; i += by) {
        updatePath(current, [i].concat(path), traversed);
      }
      return;
    } else if (path.length > 1) {
      updatePath(current[part], path, [part].concat(traversed));
      return;
    }
    prev = current[part];
    traversed = [part].concat(traversed);
  }
  let value = path[0];
  if (typeof value === "function") {
    value = value(prev, traversed);
    if (value === prev) return;
  }
  if (part === undefined && value == undefined) return;
  value = unwrap(value);
  if (part === undefined || (isWrappable(prev) && isWrappable(value) && !Array.isArray(value))) {
    mergeStoreNode(prev, value);
  } else setProperty(current, part, value);
}
function createStore(...[store, options]) {
  const unwrappedStore = unwrap(store || {});
  const isArray = Array.isArray(unwrappedStore);
  const wrappedStore = wrap$1(unwrappedStore);
  function setStore(...args) {
    batch(() => {
      isArray && args.length === 1
        ? updateArray(unwrappedStore, args[0])
        : updatePath(unwrappedStore, args);
    });
  }
  return [wrappedStore, setStore];
}
const producers = new WeakMap();
const setterTraps = {
  get(target, property) {
    if (property === $RAW) return target;
    const value = target[property];
    let proxy;
    return isWrappable(value)
      ? producers.get(value) ||
          (producers.set(value, (proxy = new Proxy(value, setterTraps))), proxy)
      : value;
  },
  set(target, property, value) {
    setProperty(target, property, unwrap(value));
    return true;
  },
  deleteProperty(target, property) {
    setProperty(target, property, undefined, true);
    return true;
  }
};
function produce(fn) {
  return state => {
    if (isWrappable(state)) {
      let proxy;
      if (!(proxy = producers.get(state))) {
        producers.set(state, (proxy = new Proxy(state, setterTraps)));
      }
      fn(proxy);
    }
    return state;
  };
}

var webaudioTinysynth = {exports: {}};

var hasRequiredWebaudioTinysynth;

function requireWebaudioTinysynth () {
	if (hasRequiredWebaudioTinysynth) return webaudioTinysynth.exports;
	hasRequiredWebaudioTinysynth = 1;
	(function (module) {
		function WebAudioTinySynth(opt){
		  this.__proto__ = this.sy =
		  /* webaudio-tynysynth core object */
		  {
		    is:"webaudio-tinysynth",
		    properties:{
		      masterVol:  {type:Number, value:0.5, observer:"setMasterVol"},
		      reverbLev:  {type:Number, value:0.3, observer:"setReverbLev"},
		      quality:    {type:Number, value:1, observer:"setQuality"},
		      debug:      {type:Number, value:0},
		      src:        {type:String, value:null, observer:"loadMIDIUrl"},
		      loop:       {type:Number, value:0},
		      internalcontext: {type:Number, value:1},
		      tsmode:     {type:Number, value:0},
		      voices:     {type:Number, value:64},
		      useReverb:  {type:Number, value:1},
		      /**/
		    },
		    /**/
		    program:[
		// 1-8 : Piano
		      {name:"Acoustic Grand Piano"},    {name:"Bright Acoustic Piano"},
		      {name:"Electric Grand Piano"},    {name:"Honky-tonk Piano"},
		      {name:"Electric Piano 1"},        {name:"Electric Piano 2"},
		      {name:"Harpsichord"},             {name:"Clavi"},
		/* 9-16 : Chromatic Perc*/
		      {name:"Celesta"},                 {name:"Glockenspiel"},
		      {name:"Music Box"},               {name:"Vibraphone"},
		      {name:"Marimba"},                 {name:"Xylophone"},
		      {name:"Tubular Bells"},           {name:"Dulcimer"},
		/* 17-24 : Organ */
		      {name:"Drawbar Organ"},           {name:"Percussive Organ"},
		      {name:"Rock Organ"},              {name:"Church Organ"},
		      {name:"Reed Organ"},              {name:"Accordion"},
		      {name:"Harmonica"},               {name:"Tango Accordion"},
		/* 25-32 : Guitar */
		      {name:"Acoustic Guitar (nylon)"}, {name:"Acoustic Guitar (steel)"},
		      {name:"Electric Guitar (jazz)"},  {name:"Electric Guitar (clean)"},
		      {name:"Electric Guitar (muted)"}, {name:"Overdriven Guitar"},
		      {name:"Distortion Guitar"},       {name:"Guitar harmonics"},
		/* 33-40 : Bass */
		      {name:"Acoustic Bass"},           {name:"Electric Bass (finger)"},
		      {name:"Electric Bass (pick)"},    {name:"Fretless Bass"},
		      {name:"Slap Bass 1"},             {name:"Slap Bass 2"},
		      {name:"Synth Bass 1"},            {name:"Synth Bass 2"},
		/* 41-48 : Strings */
		      {name:"Violin"},                  {name:"Viola"},
		      {name:"Cello"},                   {name:"Contrabass"},
		      {name:"Tremolo Strings"},         {name:"Pizzicato Strings"},
		      {name:"Orchestral Harp"},         {name:"Timpani"},
		/* 49-56 : Ensamble */
		      {name:"String Ensemble 1"},       {name:"String Ensemble 2"},
		      {name:"SynthStrings 1"},          {name:"SynthStrings 2"},
		      {name:"Choir Aahs"},              {name:"Voice Oohs"},
		      {name:"Synth Voice"},             {name:"Orchestra Hit"},
		/* 57-64 : Brass */
		      {name:"Trumpet"},                 {name:"Trombone"},
		      {name:"Tuba"},                    {name:"Muted Trumpet"},
		      {name:"French Horn"},             {name:"Brass Section"},
		      {name:"SynthBrass 1"},            {name:"SynthBrass 2"},
		/* 65-72 : Reed */
		      {name:"Soprano Sax"},             {name:"Alto Sax"},
		      {name:"Tenor Sax"},               {name:"Baritone Sax"},
		      {name:"Oboe"},                    {name:"English Horn"},
		      {name:"Bassoon"},                 {name:"Clarinet"},
		/* 73-80 : Pipe */
		      {name:"Piccolo"},                 {name:"Flute"},
		      {name:"Recorder"},                {name:"Pan Flute"},
		      {name:"Blown Bottle"},            {name:"Shakuhachi"},
		      {name:"Whistle"},                 {name:"Ocarina"},
		/* 81-88 : SynthLead */
		      {name:"Lead 1 (square)"},         {name:"Lead 2 (sawtooth)"},
		      {name:"Lead 3 (calliope)"},       {name:"Lead 4 (chiff)"},
		      {name:"Lead 5 (charang)"},        {name:"Lead 6 (voice)"},
		      {name:"Lead 7 (fifths)"},         {name:"Lead 8 (bass + lead)"},
		/* 89-96 : SynthPad */
		      {name:"Pad 1 (new age)"},         {name:"Pad 2 (warm)"},
		      {name:"Pad 3 (polysynth)"},       {name:"Pad 4 (choir)"},
		      {name:"Pad 5 (bowed)"},           {name:"Pad 6 (metallic)"},
		      {name:"Pad 7 (halo)"},            {name:"Pad 8 (sweep)"},
		/* 97-104 : FX */
		      {name:"FX 1 (rain)"},             {name:"FX 2 (soundtrack)"},
		      {name:"FX 3 (crystal)"},          {name:"FX 4 (atmosphere)"},
		      {name:"FX 5 (brightness)"},       {name:"FX 6 (goblins)"},
		      {name:"FX 7 (echoes)"},           {name:"FX 8 (sci-fi)"},
		/* 105-112 : Ethnic */
		      {name:"Sitar"},                   {name:"Banjo"},
		      {name:"Shamisen"},                {name:"Koto"},
		      {name:"Kalimba"},                 {name:"Bag pipe"},
		      {name:"Fiddle"},                  {name:"Shanai"},
		/* 113-120 : Percussive */
		      {name:"Tinkle Bell"},             {name:"Agogo"},
		      {name:"Steel Drums"},             {name:"Woodblock"},
		      {name:"Taiko Drum"},              {name:"Melodic Tom"},
		      {name:"Synth Drum"},              {name:"Reverse Cymbal"},
		/* 121-128 : SE */
		      {name:"Guitar Fret Noise"},       {name:"Breath Noise"},
		      {name:"Seashore"},                {name:"Bird Tweet"},
		      {name:"Telephone Ring"},          {name:"Helicopter"},
		      {name:"Applause"},                {name:"Gunshot"},
		    ],
		    drummap:[
		// 35
		      {name:"Acoustic Bass Drum"},  {name:"Bass Drum 1"},      {name:"Side Stick"},     {name:"Acoustic Snare"},
		      {name:"Hand Clap"},           {name:"Electric Snare"},   {name:"Low Floor Tom"},  {name:"Closed Hi Hat"},
		      {name:"High Floor Tom"},      {name:"Pedal Hi-Hat"},     {name:"Low Tom"},        {name:"Open Hi-Hat"},
		      {name:"Low-Mid Tom"},         {name:"Hi-Mid Tom"},       {name:"Crash Cymbal 1"}, {name:"High Tom"},
		      {name:"Ride Cymbal 1"},       {name:"Chinese Cymbal"},   {name:"Ride Bell"},      {name:"Tambourine"},
		      {name:"Splash Cymbal"},       {name:"Cowbell"},          {name:"Crash Cymbal 2"}, {name:"Vibraslap"},
		      {name:"Ride Cymbal 2"},       {name:"Hi Bongo"},         {name:"Low Bongo"},      {name:"Mute Hi Conga"},
		      {name:"Open Hi Conga"},       {name:"Low Conga"},        {name:"High Timbale"},   {name:"Low Timbale"},
		      {name:"High Agogo"},          {name:"Low Agogo"},        {name:"Cabasa"},         {name:"Maracas"},
		      {name:"Short Whistle"},       {name:"Long Whistle"},     {name:"Short Guiro"},    {name:"Long Guiro"},
		      {name:"Claves"},              {name:"Hi Wood Block"},    {name:"Low Wood Block"}, {name:"Mute Cuica"},
		      {name:"Open Cuica"},          {name:"Mute Triangle"},    {name:"Open Triangle"},
		    ],
		    program1:[
		      // 1-8 : Piano
		      [{w:"sine",v:.4,d:0.7,r:0.1,},{w:"triangle",v:3,d:0.7,s:0.1,g:1,a:0.01,k:-1.2}],
		      [{w:"triangle",v:0.4,d:0.7,r:0.1,},{w:"triangle",v:4,t:3,d:0.4,s:0.1,g:1,k:-1,a:0.01,}],
		      [{w:"sine",d:0.7,r:0.1,},{w:"triangle",v:4,f:2,d:0.5,s:0.5,g:1,k:-1}],
		      [{w:"sine",d:0.7,v:0.2,},{w:"triangle",v:4,t:3,f:2,d:0.3,g:1,k:-1,a:0.01,s:0.5,}],
		      [{w:"sine",v:0.35,d:0.7,},{w:"sine",v:3,t:7,f:1,d:1,s:1,g:1,k:-.7}],
		      [{w:"sine",v:0.35,d:0.7,},{w:"sine",v:8,t:7,f:1,d:0.5,s:1,g:1,k:-.7}],
		      [{w:"sawtooth",v:0.34,d:2,},{w:"sine",v:8,f:0.1,d:2,s:1,r:2,g:1,}],
		      [{w:"triangle",v:0.34,d:1.5,},{w:"square",v:6,f:0.1,d:1.5,s:0.5,r:2,g:1,}],
		      /* 9-16 : Chromatic Perc*/
		      [{w:"sine",d:0.3,r:0.3,},{w:"sine",v:7,t:11,d:0.03,g:1,}],
		      [{w:"sine",d:0.3,r:0.3,},{w:"sine",v:11,t:6,d:0.2,s:0.4,g:1,}],
		      [{w:"sine",v:0.2,d:0.3,r:0.3,},{w:"sine",v:11,t:5,d:0.1,s:0.4,g:1,}],
		      [{w:"sine",v:0.2,d:0.6,r:0.6,},{w:"triangle",v:11,t:5,f:1,s:0.5,g:1,}],
		      [{w:"sine",v:0.3,d:0.2,r:0.2,},{w:"sine",v:6,t:5,d:0.02,g:1,}],
		      [{w:"sine",v:0.3,d:0.2,r:0.2,},{w:"sine",v:7,t:11,d:0.03,g:1,}],
		      [{w:"sine",v:0.2,d:1,r:1,},{w:"sine",v:11,t:3.5,d:1,r:1,g:1,}],
		      [{w:"triangle",v:0.2,d:0.5,r:0.2,},{w:"sine",v:6,t:2.5,d:0.2,s:0.1,r:0.2,g:1,}],
		      /* 17-24 : Organ */
		      [{w:"w9999",v:0.22,s:0.9,},{w:"w9999",v:0.22,t:2,f:2,s:0.9,}],
		      [{w:"w9999",v:0.2,s:1,},{w:"sine",v:11,t:6,f:2,s:0.1,g:1,h:0.006,r:0.002,d:0.002,},{w:"w9999",v:0.2,t:2,f:1,h:0,s:1,}],
		      [{w:"w9999",v:0.2,d:0.1,s:0.9,},{w:"w9999",v:0.25,t:4,f:2,s:0.5,}],
		      [{w:"w9999",v:0.3,a:0.04,s:0.9,},{w:"w9999",v:0.2,t:8,f:2,a:0.04,s:0.9,}],
		      [{w:"sine",v:0.2,a:0.02,d:0.05,s:1,},{w:"sine",v:6,t:3,f:1,a:0.02,d:0.05,s:1,g:1,}],
		      [{w:"triangle",v:0.2,a:0.02,d:0.05,s:0.8,},{w:"square",v:7,t:3,f:1,d:0.05,s:1.5,g:1,}],
		      [{w:"square",v:0.2,a:0.02,d:0.2,s:0.5,},{w:"square",v:1,d:0.03,s:2,g:1,}],
		      [{w:"square",v:0.2,a:0.02,d:0.1,s:0.8,},{w:"square",v:1,a:0.3,d:0.1,s:2,g:1,}],
		      /* 25-32 : Guitar */
		      [{w:"sine",v:0.3,d:0.5,f:1,},{w:"triangle",v:5,t:3,f:-1,d:1,s:0.1,g:1,}],
		      [{w:"sine",v:0.4,d:0.6,f:1,},{w:"triangle",v:12,t:3,d:0.6,s:0.1,g:1,f:-1,}],
		      [{w:"triangle",v:0.3,d:1,f:1,},{w:"triangle",v:6,f:-1,d:0.4,s:0.5,g:1,t:3,}],
		      [{w:"sine",v:0.3,d:1,f:-1,},{w:"triangle",v:11,f:1,d:0.4,s:0.5,g:1,t:3,}],
		      [{w:"sine",v:0.4,d:0.1,r:0.01},{w:"sine",v:7,g:1,}],
		      [{w:"triangle",v:0.4,d:1,f:1,},{w:"square",v:4,f:-1,d:1,s:0.7,g:1,}],//[{w:"triangle",v:0.35,d:1,f:1,},{w:"square",v:7,f:-1,d:0.3,s:0.5,g:1,}],
		      [{w:"triangle",v:0.35,d:1,f:1,},{w:"square",v:7,f:-1,d:0.3,s:0.5,g:1,}],//[{w:"triangle",v:0.4,d:1,f:1,},{w:"square",v:4,f:-1,d:1,s:0.7,g:1,}],//[{w:"triangle",v:0.4,d:1,},{w:"square",v:4,f:2,d:1,s:0.7,g:1,}],
		      [{w:"sine",v:0.2,t:1.5,a:0.005,h:0.2,d:0.6,},{w:"sine",v:11,t:5,f:2,d:1,s:0.5,g:1,}],
		      /* 33-40 : Bass */
		      [{w:"sine",d:0.3,},{w:"sine",v:4,t:3,d:1,s:1,g:1,}],
		      [{w:"sine",d:0.3,},{w:"sine",v:4,t:3,d:1,s:1,g:1,}],
		      [{w:"w9999",d:0.3,v:0.7,s:0.5,},{w:"sawtooth",v:1.2,d:0.02,s:0.5,g:1,h:0,r:0.02,}],
		      [{w:"sine",d:0.3,},{w:"sine",v:4,t:3,d:1,s:1,g:1,}],
		      [{w:"triangle",v:0.3,t:2,d:1,},{w:"triangle",v:15,t:2.5,d:0.04,s:0.1,g:1,}],
		      [{w:"triangle",v:0.3,t:2,d:1,},{w:"triangle",v:15,t:2.5,d:0.04,s:0.1,g:1,}],
		      [{w:"triangle",d:0.7,},{w:"square",v:0.4,t:0.5,f:1,d:0.2,s:10,g:1,}],
		      [{w:"triangle",d:0.7,},{w:"square",v:0.4,t:0.5,f:1,d:0.2,s:10,g:1,}],
		      /* 41-48 : Strings */
		      [{w:"sawtooth",v:0.4,a:0.1,d:11,},{w:"sine",v:5,d:11,s:0.2,g:1,}],
		      [{w:"sawtooth",v:0.4,a:0.1,d:11,},{w:"sine",v:5,d:11,s:0.2,g:1,}],
		      [{w:"sawtooth",v:0.4,a:0.1,d:11,},{w:"sine",v:5,t:0.5,d:11,s:0.2,g:1,}],
		      [{w:"sawtooth",v:0.4,a:0.1,d:11,},{w:"sine",v:5,t:0.5,d:11,s:0.2,g:1,}],
		      [{w:"sine",v:0.4,a:0.1,d:11,},{w:"sine",v:6,f:2.5,d:0.05,s:1.1,g:1,}],
		      [{w:"sine",v:0.3,d:0.1,r:0.1,},{w:"square",v:4,t:3,d:1,s:0.2,g:1,}],
		      [{w:"sine",v:0.3,d:0.5,r:0.5,},{w:"sine",v:7,t:2,f:2,d:1,r:1,g:1,}],
		      [{w:"triangle",v:0.6,h:0.03,d:0.3,r:0.3,t:0.5,},{w:"n0",v:8,t:1.5,d:0.08,r:0.08,g:1,}],
		      /* 49-56 : Ensamble */
		      [{w:"sawtooth",v:0.3,a:0.03,s:0.5,},{w:"sawtooth",v:0.2,t:2,f:2,d:1,s:2,}],
		      [{w:"sawtooth",v:0.3,f:-2,a:0.03,s:0.5,},{w:"sawtooth",v:0.2,t:2,f:2,d:1,s:2,}],
		      [{w:"sawtooth",v:0.2,a:0.02,s:1,},{w:"sawtooth",v:0.2,t:2,f:2,a:1,d:1,s:1,}],
		      [{w:"sawtooth",v:0.2,a:0.02,s:1,},{w:"sawtooth",v:0.2,f:2,a:0.02,d:1,s:1,}],
		      [{w:"triangle",v:0.3,a:0.03,s:1,},{w:"sine",v:3,t:5,f:1,d:1,s:1,g:1,}],
		      [{w:"sine",v:0.4,a:0.03,s:0.9,},{w:"sine",v:1,t:2,f:3,d:0.03,s:0.2,g:1,}],
		      [{w:"triangle",v:0.6,a:0.05,s:0.5,},{w:"sine",v:1,f:0.8,d:0.2,s:0.2,g:1,}],
		      [{w:"square",v:0.15,a:0.01,d:0.2,r:0.2,t:0.5,h:0.03,},{w:"square",v:4,f:0.5,d:0.2,r:11,a:0.01,g:1,h:0.02,},{w:"square",v:0.15,t:4,f:1,a:0.02,d:0.15,r:0.15,h:0.03,},{g:3,w:"square",v:4,f:-0.5,a:0.01,h:0.02,d:0.15,r:11,}],
		      /* 57-64 : Brass */
		      [{w:"square",v:0.2,a:0.01,d:1,s:0.6,r:0.04,},{w:"sine",v:1,d:0.1,s:4,g:1,}],
		      [{w:"square",v:0.2,a:0.02,d:1,s:0.5,r:0.08,},{w:"sine",v:1,d:0.1,s:4,g:1,}],
		      [{w:"square",v:0.2,a:0.04,d:1,s:0.4,r:0.08,},{w:"sine",v:1,d:0.1,s:4,g:1,}],
		      [{w:"square",v:0.15,a:0.04,s:1,},{w:"sine",v:2,d:0.1,g:1,}],
		      [{w:"square",v:0.2,a:0.02,d:1,s:0.5,r:0.08,},{w:"sine",v:1,d:0.1,s:4,g:1,}],
		      [{w:"square",v:0.2,a:0.02,d:1,s:0.6,r:0.08,},{w:"sine",v:1,f:0.2,d:0.1,s:4,g:1,}],
		      [{w:"square",v:0.2,a:0.02,d:0.5,s:0.7,r:0.08,},{w:"sine",v:1,d:0.1,s:4,g:1,}],
		      [{w:"square",v:0.2,a:0.02,d:1,s:0.5,r:0.08,},{w:"sine",v:1,d:0.1,s:4,g:1,}],
		      /* 65-72 : Reed */
		      [{w:"square",v:0.2,a:0.02,d:2,s:0.6,},{w:"sine",v:2,d:1,g:1,}],
		      [{w:"square",v:0.2,a:0.02,d:2,s:0.6,},{w:"sine",v:2,d:1,g:1,}],
		      [{w:"square",v:0.2,a:0.02,d:1,s:0.6,},{w:"sine",v:2,d:1,g:1,}],
		      [{w:"square",v:0.2,a:0.02,d:1,s:0.6,},{w:"sine",v:2,d:1,g:1,}],
		      [{w:"sine",v:0.4,a:0.02,d:0.7,s:0.5,},{w:"square",v:5,t:2,d:0.2,s:0.5,g:1,}],
		      [{w:"sine",v:0.3,a:0.05,d:0.2,s:0.8,},{w:"sawtooth",v:6,f:0.1,d:0.1,s:0.3,g:1,}],
		      [{w:"sine",v:0.3,a:0.03,d:0.2,s:0.4,},{w:"square",v:7,f:0.2,d:1,s:0.1,g:1,}],
		      [{w:"square",v:0.2,a:0.05,d:0.1,s:0.8,},{w:"square",v:4,d:0.1,s:1.1,g:1,}],
		      /* 73-80 : Pipe */
		      [{w:"sine",a:0.02,d:2,},{w:"sine",v:6,t:2,d:0.04,g:1,}],
		      [{w:"sine",v:0.7,a:0.03,d:0.4,s:0.4,},{w:"sine",v:4,t:2,f:0.2,d:0.4,g:1,}],
		      [{w:"sine",v:0.7,a:0.02,d:0.4,s:0.6,},{w:"sine",v:3,t:2,d:0,s:1,g:1,}],
		      [{w:"sine",v:0.4,a:0.06,d:0.3,s:0.3,},{w:"sine",v:7,t:2,d:0.2,s:0.2,g:1,}],
		      [{w:"sine",a:0.02,d:0.3,s:0.3,},{w:"sawtooth",v:3,t:2,d:0.3,g:1,}],
		      [{w:"sine",v:0.4,a:0.02,d:2,s:0.1,},{w:"sawtooth",v:8,t:2,f:1,d:0.5,g:1,}],
		      [{w:"sine",v:0.7,a:0.03,d:0.5,s:0.3,},{w:"sine",v:0.003,t:0,f:4,d:0.1,s:0.002,g:1,}],
		      [{w:"sine",v:0.7,a:0.02,d:2,},{w:"sine",v:1,t:2,f:1,d:0.02,g:1,}],
		      /* 81-88 : SynthLead */
		      [{w:"square",v:0.3,d:1,s:0.5,},{w:"square",v:1,f:0.2,d:1,s:0.5,g:1,}],
		      [{w:"sawtooth",v:0.3,d:2,s:0.5,},{w:"square",v:2,f:0.1,s:0.5,g:1,}],
		      [{w:"triangle",v:0.5,a:0.05,d:2,s:0.6,},{w:"sine",v:4,t:2,g:1,}],
		      [{w:"triangle",v:0.3,a:0.01,d:2,s:0.3,},{w:"sine",v:22,t:2,f:1,d:0.03,s:0.2,g:1,}],
		      [{w:"sawtooth",v:0.3,d:1,s:0.5,},{w:"sine",v:11,t:11,a:0.2,d:0.05,s:0.3,g:1,}],
		      [{w:"sine",v:0.3,a:0.06,d:1,s:0.5,},{w:"sine",v:7,f:1,d:1,s:0.2,g:1,}],
		      [{w:"sawtooth",v:0.3,a:0.03,d:0.7,s:0.3,r:0.2,},{w:"sawtooth",v:0.3,t:0.75,d:0.7,a:0.1,s:0.3,r:0.2,}],
		      [{w:"triangle",v:0.3,a:0.01,d:0.7,s:0.5,},{w:"square",v:5,t:0.5,d:0.7,s:0.5,g:1,}],
		      /* 89-96 : SynthPad */
		      [{w:"triangle",v:0.3,a:0.02,d:0.3,s:0.3,r:0.3,},{w:"square",v:3,t:4,f:1,a:0.02,d:0.1,s:1,g:1,},{w:"triangle",v:0.08,t:0.5,a:0.1,h:0,d:0.1,s:0.5,r:0.1,b:0,c:0,}],
		      [{w:"sine",v:0.3,a:0.05,d:1,s:0.7,r:0.3,},{w:"sine",v:2,f:1,d:0.3,s:1,g:1,}],
		      [{w:"square",v:0.3,a:0.03,d:0.5,s:0.3,r:0.1,},{w:"square",v:4,f:1,a:0.03,d:0.1,g:1,}],
		      [{w:"triangle",v:0.3,a:0.08,d:1,s:0.3,r:0.1,},{w:"square",v:2,f:1,d:0.3,s:0.3,g:1,t:4,a:0.08,}],
		      [{w:"sine",v:0.3,a:0.05,d:1,s:0.3,r:0.1,},{w:"sine",v:0.1,t:2.001,f:1,d:1,s:50,g:1,}],
		      [{w:"triangle",v:0.3,a:0.03,d:0.7,s:0.3,r:0.2,},{w:"sine",v:12,t:7,f:1,d:0.5,s:1.7,g:1,}],
		      [{w:"sine",v:0.3,a:0.05,d:1,s:0.3,r:0.1,},{w:"sawtooth",v:22,t:6,d:0.06,s:0.3,g:1,}],
		      [{w:"triangle",v:0.3,a:0.05,d:11,r:0.3,},{w:"triangle",v:1,d:1,s:8,g:1,}],
		      /* 97-104 : FX */
		      [{w:"sawtooth",v:0.3,d:4,s:0.8,r:0.1,},{w:"square",v:1,t:2,f:8,a:1,d:1,s:1,r:0.1,g:1,}],
		      [{w:"triangle",v:0.3,d:1,s:0.5,t:0.8,a:0.2,p:1.25,q:0.2,},{w:"sawtooth",v:0.2,a:0.2,d:0.3,s:1,t:1.2,p:1.25,q:0.2,}],
		      [{w:"sine",v:0.3,d:1,s:0.3,},{w:"square",v:22,t:11,d:0.5,s:0.1,g:1,}],
		      [{w:"sawtooth",v:0.3,a:0.04,d:1,s:0.8,r:0.1,},{w:"square",v:1,t:0.5,d:1,s:2,g:1,}],
		      [{w:"triangle",v:0.3,d:1,s:0.3,},{w:"sine",v:22,t:6,d:0.6,s:0.05,g:1,}],
		      [{w:"sine",v:0.6,a:0.1,d:0.05,s:0.4,},{w:"sine",v:5,t:5,f:1,d:0.05,s:0.3,g:1,}],
		      [{w:"sine",a:0.1,d:0.05,s:0.4,v:0.8,},{w:"sine",v:5,t:5,f:1,d:0.05,s:0.3,g:1,}],
		      [{w:"square",v:0.3,a:0.1,d:0.1,s:0.4,},{w:"square",v:1,f:1,d:0.3,s:0.1,g:1,}],
		      /* 105-112 : Ethnic */
		      [{w:"sawtooth",v:0.3,d:0.5,r:0.5,},{w:"sawtooth",v:11,t:5,d:0.05,g:1,}],
		      [{w:"square",v:0.3,d:0.2,r:0.2,},{w:"square",v:7,t:3,d:0.05,g:1,}],
		      [{w:"triangle",d:0.2,r:0.2,},{w:"square",v:9,t:3,d:0.1,r:0.1,g:1,}],
		      [{w:"triangle",d:0.3,r:0.3,},{w:"square",v:6,t:3,d:1,r:1,g:1,}],
		      [{w:"triangle",v:0.4,d:0.2,r:0.2,},{w:"square",v:22,t:12,d:0.1,r:0.1,g:1,}],
		      [{w:"sine",v:0.25,a:0.02,d:0.05,s:0.8,},{w:"square",v:1,t:2,d:0.03,s:11,g:1,}],
		      [{w:"sine",v:0.3,a:0.05,d:11,},{w:"square",v:7,t:3,f:1,s:0.7,g:1,}],
		      [{w:"square",v:0.3,a:0.05,d:0.1,s:0.8,},{w:"square",v:4,d:0.1,s:1.1,g:1,}],
		      /* 113-120 : Percussive */
		      [{w:"sine",v:0.4,d:0.3,r:0.3,},{w:"sine",v:7,t:9,d:0.1,r:0.1,g:1,}],
		      [{w:"sine",v:0.7,d:0.1,r:0.1,},{w:"sine",v:22,t:7,d:0.05,g:1,}],
		      [{w:"sine",v:0.6,d:0.15,r:0.15,},{w:"square",v:11,t:3.2,d:0.1,r:0.1,g:1,}],
		      [{w:"sine",v:0.8,d:0.07,r:0.07,},{w:"square",v:11,t:7,r:0.01,g:1,}],
		      [{w:"triangle",v:0.7,t:0.5,d:0.2,r:0.2,p:0.95,},{w:"n0",v:9,g:1,d:0.2,r:0.2,}],
		      [{w:"sine",v:0.7,d:0.1,r:0.1,p:0.9,},{w:"square",v:14,t:2,d:0.005,r:0.005,g:1,}],
		      [{w:"square",d:0.15,r:0.15,p:0.5,},{w:"square",v:4,t:5,d:0.001,r:0.001,g:1,}],
		      [{w:"n1",v:0.3,a:1,s:1,d:0.15,r:0,t:0.5,}],
		      /* 121-128 : SE */
		      [{w:"sine",t:12.5,d:0,r:0,p:0.5,v:0.3,h:0.2,q:0.5,},{g:1,w:"sine",v:1,t:2,d:0,r:0,s:1,},{g:1,w:"n0",v:0.2,t:2,a:0.6,h:0,d:0.1,r:0.1,b:0,c:0,}],
		      [{w:"n0",v:0.2,a:0.05,h:0.02,d:0.02,r:0.02,}],
		      [{w:"n0",v:0.4,a:1,d:1,t:0.25,}],
		      [{w:"sine",v:0.3,a:0.1,d:1,s:0.5,},{w:"sine",v:4,t:0,f:1.5,d:1,s:1,r:0.1,g:1,},{g:1,w:"sine",v:4,t:0,f:2,a:0.6,h:0,d:0.1,s:1,r:0.1,b:0,c:0,}],
		      [{w:"square",v:0.3,t:0.25,d:11,s:1,},{w:"square",v:12,t:0,f:8,d:1,s:1,r:11,g:1,}],
		      [{w:"n0",v:0.4,t:0.5,a:1,d:11,s:1,r:0.5,},{w:"square",v:1,t:0,f:14,d:1,s:1,r:11,g:1,}],
		      [{w:"sine",t:0,f:1221,a:0.2,d:1,r:0.25,s:1,},{g:1,w:"n0",v:3,t:0.5,d:1,s:1,r:1,}],
		      [{w:"sine",d:0.4,r:0.4,p:0.1,t:2.5,v:1,},{w:"n0",v:12,t:2,d:1,r:1,g:1,}],
		    ],
		    program0:[
		// 1-8 : Piano
		      [{w:"triangle",v:.5,d:.7}],                   [{w:"triangle",v:.5,d:.7}],
		      [{w:"triangle",v:.5,d:.7}],                   [{w:"triangle",v:.5,d:.7}],
		      [{w:"triangle",v:.5,d:.7}],                   [{w:"triangle",v:.5,d:.7}],
		      [{w:"sawtooth",v:.3,d:.7}],                   [{w:"sawtooth",v:.3,d:.7}],
		/* 9-16 : Chromatic Perc*/
		      [{w:"sine",v:.5,d:.3,r:.3}],                  [{w:"triangle",v:.5,d:.3,r:.3}],
		      [{w:"square",v:.2,d:.3,r:.3}],                [{w:"square",v:.2,d:.3,r:.3}],
		      [{w:"sine",v:.5,d:.1,r:.1}],                  [{w:"sine",v:.5,d:.1,r:.1}],
		      [{w:"square",v:.2,d:1,r:1}],                  [{w:"sawtooth",v:.3,d:.7,r:.7}],
		/* 17-24 : Organ */
		      [{w:"sine",v:0.5,a:0.01,s:1}],                [{w:"sine",v:0.7,d:0.02,s:0.7}],
		      [{w:"square",v:.2,s:1}],                      [{w:"triangle",v:.5,a:.01,s:1}],
		      [{w:"square",v:.2,a:.02,s:1}],                [{w:"square",v:0.2,a:0.02,s:1}],
		      [{w:"square",v:0.2,a:0.02,s:1}],              [{w:"square",v:.2,a:.05,s:1}],
		/* 25-32 : Guitar */
		      [{w:"triangle",v:.5,d:.5}],                   [{w:"square",v:.2,d:.6}],
		      [{w:"square",v:.2,d:.6}],                     [{w:"triangle",v:.8,d:.6}],
		      [{w:"triangle",v:.4,d:.05}],                  [{w:"square",v:.2,d:1}],
		      [{w:"square",v:.2,d:1}],                      [{w:"sine",v:.4,d:.6}],
		/* 33-40 : Bass */
		      [{w:"triangle",v:.7,d:.4}],                   [{w:"triangle",v:.7,d:.7}],
		      [{w:"triangle",v:.7,d:.7}],                   [{w:"triangle",v:.7,d:.7}],
		      [{w:"square",v:.3,d:.2}],                     [{w:"square",v:.3,d:.2}],
		      [{w:"square",v:.3,d:.1,s:.2}],                [{w:"sawtooth",v:.4,d:.1,s:.2}],
		/* 41-48 : Strings */
		      [{w:"sawtooth",v:.2,a:.02,s:1}],              [{w:"sawtooth",v:.2,a:.02,s:1}],
		      [{w:"sawtooth",v:.2,a:.02,s:1}],              [{w:"sawtooth",v:.2,a:.02,s:1}],
		      [{w:"sawtooth",v:.2,a:.02,s:1}],              [{w:"sawtooth",v:.3,d:.1}],
		      [{w:"sawtooth",v:.3,d:.5,r:.5}],              [{w:"triangle",v:.6,d:.1,r:.1,h:0.03,p:0.8}],
		/* 49-56 : Ensamble */
		      [{w:"sawtooth",v:.2,a:.02,s:1}],              [{w:"sawtooth",v:.2,a:.02,s:1}],
		      [{w:"sawtooth",v:.2,a:.02,s:1}],              [{w:"sawtooth",v:.2,a:.02,s:1}],
		      [{w:"triangle",v:.3,a:.03,s:1}],              [{w:"sine",v:.3,a:.03,s:1}],
		      [{w:"triangle",v:.3,a:.05,s:1}],              [{w:"sawtooth",v:.5,a:.01,d:.1}],
		/* 57-64 : Brass */
		      [{w:"square",v:.3,a:.05,d:.2,s:.6}],          [{w:"square",v:.3,a:.05,d:.2,s:.6}],
		      [{w:"square",v:.3,a:.05,d:.2,s:.6}],          [{w:"square",v:0.2,a:.05,d:0.01,s:1}],
		      [{w:"square",v:.3,a:.05,s:1}],                [{w:"square",v:.3,s:.7}],
		      [{w:"square",v:.3,s:.7}],                     [{w:"square",v:.3,s:.7}],
		/* 65-72 : Reed */
		      [{w:"square",v:.3,a:.02,d:2}],                [{w:"square",v:.3,a:.02,d:2}],
		      [{w:"square",v:.3,a:.03,d:2}],                [{w:"square",v:.3,a:.04,d:2}],
		      [{w:"square",v:.3,a:.02,d:2}],                [{w:"square",v:.3,a:.05,d:2}],
		      [{w:"square",v:.3,a:.03,d:2}],                [{w:"square",v:.3,a:.03,d:2}],
		/* 73-80 : Pipe */
		      [{w:"sine",v:.7,a:.02,d:2}],                  [{w:"sine",v:.7,a:.02,d:2}],
		      [{w:"sine",v:.7,a:.02,d:2}],                  [{w:"sine",v:.7,a:.02,d:2}],
		      [{w:"sine",v:.7,a:.02,d:2}],                  [{w:"sine",v:.7,a:.02,d:2}],
		      [{w:"sine",v:.7,a:.02,d:2}],                  [{w:"sine",v:.7,a:.02,d:2}],
		/* 81-88 : SynthLead */
		      [{w:"square",v:.3,s:.7}],                     [{w:"sawtooth",v:.4,s:.7}],
		      [{w:"triangle",v:.5,s:.7}],                   [{w:"sawtooth",v:.4,s:.7}],
		      [{w:"sawtooth",v:.4,d:12}],                   [{w:"sine",v:.4,a:.06,d:12}],
		      [{w:"sawtooth",v:.4,d:12}],                   [{w:"sawtooth",v:.4,d:12}],
		/* 89-96 : SynthPad */
		      [{w:"sawtooth",v:.3,d:12}],                   [{w:"triangle",v:.5,d:12}],
		      [{w:"square",v:.3,d:12}],                     [{w:"triangle",v:.5,a:.08,d:11}],
		      [{w:"sawtooth",v:.5,a:.05,d:11}],             [{w:"sawtooth",v:.5,d:11}],
		      [{w:"triangle",v:.5,d:11}],                   [{w:"triangle",v:.5,d:11}],
		/* 97-104 : FX */
		      [{w:"triangle",v:.5,d:11}],                   [{w:"triangle",v:.5,d:11}],
		      [{w:"square",v:.3,d:11}],                     [{w:"sawtooth",v:0.5,a:0.04,d:11}],
		      [{w:"sawtooth",v:.5,d:11}],                   [{w:"triangle",v:.5,a:.8,d:11}],
		      [{w:"triangle",v:.5,d:11}],                   [{w:"square",v:.3,d:11}],
		/* 105-112 : Ethnic */
		      [{w:"sawtooth",v:.3,d:1,r:1}],                [{w:"sawtooth",v:.5,d:.3}],
		      [{w:"sawtooth",v:.5,d:.3,r:.3}],              [{w:"sawtooth",v:.5,d:.3,r:.3}],
		      [{w:"square",v:.3,d:.2,r:.2}],                [{w:"square",v:.3,a:.02,d:2}],
		      [{w:"sawtooth",v:.2,a:.02,d:.7}],             [{w:"triangle",v:.5,d:1}],
		/* 113-120 : Percussive */
		      [{w:"sawtooth",v:.3,d:.3,r:.3}],              [{w:"sine",v:.8,d:.1,r:.1}],
		      [{w:"square",v:.2,d:.1,r:.1,p:1.05}],         [{w:"sine",v:.8,d:.05,r:.05}],
		      [{w:"triangle",v:0.5,d:0.1,r:0.1,p:0.96}],    [{w:"triangle",v:0.5,d:0.1,r:0.1,p:0.97}],
		      [{w:"square",v:.3,d:.1,r:.1,}],               [{w:"n1",v:0.3,a:1,s:1,d:0.15,r:0,t:0.5,}],
		/* 121-128 : SE */
		      [{w:"triangle",v:0.5,d:0.03,t:0,f:1332,r:0.001,p:1.1}],
		      [{w:"n0",v:0.2,t:0.1,d:0.02,a:0.05,h:0.02,r:0.02}],
		      [{w:"n0",v:0.4,a:1,d:1,t:0.25,}],
		      [{w:"sine",v:0.3,a:0.8,d:1,t:0,f:1832}],
		      [{w:"triangle",d:0.5,t:0,f:444,s:1,}],
		      [{w:"n0",v:0.4,d:1,t:0,f:22,s:1,}],
		      [{w:"n0",v:0.5,a:0.2,d:11,t:0,f:44}],
		      [{w:"n0",v:0.5,t:0.25,d:0.4,r:0.4}],
		    ],
		    drummap1:[
		/*35*/  [{w:"triangle",t:0,f:70,v:1,d:0.05,h:0.03,p:0.9,q:0.1,},{w:"n0",g:1,t:6,v:17,r:0.01,h:0,p:0,}],
		        [{w:"triangle",t:0,f:88,v:1,d:0.05,h:0.03,p:0.5,q:0.1,},{w:"n0",g:1,t:5,v:42,r:0.01,h:0,p:0,}],
		        [{w:"n0",f:222,p:0,t:0,r:0.01,h:0,}],
		        [{w:"triangle",v:0.3,f:180,d:0.05,t:0,h:0.03,p:0.9,q:0.1,},{w:"n0",v:0.6,t:0,f:70,h:0.02,r:0.01,p:0,},{g:1,w:"square",v:2,t:0,f:360,r:0.01,b:0,c:0,}],
		        [{w:"square",f:1150,v:0.34,t:0,r:0.03,h:0.025,d:0.03,},{g:1,w:"n0",t:0,f:13,h:0.025,d:0.1,s:1,r:0.1,v:1,}],
		/*40*/  [{w:"triangle",f:200,v:1,d:0.06,t:0,r:0.06,},{w:"n0",g:1,t:0,f:400,v:12,r:0.02,d:0.02,}],
		        [{w:"triangle",f:100,v:0.9,d:0.12,h:0.02,p:0.5,t:0,r:0.12,},{g:1,w:"n0",v:5,t:0.4,h:0.015,d:0.005,r:0.005,}],
		        [{w:"n1",f:390,v:0.25,r:0.01,t:0,}],
		        [{w:"triangle",f:120,v:0.9,d:0.12,h:0.02,p:0.5,t:0,r:0.12,},{g:1,w:"n0",v:5,t:0.5,h:0.015,d:0.005,r:0.005,}],
		        [{w:"n1",v:0.25,f:390,r:0.03,t:0,h:0.005,d:0.03,}],
		/*45*/  [{w:"triangle",f:140,v:0.9,d:0.12,h:0.02,p:0.5,t:0,r:0.12,},{g:1,w:"n0",v:5,t:0.3,h:0.015,d:0.005,r:0.005,}],
		        [{w:"n1",v:0.25,f:390,t:0,d:0.2,r:0.2,},{w:"n0",v:0.3,t:0,c:0,f:440,h:0.005,d:0.05,}],
		        [{w:"triangle",f:155,v:0.9,d:0.12,h:0.02,p:0.5,t:0,r:0.12,},{g:1,w:"n0",v:5,t:0.3,h:0.015,d:0.005,r:0.005,}],
		        [{w:"triangle",f:180,v:0.9,d:0.12,h:0.02,p:0.5,t:0,r:0.12,},{g:1,w:"n0",v:5,t:0.3,h:0.015,d:0.005,r:0.005,}],
		        [{w:"n1",v:0.3,f:1200,d:0.2,r:0.2,h:0.05,t:0,},{w:"n1",t:0,v:1,d:0.1,r:0.1,p:1.2,f:440,}],
		/*50*/  [{w:"triangle",f:220,v:0.9,d:0.12,h:0.02,p:0.5,t:0,r:0.12,},{g:1,w:"n0",v:5,t:0.3,h:0.015,d:0.005,r:0.005,}],
		        [{w:"n1",f:500,v:0.15,d:0.4,r:0.4,h:0,t:0,},{w:"n0",v:0.1,t:0,r:0.01,f:440,}],
		        [{w:"n1",v:0.3,f:800,d:0.2,r:0.2,h:0.05,t:0,},{w:"square",t:0,v:1,d:0.1,r:0.1,p:0.1,f:220,g:1,}],
		        [{w:"sine",f:1651,v:0.15,d:0.2,r:0.2,h:0,t:0,},{w:"sawtooth",g:1,t:1.21,v:7.2,d:0.1,r:11,h:1,},{g:1,w:"n0",v:3.1,t:0.152,d:0.002,r:0.002,}],
		        null,
		/*55*/  [{w:"n1",v:.3,f:1200,d:0.2,r:0.2,h:0.05,t:0,},{w:"n1",t:0,v:1,d:0.1,r:0.1,p:1.2,f:440,}],
		        null,
		        [{w:"n1",v:0.3,f:555,d:0.25,r:0.25,h:0.05,t:0,},{w:"n1",t:0,v:1,d:0.1,r:0.1,f:440,a:0.005,h:0.02,}],
		        [{w:"sawtooth",f:776,v:0.2,d:0.3,t:0,r:0.3,},{g:1,w:"n0",v:2,t:0,f:776,a:0.005,h:0.02,d:0.1,s:1,r:0.1,c:0,},{g:11,w:"sine",v:0.1,t:0,f:22,d:0.3,r:0.3,b:0,c:0,}],
		        [{w:"n1",f:440,v:0.15,d:0.4,r:0.4,h:0,t:0,},{w:"n0",v:0.4,t:0,r:0.01,f:440,}],
		/*60*/  null,null,null,null,null,
		/*65*/  null,null,null,null,null,
		/*70*/  null,null,null,null,null,
		/*75*/  null,null,null,null,null,
		/*80*/  [{w:"sine",f:1720,v:0.3,d:0.02,t:0,r:0.02,},{w:"square",g:1,t:0,f:2876,v:6,d:0.2,s:1,r:0.2,}],
		        [{w:"sine",f:1720,v:0.3,d:0.25,t:0,r:0.25,},{w:"square",g:1,t:0,f:2876,v:6,d:0.2,s:1,r:0.2,}],
		    ],
		    drummap0:[
		/*35*/[{w:"triangle",t:0,f:110,v:1,d:0.05,h:0.02,p:0.1,}],
		      [{w:"triangle",t:0,f:150,v:0.8,d:0.1,p:0.1,h:0.02,r:0.01,}],
		      [{w:"n0",f:392,v:0.5,d:0.01,p:0,t:0,r:0.05}],
		      [{w:"n0",f:33,d:0.05,t:0,}],
		      [{w:"n0",f:100,v:0.7,d:0.03,t:0,r:0.03,h:0.02,}],
		/*40*/[{w:"n0",f:44,v:0.7,d:0.02,p:0.1,t:0,h:0.02,}],
		      [{w:"triangle",f:240,v:0.9,d:0.1,h:0.02,p:0.1,t:0,}],
		      [{w:"n0",f:440,v:0.2,r:0.01,t:0,}],
		      [{w:"triangle",f:270,v:0.9,d:0.1,h:0.02,p:0.1,t:0,}],
		      [{w:"n0",f:440,v:0.2,d:0.04,r:0.04,t:0,}],
		/*45*/[{w:"triangle",f:300,v:0.9,d:0.1,h:0.02,p:0.1,t:0,}],
		      [{w:"n0",f:440,v:0.2,d:0.1,r:0.1,h:0.02,t:0,}],
		      [{w:"triangle",f:320,v:0.9,d:0.1,h:0.02,p:0.1,t:0,}],
		      [{w:"triangle",f:360,v:0.9,d:0.1,h:0.02,p:0.1,t:0,}],
		      [{w:"n0",f:150,v:0.2,d:0.1,r:0.1,h:0.05,t:0,p:0.1,}],
		/*50*/[{w:"triangle",f:400,v:0.9,d:0.1,h:0.02,p:0.1,t:0,}],
		      [{w:"n0",f:150,v:0.2,d:0.1,r:0.01,h:0.05,t:0,p:0.1}],
		      [{w:"n0",f:150,v:0.2,d:0.1,r:0.01,h:0.05,t:0,p:0.1}],
		      [{w:"n0",f:440,v:0.3,d:0.1,p:0.9,t:0,r:0.1,}],
		      [{w:"n0",f:200,v:0.2,d:0.05,p:0.9,t:0,}],
		/*55*/[{w:"n0",f:440,v:0.3,d:0.12,p:0.9,t:0,}],
		      [{w:"sine",f:800,v:0.4,d:0.06,t:0,}],
		      [{w:"n0",f:150,v:0.2,d:0.1,r:0.01,h:0.05,t:0,p:0.1}],
		      [{w:"n0",f:33,v:0.3,d:0.2,p:0.9,t:0,}],
		      [{w:"n0",f:300,v:0.3,d:0.14,p:0.9,t:0,}],
		/*60*/[{w:"sine",f:200,d:0.06,t:0,}],
		      [{w:"sine",f:150,d:0.06,t:0,}],
		      [{w:"sine",f:300,t:0,}],
		      [{w:"sine",f:300,d:0.06,t:0,}],
		      [{w:"sine",f:250,d:0.06,t:0,}],
		/*65*/[{w:"square",f:300,v:.3,d:.06,p:.8,t:0,}],
		      [{w:"square",f:260,v:.3,d:.06,p:.8,t:0,}],
		      [{w:"sine",f:850,v:.5,d:.07,t:0,}],
		      [{w:"sine",f:790,v:.5,d:.07,t:0,}],
		      [{w:"n0",f:440,v:0.3,a:0.05,t:0,}],
		/*70*/[{w:"n0",f:440,v:0.3,a:0.05,t:0,}],
		      [{w:"triangle",f:1800,v:0.4,p:0.9,t:0,h:0.03,}],
		      [{w:"triangle",f:1800,v:0.3,p:0.9,t:0,h:0.13,}],
		      [{w:"n0",f:330,v:0.3,a:0.02,t:0,r:0.01,}],
		      [{w:"n0",f:330,v:0.3,a:0.02,t:0,h:0.04,r:0.01,}],
		/*75*/[{w:"n0",f:440,v:0.3,t:0,}],
		      [{w:"sine",f:800,t:0,}],
		      [{w:"sine",f:700,t:0,}],
		      [{w:"n0",f:330,v:0.3,t:0,}],
		      [{w:"n0",f:330,v:0.3,t:0,h:0.1,r:0.01,p:0.7,}],
		/*80*/[{w:"sine",t:0,f:1200,v:0.3,r:0.01,}],
		      [{w:"sine",t:0,f:1200,v:0.3,d:0.2,r:0.2,}],

		    ],
		    /**/
		    ready:function(){
		      var i;
		      this.pg=[]; this.vol=[]; this.ex=[]; this.bend=[]; this.rpnidx=[]; this.brange=[];
		      this.sustain=[]; this.notetab=[]; this.rhythm=[];
		      this.maxTick=0, this.playTick=0, this.playing=0; this.releaseRatio=3.5;
		      for(var i=0;i<16;++i){
		        this.pg[i]=0; this.vol[i]=3*100*100/(127*127);
		        this.bend[i]=0; this.brange[i]=0x100;
		        this.rhythm[i]=0;
		      }
		      this.rhythm[9]=1;
		      /**/
		      this.preroll=0.2;
		      this.relcnt=0;
		      setInterval(
		        function(){
		          if(++this.relcnt>=3){
		            this.relcnt=0;
		            for(var i=this.notetab.length-1;i>=0;--i){
		              var nt=this.notetab[i];
		              if(this.actx.currentTime>nt.e){
		                this._pruneNote(nt);
		                this.notetab.splice(i,1);
		              }
		            }
		            /**/
		          }
		          if(this.playing && this.song.ev.length>0){
		            var e=this.song.ev[this.playIndex];
		            while(this.actx.currentTime+this.preroll>this.playTime){
		              if(e.m[0]==0xff51){
		                this.song.tempo=e.m[1];
		                this.tick2Time=4*60/this.song.tempo/this.song.timebase;
		              }
		              else
		                this.send(e.m,this.playTime);
		              ++this.playIndex;
		              if(this.playIndex>=this.song.ev.length){
		                if(this.loop){
		                  e=this.song.ev[this.playIndex=0];
		                  this.playTick=e.t;
		                }
		                else {
		                  this.playTick=this.maxTick;
		                  this.playing=0;
		                  break;
		                }
		              }
		              else {
		                e=this.song.ev[this.playIndex];
		                this.playTime+=(e.t-this.playTick)*this.tick2Time;
		                this.playTick=e.t;
		              }
		            }
		          }
		        }.bind(this),60
		      );
		      // console.log("internalcontext:"+this.internalcontext)
		      if(this.internalcontext){
		        window.AudioContext = window.AudioContext || window.webkitAudioContext;
		        this.setAudioContext(new AudioContext());
		      }
		      this.isReady=1;
		    },
		    setMasterVol:function(v){
		      if(v!=undefined)
		        this.masterVol=v;
		      if(this.out)
		        this.out.gain.value=this.masterVol;
		    },
		    setReverbLev:function(v){
		      if(v!=undefined)
		        this.reverbLev=v;
		      var r=parseFloat(this.reverbLev);
		      if(this.rev&&!isNaN(r))
		        this.rev.gain.value=r*8;
		    },
		    setLoop:function(f){
		      this.loop=f;
		    },
		    setVoices:function(v){
		      this.voices=v;
		    },
		    getPlayStatus:function(){
		      return {play:this.playing, maxTick:this.maxTick, curTick:this.playTick};
		    },
		    locateMIDI:function(tick){
		      var i,p=this.playing;
		      this.stopMIDI();
		      for(i=0;i<this.song.ev.length && tick>this.song.ev[i].t;++i){
		        var m=this.song.ev[i];
		        var ch=m.m[0]&0xf;
		        switch(m.m[0]&0xf0){
		        case 0xb0:
		          switch(m.m[1]){
		          case 1:  this.setModulation(ch,m.m[2]); break;
		          case 7:  this.setChVol(ch,m.m[2]); break;
		          case 10: this.setPan(ch,m.m[2]); break;
		          case 11: this.setExpression(ch,m.m[2]); break;
		          case 64: this.setSustain(ch,m.m[2]); break;
		          }
		          break;
		        case 0xc0: this.pg[m.m[0]&0x0f]=m.m[1]; break;
		        }
		        if(m.m[0]==0xff51)
		          this.song.tempo=m.m[1];
		      }
		      if(!this.song.ev[i]){
		        this.playIndex=0;
		        this.playTick=this.maxTick;
		      }
		      else {
		        this.playIndex=i;
		        this.playTick=this.song.ev[i].t;
		      }
		      if(p)
		        this.playMIDI();
		    },
		    getTimbreName:function(m,n){
		      if(m==0)
		        return this.program[n].name;
		      else
		        return this.drummap[n-35].name;
		    },
		    loadMIDIUrl:function(url){
		      if(!url)
		        return;
		      var xhr=new XMLHttpRequest();
		      xhr.open("GET",url,true);
		      xhr.responseType="arraybuffer";
		      xhr.loadMIDI=this.loadMIDI.bind(this);
		      xhr.onload=function(e){
		        if(this.status==200){
		          this.loadMIDI(this.response);
		        }
		      };
		      xhr.send();
		    },
		    reset:function(){
		      for(var i=0;i<16;++i){
		        this.setProgram(i,0);
		        this.setBendRange(i,0x100);
		        this.setChVol(i,100);
		        this.setPan(i,64);
		        this.resetAllControllers(i);
		        this.allSoundOff(i);
		        this.rhythm[i]=0;
		      }
		      this.rhythm[9]=1;
		    },
		    stopMIDI:function(){
		      this.playing=0;
		      for(var i=0;i<16;++i)
		        this.allSoundOff(i);
		    },
		    playMIDI:function(){
		      if(!this.song)
		        return;
		      var dummy=this.actx.createOscillator();
		      dummy.connect(this.actx.destination);
		      dummy.frequency.value=0;
		      dummy.start(0);
		      dummy.stop(this.actx.currentTime+0.001);
		      if(this.playTick>=this.maxTick)
		        this.playTick=0,this.playIndex=0;
		      this.playTime=this.actx.currentTime+.1;
		      this.tick2Time=4*60/this.song.tempo/this.song.timebase;
		      this.playing=1;
		    },
		    loadMIDI:function(data){
		      function Get2(s, i) { return (s[i]<<8) + s[i+1]; }
		      function Get3(s, i) { return (s[i]<<16) + (s[i+1]<<8) + s[i+2]; }
		      function Get4(s, i) { return (s[i]<<24) + (s[i+1]<<16) + (s[i+2]<<8) + s[i+3]; }
		      function GetStr(s, i, len) {
		        return String.fromCharCode.apply(null,s.slice(i,i+len));
		      }
		      function Delta(s, i) {
		        var v, d;
		        v = 0;
		        datalen = 1;
		        while((d = s[i]) & 0x80) {
		          v = (v<<7) + (d&0x7f);
		          ++datalen;
		          ++i;
		        }
		        return (v<<7)+d;
		      }
		      function Msg(song,tick,s,i){
		        var v=s[i];
		        datalen=1;
		        if((v&0x80)==0)
		          v=runst,datalen=0;
		        runst=v;
		        switch(v&0xf0){
		        case 0xc0: case 0xd0:
		          song.ev.push({t:tick,m:[v,s[i+datalen]]});
		          datalen+=1;
		          break;
		        case 0xf0:
		          switch(v) {
		          case 0xf0:
		          case 0xf7:
		            var len=Delta(s,i+1);
		            datastart=1+datalen;
		            var exd=Array.from(s.slice(i+datastart,i+datastart+len));
		            exd.unshift(0xf0);
		            song.ev.push({t:tick,m:exd});
		/*
		            var sysex=[];
		            for(var jj=0;jj<len;++jj)
		              sysex.push(s[i+datastart+jj].toString(16));
		            console.log(sysex);
		*/
		            datalen+=len+1;
		            break;
		          case 0xff:
		            var len = Delta(s, i + 2);
		            datastart = 2+datalen;
		            datalen = len+datalen+2;
		            switch(s[i+1]) {
		            case 0x02: song.copyright+=GetStr(s, i + datastart, datalen - 3); break;
		            case 0x01: case 0x03: case 0x04: case 0x09:
		              song.text=GetStr(s, i + datastart, datalen - datastart);
		              break;
		            case 0x2f:
		              return 1;
		            case 0x51:
		              var val = Math.floor(60000000 / Get3(s, i + 3));
		              song.ev.push({t:tick, m:[0xff51, val]});
		              break;
		            }
		            break;
		          }
		          break;
		        default:
		          song.ev.push({t:tick,m:[v,s[i+datalen],s[i+datalen+1]]});
		          datalen+=2;
		        }
		        return 0;
		      }
		      this.stopMIDI();
		      var s=new Uint8Array(data);
		      var datalen = 0, datastart = 0, runst = 0x90;
		      var idx = 0;
		      var hd = s.slice(0,  4);
		      if(hd.toString()!="77,84,104,100")  //MThd
		        return;
		      var len = Get4(s, 4);
		      Get2(s, 8);
		      var numtrk = Get2(s, 10);
		      this.maxTick=0;
		      var tb = Get2(s, 12)*4;
		      idx = (len + 8);
		      this.song={copyright:"",text:"",tempo:120,timebase:tb,ev:[]};
		      for(var tr=0;tr<numtrk;++tr){
		        hd=s.slice(idx, idx+4);
		        len=Get4(s, idx+4);
		        if(hd.toString()=="77,84,114,107") {//MTrk
		          var tick = 0;
		          var j = 0;
		          this.notetab.length = 0;
		          for(;;) {
		            tick += Delta(s, idx + 8 + j);
		            j += datalen;
		            var e = Msg(this.song, tick, s, idx + 8 + j);
		            j += datalen;
		            if(e)
		              break;
		          }
		          if(tick>this.maxTick)
		            this.maxTick=tick;
		        }
		        idx += (len+8);
		      }
		      this.song.ev.sort(function(x,y){return x.t-y.t});
		      this.reset();
		      this.locateMIDI(0);
		    },
		    setQuality:function(q){
		      var i;
		      if(q!=undefined)
		        this.quality=q;
		      for(i=0;i<128;++i)
		        this.setTimbre(0,i,this.program0[i]);
		      for(i=0;i<this.drummap0.length;++i)
		        this.setTimbre(1,i+35,this.drummap0[i]);
		      if(this.quality){
		        for(i=0;i<this.program1.length;++i)
		          this.setTimbre(0,i,this.program1[i]);
		        for(i=0;i<this.drummap.length;++i){
		          if(this.drummap1[i])
		            this.setTimbre(1,i+35,this.drummap1[i]);
		        }
		      }
		    },
		    setTimbre:function(m,n,p){
		      var defp={g:0,w:"sine",t:1,f:0,v:0.5,a:0,h:0.01,d:0.01,s:0,r:0.05,p:1,q:1,k:0};
		      function filldef(p){
		        for(n=0;n<p.length;++n){
		          for(k in defp){
		            if(!p[n].hasOwnProperty(k) || typeof(p[n][k])=="undefined")
		              p[n][k]=defp[k];
		          }
		        }
		        return p;
		      }
		      if(m && n>=35 && n<=81)
		        this.drummap[n-35].p=filldef(p);
		      if(m==0 && n>=0 && n<=127)
		        this.program[n].p=filldef(p);
		    },
		    _pruneNote:function(nt){
		      for(var k=nt.o.length-1;k>=0;--k){
		        if(nt.o[k].frequency)
		          this.chmod[nt.ch].disconnect(nt.o[k].detune);
		        nt.o[k].disconnect();
		        if(nt.o[k].frequency)
		          nt.o[k].frequency.cancelScheduledValues(0);
		        else
		          nt.o[k].playbackRate.cancelScheduledValues(0);
		        nt.o[k].stop(0);
		      }
		      for(var k=nt.g.length-1;k>=0;--k){
		        nt.g[k].disconnect();
		        nt.g[k].gain.cancelScheduledValues(0);
		      }
		    },
		    _limitVoices:function(ch,n){
		      this.notetab.sort(function(n1,n2){
		        if(n1.f!=n2.f) return n1.f-n2.f;
		        if(n1.e!=n2.e) return n2.e-n1.e;
		        return n2.t-n1.t;
		      });
		      for(var i=this.notetab.length-1;i>=0;--i){
		        var nt=this.notetab[i];
		        if(this.actx.currentTime>nt.e || i>=(this.voices-1)){
		          this._pruneNote(nt);
		          this.notetab.splice(i,1);
		        }
		      }
		    },
		    _note:function(t,ch,n,v,p){
		      var o=[],g=[],vp=[],fp=[],r=[],i,out,sc,pn;
		      var f=440*Math.pow(2,(n-69)/12);
		      this._limitVoices(ch,n);
		      for(i=0;i<p.length;++i){
		        pn=p[i];
		        var dt=t+pn.a+pn.h;
		        if(pn.g==0)
		          out=this.chvol[ch], sc=v*v/16384, fp[i]=f*pn.t+pn.f;
		        else if(pn.g>10)
		          out=g[pn.g-11].gain, sc=1, fp[i]=fp[pn.g-11]*pn.t+pn.f;
		        else if(o[pn.g-1].frequency)
		          out=o[pn.g-1].frequency, sc=fp[pn.g-1], fp[i]=fp[pn.g-1]*pn.t+pn.f;
		        else
		          out=o[pn.g-1].playbackRate, sc=fp[pn.g-1]/440, fp[i]=fp[pn.g-1]*pn.t+pn.f;
		        switch(pn.w[0]){
		        case "n":
		          o[i]=this.actx.createBufferSource();
		          o[i].buffer=this.noiseBuf[pn.w];
		          o[i].loop=true;
		          o[i].playbackRate.value=fp[i]/440;
		          if(pn.p!=1)
		            this._setParamTarget(o[i].playbackRate,fp[i]/440*pn.p,t,pn.q);
		          break;
		        default:
		          o[i]=this.actx.createOscillator();
		          o[i].frequency.value=fp[i];
		          if(pn.p!=1)
		            this._setParamTarget(o[i].frequency,fp[i]*pn.p,t,pn.q);
		          if(pn.w[0]=="w")
		            o[i].setPeriodicWave(this.wave[pn.w]);
		          else
		            o[i].type=pn.w;
		          this.chmod[ch].connect(o[i].detune);
		          o[i].detune.value=this.bend[ch];
		          break;
		        }
		        g[i]=this.actx.createGain();
		        r[i]=pn.r;
		        o[i].connect(g[i]); g[i].connect(out);
		        vp[i]=sc*pn.v;
		        if(pn.k)
		          vp[i]*=Math.pow(2,(n-60)/12*pn.k);
		        if(pn.a){
		          g[i].gain.value=0;
		          g[i].gain.setValueAtTime(0,t);
		          g[i].gain.linearRampToValueAtTime(vp[i],t+pn.a);
		        }
		        else
		          g[i].gain.setValueAtTime(vp[i],t);
		        this._setParamTarget(g[i].gain,pn.s*vp[i],dt,pn.d);
		        o[i].start(t);
		        if(this.rhythm[ch])
		          o[i].stop(t+p[0].d*this.releaseRatio);
		      }
		      if(!this.rhythm[ch])
		        this.notetab.push({t:t,e:99999,ch:ch,n:n,o:o,g:g,t2:t+pn.a,v:vp,r:r,f:0});
		    },
		    _setParamTarget:function(p,v,t,d){
		      if(d!=0)
		        p.setTargetAtTime(v,t,d);
		      else
		        p.setValueAtTime(v,t);
		    },
		    _releaseNote:function(nt,t){
		      if(nt.ch!=9){
		        for(var k=nt.g.length-1;k>=0;--k){
		          nt.g[k].gain.cancelScheduledValues(t);
		          if(t==nt.t2)
		            nt.g[k].gain.setValueAtTime(nt.v[k],t);
		          else if(t<nt.t2)
		            nt.g[k].gain.setValueAtTime(nt.v[k]*(t-nt.t)/(nt.t2-nt.t),t);
		          this._setParamTarget(nt.g[k].gain,0,t,nt.r[k]);
		        }
		      }
		      nt.e=t+nt.r[0]*this.releaseRatio;
		      nt.f=1;
		    },
		    setModulation:function(ch,v,t){
		      this.chmod[ch].gain.setValueAtTime(v*100/127,this._tsConv(t));
		    },
		    setChVol:function(ch,v,t){
		      this.vol[ch]=3*v*v/(127*127);
		      this.chvol[ch].gain.setValueAtTime(this.vol[ch]*this.ex[ch],this._tsConv(t));
		    },
		    setPan:function(ch,v,t){
		      if(this.chpan[ch])
		        this.chpan[ch].pan.setValueAtTime((v-64)/64,this._tsConv(t));
		    },
		    setExpression:function(ch,v,t){
		      this.ex[ch]=v*v/(127*127);
		      this.chvol[ch].gain.setValueAtTime(this.vol[ch]*this.ex[ch],this._tsConv(t));
		    },
		    setSustain:function(ch,v,t){
		      this.sustain[ch]=v;
		      t=this._tsConv(t);
		      if(v<64){
		        for(var i=this.notetab.length-1;i>=0;--i){
		          var nt=this.notetab[i];
		          if(t>=nt.t && nt.ch==ch && nt.f==1)
		            this._releaseNote(nt,t);
		        }
		      }
		    },
		    allSoundOff:function(ch){
		      for(var i=this.notetab.length-1;i>=0;--i){
		        var nt=this.notetab[i];
		        if(nt.ch==ch){
		          this._pruneNote(nt);
		          this.notetab.splice(i,1);
		        }
		      }
		    },
		    resetAllControllers:function(ch){
		      this.bend[ch]=0; this.ex[ch]=1.0;
		      this.rpnidx[ch]=0x3fff; this.sustain[ch]=0;
		      if(this.chvol[ch]){
		        this.chvol[ch].gain.value=this.vol[ch]*this.ex[ch];
		        this.chmod[ch].gain.value=0;
		      }
		    },
		    setBendRange:function(ch,v){
		      this.brange[ch]=v;
		    },
		    setProgram:function(ch,v){
		      if(this.debug)
		        console.log("Pg("+ch+")="+v);
		      this.pg[ch]=v;
		    },
		    setBend:function(ch,v,t){
		      t=this._tsConv(t);
		      var br=this.brange[ch]*100/127;
		      this.bend[ch]=(v-8192)*br/8192;
		      for(var i=this.notetab.length-1;i>=0;--i){
		        var nt=this.notetab[i];
		        if(nt.ch==ch){
		          for(var k=nt.o.length-1;k>=0;--k){
		            if(nt.o[k].frequency)
		              nt.o[k].detune.setValueAtTime(this.bend[ch],t);
		          }
		        }
		      }
		    },
		    noteOn:function(ch,n,v,t){
		      if(v==0){
		        this.noteOff(ch,n,t);
		        return;
		      }
		      t=this._tsConv(t);
		      if(this.rhythm[ch]){
		        if(n>=35&&n<=81)
		          this._note(t,ch,n,v,this.drummap[n-35].p);
		        return;
		      }
		      this._note(t,ch,n,v,this.program[this.pg[ch]].p);
		    },
		    noteOff:function(ch,n,t){
		      if(this.rhythm[ch])
		        return;
		      t=this._tsConv(t);
		      for(var i=this.notetab.length-1;i>=0;--i){
		        var nt=this.notetab[i];
		        if(t>=nt.t && nt.ch==ch && nt.n==n && nt.f==0){
		          nt.f=1;
		          if(this.sustain[ch]<64)
		            this._releaseNote(nt,t);
		        }
		      }
		    },
		    _tsConv:function(t){
		      if(t==undefined||t<=0){
		        t=0;
		        if(this.actx)
		          t=this.actx.currentTime;
		      }
		      else {
		        if(this.tsmode)
		          t=t*.001-this.tsdiff;
		      }
		      return t;
		    },
		    setTsMode:function(tsmode){
		      this.tsmode=tsmode;
		    },
		    send:function(msg,t){    /* send midi message */
		      var ch=msg[0]&0xf;
		      var cmd=msg[0]&~0xf;
		      if(cmd<0x80||cmd>=0x100)
		        return;
		      switch(cmd){
		      case 0xb0:  /* ctl change */
		        switch(msg[1]){
		        case 1:  this.setModulation(ch,msg[2],t); break;
		        case 7:  this.setChVol(ch,msg[2],t); break;
		        case 10: this.setPan(ch,msg[2],t); break;
		        case 11: this.setExpression(ch,msg[2],t); break;
		        case 64: this.setSustain(ch,msg[2],t); break;
		        case 98:  case 98: this.rpnidx[ch]=0x3fff; break; /* nrpn lsb/msb */
		        case 100: this.rpnidx[ch]=(this.rpnidx[ch]&0x380)|msg[2]; break; /* rpn lsb */
		        case 101: this.rpnidx[ch]=(this.rpnidx[ch]&0x7f)|(msg[2]<<7); break; /* rpn msb */
		        case 6:  /* data entry msb */
		          if(this.rpnidx[ch]==0)
		            this.brange[ch]=(msg[2]<<7)+(this.brange[ch]&0x7f);
		          break;
		        case 38:  /* data entry lsb */
		          if(this.rpnidx[ch]==0)
		            this.brange[ch]=(this.brange[ch]&0x380)|msg[2];
		          break;
		        case 120:  /* all sound off */
		        case 123:  /* all notes off */
		        case 124: case 125: case 126: case 127: /* omni off/on mono/poly */
		          this.allSoundOff(ch);
		          break;
		        case 121: this.resetAllControllers(ch); break;
		        }
		        break;
		      case 0xc0: this.setProgram(ch,msg[1]); break;
		      case 0xe0: this.setBend(ch,(msg[1]+(msg[2]<<7)),t); break;
		      case 0x90: this.noteOn(ch,msg[1],msg[2],t); break;
		      case 0x80: this.noteOff(ch,msg[1],t); break;
		      case 0xf0:
		        if(msg[0]!=254 && this.debug){
		          var ds=[];
		          for(var ii=0;ii<msg.length;++ii)
		            ds.push(msg[ii].toString(16));
		          console.log(ds);
		        }
		        if(msg[1]==0x41&&msg[2]==0x10&&msg[3]==0x42&&msg[4]==0x12&&msg[5]==0x40){
		          if((msg[6]&0xf0)==0x10&&msg[7]==0x15){
		            var ch=[9,0,1,2,3,4,5,6,7,8,10,11,12,13,14,15][msg[6]&0xf];
		            this.rhythm[ch]=msg[8];
		//            console.log("UseForRhythmPart("+ch+")="+msg[8]);
		          }
		        }
		        break;
		      }
		    },
		    _createWave:function(w){
		      var imag=new Float32Array(w.length);
		      var real=new Float32Array(w.length);
		      for(var i=1;i<w.length;++i)
		        imag[i]=w[i];
		      return this.actx.createPeriodicWave(real,imag);
		    },
		    getAudioContext:function(){
		      return this.actx;
		    },
		    setAudioContext:function(actx,dest){
		      this.audioContext=this.actx=actx;
		      this.dest=dest;
		      if(!dest)
		        this.dest=actx.destination;
		      this.tsdiff=performance.now()*.001-this.actx.currentTime;
		      // console.log("TSDiff:"+this.tsdiff);
		      this.out=this.actx.createGain();
		      this.comp=this.actx.createDynamicsCompressor();
		      var blen=this.actx.sampleRate*.5|0;
		      this.convBuf=this.actx.createBuffer(2,blen,this.actx.sampleRate);
		      this.noiseBuf={};
		      this.noiseBuf.n0=this.actx.createBuffer(1,blen,this.actx.sampleRate);
		      this.noiseBuf.n1=this.actx.createBuffer(1,blen,this.actx.sampleRate);
		      var d1=this.convBuf.getChannelData(0);
		      var d2=this.convBuf.getChannelData(1);
		      var dn=this.noiseBuf.n0.getChannelData(0);
		      var dr=this.noiseBuf.n1.getChannelData(0);
		      for(var i=0;i<blen;++i){
		        if(i/blen<Math.random()){
		          d1[i]=Math.exp(-3*i/blen)*(Math.random()-.5)*.5;
		          d2[i]=Math.exp(-3*i/blen)*(Math.random()-.5)*.5;
		        }
		        dn[i]=Math.random()*2-1;
		      }
		      for(var jj=0;jj<64;++jj){
		        var r1=Math.random()*10+1;
		        var r2=Math.random()*10+1;
		        for(i=0;i<blen;++i){
		          var dd=Math.sin((i/blen)*2*Math.PI*440*r1)*Math.sin((i/blen)*2*Math.PI*440*r2);
		          dr[i]+=dd/8;
		        }
		      }
		      if(this.useReverb){
		        this.conv=this.actx.createConvolver();
		        this.conv.buffer=this.convBuf;
		        this.rev=this.actx.createGain();
		        this.rev.gain.value=this.reverbLev;
		        this.out.connect(this.conv);
		        this.conv.connect(this.rev);
		        this.rev.connect(this.comp);
		      }
		      this.setMasterVol();
		      this.out.connect(this.comp);
		      this.comp.connect(this.dest);
		      this.chvol=[]; this.chmod=[]; this.chpan=[];
		      this.wave={"w9999":this._createWave("w9999")};
		      this.lfo=this.actx.createOscillator();
		      this.lfo.frequency.value=5;
		      this.lfo.start(0);
		      for(i=0;i<16;++i){
		        this.chvol[i]=this.actx.createGain();
		        if(this.actx.createStereoPanner){
		          this.chpan[i]=this.actx.createStereoPanner();
		          this.chvol[i].connect(this.chpan[i]);
		          this.chpan[i].connect(this.out);
		        }
		        else {
		          this.chpan[i]=null;
		          this.chvol[i].connect(this.out);
		        }
		        this.chmod[i]=this.actx.createGain();
		        this.lfo.connect(this.chmod[i]);
		        this.pg[i]=0;
		        this.resetAllControllers(i);
		      }
		      this.setReverbLev();
		      this.reset();
		      this.send([0x90,60,1]);
		      this.send([0x90,60,0]);
		    },
		  }
		/* webaudio-tinysynth coreobject */

		;
		  for(var k in this.sy.properties)
		    this[k]=this.sy.properties[k].value;
		  this.setQuality(1);
		  if(opt){
		    if(opt.useReverb!=undefined)
		      this.useReverb=opt.useReverb;
		    if(opt.quality!=undefined)
		      this.setQuality(opt.quality);
		    if(opt.voices!=undefined)
		      this.setVoices(opt.voices);
		  }
		  this.ready();
		}


		module.exports = WebAudioTinySynth;
		// Original source: https://raw.githubusercontent.com/g200kg/webaudio-tinysynth/master/webaudio-tinysynth.js 
	} (webaudioTinysynth));
	return webaudioTinysynth.exports;
}

var webaudioInstruments;
var hasRequiredWebaudioInstruments;

function requireWebaudioInstruments () {
	if (hasRequiredWebaudioInstruments) return webaudioInstruments;
	hasRequiredWebaudioInstruments = 1;

	var Synth = requireWebaudioTinysynth();

	webaudioInstruments = Player;


	function Player(audioContext, destination) {


	    // params
	    var instMin = 0;
	    var instMax = 127;
	    var drumMin = 35;
	    var drumMax = 81;



	    // internals
	    var synth = new Synth({
	        useReverb: 1,
	        quality: 1,
	        voices: 32,
	    });

	    if (audioContext) {
	        synth.setAudioContext(audioContext, destination);
	    }



	    // merge instruments and drums into one big list
	    var instCt = instMax - instMin + 1;
	    var drumCt = drumMax - drumMin + 1;
	    var names = [];
	    for (var i = 0; i < instCt; i++) names.push(synth.getTimbreName(0, i + instMin));
	    for (var j = 0; j < drumCt; j++) names.push(synth.getTimbreName(1, j + drumMin));




	    // Properties
	    this._synth = synth;
	    this.names = names;




	    // API

	    this.setQuality = function (q) {
	        synth.setQuality(q ? 1 : 0);
	    };

	    this.getCurrentTime = function () {
	        return synth.actx.currentTime
	    };

	    this.play = function (inst, note, vel, delay, duration, channel, attack) {
	        inst = inst || 0;
	        if (inst < 0 || inst > instMax + drumCt) throw 'Invalid instrument'
	        note = note || 60;
	        delay = delay || 0;
	        if (isNaN(vel)) vel = 0.5;
	        if (isNaN(duration)) duration = 0.5;
	        if (delay < 0) delay = 0;
	        play_impl(inst, note, vel, delay, duration, channel, attack);
	    };


	    function play_impl(inst, note, vel, delay, duration, channel, attack) {
	        var isDrums = (inst >= instCt);
	        // use passed-in channel value, defaulting to 0
	        channel = channel | 0;
	        if (isDrums) {
	            // drums use channel 9, and determine instrument based on the note
	            channel = 9;
	            note = inst + drumMin - instCt;
	        } else {
	            inst -= instMin;
	            synth.setProgram(channel, inst);
	        }
	        // play the note
	        var t = synth.actx.currentTime;
	        var intVel = (127 * vel) | 0;

	        // console.log([
	        //     'playing: ch=', channel,
	        //     '   inst=', inst,
	        //     '   note=', note,
	        //     '   intVel=', intVel,
	        //     '   delay=', delay,
	        // ].join(''))

	        var prog = synth.program[synth.pg[channel]].p;

	        if (note > 127) {
	            // assume note is a frequency in Hz if it's above 127
	            overrideParameter(prog, 'f', note);
	            overrideParameter(prog, 't', 0);
	        }
	        if (attack) overrideParameter(prog, 'a', attack);

	        // actual play command
	        synth.noteOn(channel, note, intVel, t + delay);
	        synth.noteOff(channel, note, t + delay + duration);

	        // undo overrides
	        if (note > 127) {
	            undoOverride(prog, 'f');
	            undoOverride(prog, 't');
	        }
	        if (attack) undoOverride(prog, 'a');

	    }





	    // temporarily override a program's parameters, for *source* oscillators
	    // e.g. override(0, 'f', 500) sets oscillator.f = 500 
	    // for all (oscillator.g==0), and caches overriden values

	    function overrideParameter(prog, param, value) {
	        var cache = overridden[param] || [0, 0, 0, 0, 0];
	        for (var i = 0; i < prog.length; i++) {
	            var osc = prog[i];
	            if (osc.g !== 0) continue
	            cache[i] = osc[param];
	            osc[param] = value;
	        }
	        overridden[param] = cache;
	    }
	    var overridden = {};

	    // undoes previous
	    function undoOverride(prog, param) {
	        var cache = overridden[param];
	        for (var i = 0; i < prog.length; i++) {
	            var osc = prog[i];
	            if (osc.g !== 0) continue
	            osc[param] = cache[i];
	        }
	    }





	}
	return webaudioInstruments;
}

var webaudioInstrumentsExports = requireWebaudioInstruments();
const Instruments = /*@__PURE__*/getDefaultExportFromCjs(webaudioInstrumentsExports);

// cabbages.ts
function pojo(target) {
  return typeof target == "object" && typeof target != null && Object.getPrototypeOf(target) == Object.prototype;
}
function apply(path, target, range, val, reviver) {
  let originalObject = target;
  let p = [...path];
  while (true) {
    let key = p.shift();
    if (!p.length) {
      if (typeof reviver == "function") {
        val = reviver(val, key, target, path, originalObject, range);
      }
      const RANGE_ARRAY = Array.isArray(range);
      if (pojo(target) && RANGE_ARRAY && typeof key == "undefined" && typeof range[0] == "string") {
        delete target[range[0]];
        return;
      }
      if (RANGE_ARRAY || typeof range == "number") {
        if (typeof key == "undefined") {
          throw new Error("cant treat top level as a seq");
        }
        key = key;
        let [start, end] = Array.isArray(range) ? range : [range, range + 1];
        const ZERO_LENGTH = Array.isArray(range) && range.length == 0;
        if (!ZERO_LENGTH && (start == null || end == null)) {
          throw new RangeError("it's all or nothing, no half measures");
        }
        const DELETE = typeof val == "undefined";
        const INSERT = start === end && !DELETE;
        const APPEND = ZERO_LENGTH && !DELETE;
        let op = DELETE ? "del" : APPEND ? "add" : INSERT ? "ins" : "replace";
        if (typeof target[key] == "undefined") {
          if (typeof val == "string") {
            target[key] = "";
          } else {
            target[key] = [];
          }
        }
        let seq = target[key];
        if (Array.isArray(seq)) {
          switch (op) {
            case "add": {
              Array.isArray(val) ? seq.push(...val) : seq.push(val);
              return;
            }
            case "replace":
            case "ins": {
              Array.isArray(val) ? seq.splice(start, end - start, ...val) : seq.splice(start, end - start, val);
              return;
            }
            case "del": {
              seq.splice(start, end - start);
              return;
            }
            default: {
              throw new Error("i don't know what happened");
            }
          }
        }
        if (typeof seq == "string") {
          switch (op) {
            case "add": {
              target[key] = seq + val;
              return;
            }
            case "replace":
            case "ins": {
              target[key] = seq.slice(0, start) + (typeof val == "string" ? val : val.join("")) + seq.slice(end);
              return;
            }
            case "del": {
              target[key] = seq.slice(0, start) + seq.slice(end);
              return;
            }
            default: {
              throw new Error("i don't know what happened");
            }
          }
        }
        if (pojo(seq) && RANGE_ARRAY && typeof range[0] == "string") {
          delete seq[range[0]];
        }
        throw new Error("not implemented");
      }
      if (typeof key == "undefined") {
        if (typeof range != "string") {
          throw new Error(`can't index top-level map with ${range}`);
        }
        if (typeof val == "undefined") {
          delete target[range];
        } else {
          target[range] = val;
        }
        return;
      }
      if (typeof target[key] == "undefined") {
        target[key] = {};
      }
      if (RANGE_ARRAY) {
        let [a, b] = range;
        if (a != null && b != null) {
          if (typeof val == "undefined" && a != null && b != null) {
            delete target[key][a || b];
          } else {
            target[key][a || b] = val;
          }
        }
      } else {
        if (typeof val == "undefined") {
          delete target[key][range];
        } else {
          target[key][range] = val;
        }
      }
      return;
    }
    if (typeof key == "undefined") {
      throw new Error("cant treat top level as a seq");
    }
    key = key;
    let nextkey = p[0];
    if (typeof target[key] == "undefined") {
      if (typeof nextkey == "string") {
        target[key] = {};
      } else if (typeof nextkey == "number") {
        target[key] = [];
      } else {
        throw new Error(`can't go down this road ${target}.${key}.${nextkey}`);
      }
    }
    target = target[key];
  }
}
var OperationError = class extends Error {
};
function fromAutomerge(autopatch) {
  let path = autopatch.path.slice(0, -1);
  let key = autopatch.path[autopatch.path.length - 1];
  switch (autopatch.action) {
    case "conflict":
    case "inc":
    case "mark":
    case "unmark":
      throw new OperationError(`can't handle this: ${autopatch.action}`);
    case "del": {
      return typeof key == "string" ? [path, key] : [path, [key, key + (autopatch.length || 1)]];
    }
    case "insert": {
      return [path, [key, key], autopatch.values];
    }
    case "splice": {
      return [path, [key, key], [autopatch.value]];
    }
    case "put": {
      return [path, key, autopatch.value];
    }
  }
}

function autoproduce(patches) {
  return produce((doc) => {
    for (let patch of patches) {
      const [path, range, val] = fromAutomerge(patch);
      apply(path, doc, range, val);
    }
  });
}
function createDocumentStore({
  initialValue,
  url,
  repo
}) {
  let owner = getOwner();
  const handle = isValidAutomergeUrl(url) ? repo.find(url) : repo.create(initialValue);
  let [document] = createResource(
    async () => {
      await handle.whenReady();
      let [document2, update] = createStore(handle.docSync());
      function patch(payload) {
        update(autoproduce(payload.patches));
      }
      handle.on("change", patch);
      runWithOwner(owner, () => onCleanup(() => handle.off("change", patch)));
      return document2;
    },
    {
      initialValue: handle.docSync() ?? initialValue
    }
  );
  let queue = [];
  onMount(async () => {
    await handle.whenReady();
    if (handle) {
      let next;
      while (next = queue.shift()) {
        handle.change(next);
      }
    } else {
      queue = [];
    }
  });
  return [
    document,
    (fn) => {
      if (handle.isReady()) {
        handle.change(fn);
      } else {
        queue.push(fn);
      }
    },
    handle.url
  ];
}

const pointerHelper = (e, callback) => {
  return new Promise((resolve) => {
    const start = {
      x: e.clientX,
      y: e.clientY
    };
    const startTime = performance.now();
    let previousDelta = {
      x: 0,
      y: 0
    };
    function getDataFromPointerEvent(event) {
      const delta = {
        x: event.clientX - start.x,
        y: event.clientY - start.y
      };
      const movement = {
        x: delta.x - previousDelta.x,
        y: delta.y - previousDelta.y
      };
      previousDelta = delta;
      return {
        delta: {
          x: event.clientX - start.x,
          y: event.clientY - start.y
        },
        movement,
        event,
        time: performance.now() - startTime
      };
    }
    const onPointerMove = (event) => {
      callback?.(getDataFromPointerEvent(event));
    };
    const onPointerUp = (event) => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      const data = getDataFromPointerEvent(event);
      callback?.(data);
      resolve(data);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  });
};

const KEY_COLORS = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1].reverse();
const HEIGHT = 20;
const WIDTH = 60;
const MARGIN = 2;
const VELOCITY = 4;
const repo = new Repo({
  network: [new BrowserWebSocketClientAdapter("wss://sync.automerge.org")],
  storage: new IndexedDBStorageAdapter()
});
const rootDocUrl = `${document.location.hash.substring(1)}`;
const [doc, setDoc, handleUrl] = createRoot(
  () => createDocumentStore({
    repo,
    url: rootDocUrl,
    initialValue: {
      notes: [],
      instrument: 24
    }
  })
);
document.location.hash = handleUrl;
let audioContext;
let player;
let playedNotes = /* @__PURE__ */ new Set();
const [mode, setMode] = createSignal("note");
const [timeOffset, setTimeOffset] = createSignal(0);
const [dimensions, setDimensions] = createSignal();
const [origin, setOrigin] = createSignal({ x: WIDTH, y: 6 * HEIGHT * 12 });
const [timeScale, setTimeScale] = createSignal(1);
const [selectedNotes, setSelectedNotes] = createSignal([]);
const [selectionArea, setSelectionArea] = createSignal();
const [selectionPresence, setSelectionPresence] = createSignal();
const [clipboard, setClipboard] = createSignal();
const [playing, setPlaying] = createSignal(false);
const [playingNotes, setPlayingNotes] = createStore([]);
const [now, setNow] = createSignal(0);
const [loop, setLoop] = createStore({
  time: 0,
  duration: 4
});
const [isNoteSelected, isNotePlaying, isPitchPlaying] = createRoot(() => [
  createSelector(
    selectedNotes,
    (note, selectedNotes2) => !!selectedNotes2.find(filterNote(note))
  ),
  createSelector(
    () => playingNotes,
    (note, playingNotes2) => !!playingNotes2.find(filterNote(note))
  ),
  createSelector(
    () => playingNotes,
    (pitch, playingNotes2) => !!playingNotes2.find((note) => note.pitch === pitch)
  )
]);
function normalizeVector(value) {
  return {
    x: Math.floor(value.x / WIDTH / timeScale()) * timeScale(),
    y: Math.floor(value.y / HEIGHT)
  };
}
function filterNote(...notes) {
  return ({ id }) => !!notes.find((note) => note.id === id);
}
function selectNotesFromSelectionArea(area) {
  setSelectedNotes(
    doc().notes.filter((note) => {
      const noteStartTime = note.time;
      const noteEndTime = note.time + note.duration;
      const isWithinXBounds = noteStartTime < area.end.x && noteEndTime > area.start.x;
      const isWithinYBounds = -note.pitch >= area.start.y && -note.pitch < area.end.y;
      return isWithinXBounds && isWithinYBounds;
    })
  );
}
function play() {
  if (!audioContext) {
    audioContext = new AudioContext();
  } else setTimeOffset(audioContext.currentTime * VELOCITY - now());
  setPlaying(true);
}
function togglePlaying() {
  if (!playing()) {
    play();
  } else {
    setPlaying(false);
  }
}
function playNote(note, delay = 0) {
  if (!player) {
    player = new Instruments();
  }
  if (note.velocity === 0) {
    return;
  }
  player.play(
    doc().instrument,
    // instrument: 24 is "Acoustic Guitar (nylon)"
    note.pitch,
    // note: midi number or frequency in Hz (if > 127)
    note.velocity,
    // velocity
    delay,
    // delay
    note.duration / VELOCITY,
    // duration
    0,
    // (optional - specify channel for tinysynth to use)
    0.05
    // (optional - override envelope "attack" parameter)
  );
  setTimeout(() => {
    setPlayingNotes(produce((pitches) => pitches.push({ ...note })));
    setTimeout(
      () => {
        setPlayingNotes(
          produce((pitches) => {
            pitches.splice(pitches.findIndex(filterNote(note)), 1);
          })
        );
      },
      note.duration / VELOCITY * 1e3
    );
  }, delay * 1e3);
}
async function handleCreateNote(event) {
  const absolutePosition = {
    x: event.layerX - origin().x,
    y: event.layerY - origin().y
  };
  const note = {
    id: get(),
    active: true,
    duration: timeScale(),
    pitch: Math.floor(-absolutePosition.y / HEIGHT) + 1,
    time: Math.floor(absolutePosition.x / WIDTH / timeScale()) * timeScale(),
    velocity: 1
  };
  setDoc((doc2) => {
    doc2.notes.push(note);
  });
  const initialTime = note.time;
  const initialDuration = note.duration;
  const offset = absolutePosition.x - initialTime * WIDTH;
  setSelectedNotes([note]);
  await pointerHelper(event, ({ delta }) => {
    const deltaX = Math.floor((offset + delta.x) / WIDTH / timeScale()) * timeScale();
    if (deltaX < 0) {
      setDoc((doc2) => {
        const _note = doc2.notes.find(filterNote(note));
        if (!_note) return;
        _note.time = initialTime + deltaX;
        _note.duration = 1 - deltaX;
      });
    } else if (deltaX > 0) {
      setDoc((doc2) => {
        const _note = doc2.notes.find(filterNote(note));
        if (!_note) return;
        _note.duration = initialDuration + deltaX;
      });
    } else {
      setDoc((doc2) => {
        const _note = doc2.notes.find(filterNote(note));
        if (!_note) return;
        _note.time = initialTime;
        _note.duration = timeScale();
      });
    }
    markOverlappingNotes(note);
  });
  setSelectedNotes([]);
  clipOverlappingNotes(note);
}
async function handleSelectionBox(event) {
  const position = {
    x: event.clientX - origin().x,
    y: event.clientY - origin().y
  };
  const normalizedPosition = normalizeVector(position);
  setSelectionArea({
    start: normalizedPosition,
    end: {
      x: normalizedPosition.x + timeScale(),
      y: normalizedPosition.y
    }
  });
  setSelectionPresence(normalizedPosition);
  await pointerHelper(event, ({ delta }) => {
    const newPosition = normalizeVector({
      x: position.x + delta.x,
      y: position.y + delta.y + 1
    });
    const area = {
      start: {
        x: delta.x < 0 ? newPosition.x : normalizedPosition.x,
        y: delta.y < 0 ? newPosition.y : normalizedPosition.y
      },
      end: {
        x: (delta.x > 0 ? newPosition.x : normalizedPosition.x) + timeScale(),
        y: (delta.y > 0 ? newPosition.y : normalizedPosition.y) + 1
      }
    };
    selectNotesFromSelectionArea(area);
    setSelectionArea(area);
    setSelectionPresence(newPosition);
  });
}
async function handlePan(event) {
  const initialOrigin = { ...origin() };
  await pointerHelper(event, ({ delta }) => {
    setOrigin({
      x: initialOrigin.x + delta.x,
      y: initialOrigin.y + delta.y
    });
  });
}
function copyNotes() {
  let offset = Infinity;
  selectedNotes().forEach((note) => {
    if (note.time < offset) {
      offset = note.time;
    }
  });
  setClipboard(
    selectedNotes().map((note) => ({
      ...note,
      id: get(),
      time: note.time - offset
    }))
  );
}
function pasteNotes(clipboard2, position) {
  const newNotes = clipboard2.map((note) => ({
    ...note,
    time: note.time + position.x,
    id: get()
  })).filter(
    (note) => !doc().notes.find(({ pitch, time }) => note.pitch === pitch && note.time === time)
  );
  setDoc((doc2) => doc2.notes.push(...newNotes));
  clipOverlappingNotes(...newNotes);
}
function findSourceIntersectingAndBeforeNote(sources, { id, time, pitch }) {
  if (sources.find((source) => source.id === id)) {
    return;
  }
  return sources.find(
    (source) => source.pitch === pitch && id !== source.id && source.time < time && source.time + source.duration > time
  );
}
function findSourceIntersectingAndAfterNote(sources, { id, time, duration, pitch }) {
  if (sources.find((source) => source.id === id)) {
    return;
  }
  return sources.find(
    (source) => source.pitch === pitch && id !== source.id && source.time >= time && source.time <= time + duration
  );
}
function clipOverlappingNotes(...sources) {
  sources.sort((a, b) => a.time < b.time ? -1 : 1);
  setDoc((doc2) => {
    for (let index = doc2.notes.length - 1; index >= 0; index--) {
      const note = doc2.notes[index];
      if (findSourceIntersectingAndBeforeNote(sources, note)) {
        doc2.notes.splice(index, 1);
      }
    }
  });
  setDoc(
    (doc2) => doc2.notes.forEach((note, index) => {
      const source = findSourceIntersectingAndAfterNote(sources, note);
      if (source) {
        doc2.notes[index].duration = source.time - note.time;
      }
    })
  );
  setDoc((doc2) => {
    for (let index = doc2.notes.length - 1; index >= 0; index--) {
      const note = doc2.notes[index];
      if (note.duration === 0) {
        doc2.notes.splice(index, 1);
      }
    }
  });
  sources.forEach((note, index) => {
    while (index + 1 < sources.length) {
      const source = sources[index + 1];
      if (source.pitch !== note.pitch) {
        index++;
        continue;
      }
      if (source.time < note.time + note.duration) {
        setDoc((doc2) => {
          doc2.notes.forEach((_note) => {
            if (_note.id === note.id) {
              _note.duration = source.time - note.time;
            }
          });
        });
      }
      break;
    }
  });
  setDoc((doc2) => {
    doc2.notes.forEach((note) => {
      delete note._duration;
      delete note._remove;
    });
  });
}
function markOverlappingNotes(...sources) {
  sources.sort((a, b) => a.time < b.time ? -1 : 1);
  batch(() => {
    setDoc(
      (doc2) => doc2.notes.forEach((note) => {
        if (findSourceIntersectingAndBeforeNote(sources, note)) {
          note._remove = true;
        } else {
          delete note._remove;
        }
      })
    );
    setDoc(
      (doc2) => doc2.notes.forEach((note, index) => {
        const source = findSourceIntersectingAndAfterNote(sources, note);
        if (source) {
          doc2.notes[index]._duration = source.time - note.time;
        } else {
          delete doc2.notes[index]._duration;
        }
      })
    );
    sources.forEach((source, index) => {
      const end = source.time + source.duration;
      while (index + 1 < sources.length) {
        if (sources[index + 1].pitch !== source.pitch) {
          index++;
          continue;
        }
        if (sources[index + 1].time <= end) {
          setDoc((doc2) => {
            doc2.notes.forEach((note) => {
              if (note.id === source.id) {
                note._duration = sources[index + 1].time - source.time;
              }
            });
          });
          break;
        }
        setDoc((doc2) => {
          doc2.notes.forEach((note) => {
            if (note.id === source.id) {
              delete note._duration;
            }
          });
        });
        break;
      }
    });
  });
}

function mod(n, m) {
  return (n % m + m) % m;
}

var _tmpl$$i = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"width=1.2em height=1.2em><path fill=none stroke=currentColor stroke-width=2 d="M18 12.4H6M11.4 7L6 12.4l5.4 5.4">`);
const IconGrommetIconsFormPreviousLink = (props = {}) => (() => {
  var _el$ = _tmpl$$i();
  spread(_el$, props, true);
  return _el$;
})();

var _tmpl$$h = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"width=1.2em height=1.2em><path fill=none stroke=currentColor stroke-width=2 d="M6 12.4h12M12.6 7l5.4 5.4l-5.4 5.4">`);
const IconGrommetIconsFormNextLink = (props = {}) => (() => {
  var _el$ = _tmpl$$h();
  spread(_el$, props, true);
  return _el$;
})();

var _tmpl$$g = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"width=1.2em height=1.2em><path fill=none stroke=currentColor stroke-width=2 d="M4.5 17H1V1h16v3.5M7 7h16v16H7zm8 4v8zm-4 4h8z">`);
const IconGrommetIconsDuplicate = (props = {}) => (() => {
  var _el$ = _tmpl$$g();
  spread(_el$, props, true);
  return _el$;
})();

var _tmpl$$f = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"width=1.2em height=1.2em><path fill=none stroke=currentColor stroke-width=2 d="M13 20c6-1 8-6 8-10m-7 6l-2 4l4 3M0 9l4-3l3 4m2 10c-6-3-7-8-5-14m16 1C16 1 10 1 6 4.006M20 2v5h-5">`);
const IconGrommetIconsCycle = (props = {}) => (() => {
  var _el$ = _tmpl$$f();
  spread(_el$, props, true);
  return _el$;
})();

var _tmpl$$e = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"width=1.2em height=1.2em><path fill=none stroke=currentColor stroke-width=2 d="M1 17.998C1 16.894 1.887 16 2.998 16H9v4.002A1.993 1.993 0 0 1 7.002 22H2.998A2 2 0 0 1 1 20.002zm14 0c0-1.104.887-1.998 1.998-1.998H23v4.002A1.993 1.993 0 0 1 21.002 22h-4.004A2 2 0 0 1 15 20.002zM9 16V2h14v13.5M9 6h14">`);
const IconGrommetIconsMusic = (props = {}) => (() => {
  var _el$ = _tmpl$$e();
  spread(_el$, props, true);
  return _el$;
})();

var _tmpl$$d = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"width=1.2em height=1.2em><path fill=none stroke=currentColor stroke-width=2 d="M8 1h6zm11.188 18.472L16 22l-3.5-4.5l-3 3.5L7 7l13 6.5l-4.5 1.5zM19 4V1h-3M6 1H3v3m0 10v3h3M19 6v4zM3 12V6z">`);
const IconGrommetIconsSelect = (props = {}) => (() => {
  var _el$ = _tmpl$$d();
  spread(_el$, props, true);
  return _el$;
})();

var _tmpl$$c = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"width=1.2em height=1.2em><path fill=none stroke=currentColor stroke-width=2 d="M12 0v24M2 12h10m10 0H12M6 8l-4 4l4 4m12-8l4 4l-4 4">`);
const IconGrommetIconsShift = (props = {}) => (() => {
  var _el$ = _tmpl$$c();
  spread(_el$, props, true);
  return _el$;
})();

var _tmpl$$b = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"width=1.2em height=1.2em><path fill=none stroke=currentColor stroke-width=2 d="M12 18a6 6 0 1 0 0-12a6 6 0 0 0 0 12ZM8 8l3 3m1 11a9.99 9.99 0 0 0 8.307-4.43A9.95 9.95 0 0 0 22 12c0-5.523-4.477-10-10-10S2 6.477 2 12">`);
const IconGrommetIconsVolumeControl = (props = {}) => (() => {
  var _el$ = _tmpl$$b();
  spread(_el$, props, true);
  return _el$;
})();

var _tmpl$$a = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"width=1.2em height=1.2em><path fill=none stroke=currentColor stroke-width=2 d="M8.5 5.5L12 2l3.5 3.5M22 12H2m3.5-3.5L2 12l3.5 3.5m13 0L22 12l-3.5-3.5M12 22V2M8.5 18.5L12 22l3.5-3.5">`);
const IconGrommetIconsPan = (props = {}) => (() => {
  var _el$ = _tmpl$$a();
  spread(_el$, props, true);
  return _el$;
})();

var _tmpl$$9 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"width=1.2em height=1.2em><path fill=none stroke=currentColor stroke-width=2 d="M9 15h8zm0-4h10zm0-4h4zm7-6v6h6M6 5H2v18h16v-4m4 0H6V1h11l5 5z">`);
const IconGrommetIconsCopy = (props = {}) => (() => {
  var _el$ = _tmpl$$9();
  spread(_el$, props, true);
  return _el$;
})();

var _tmpl$$8 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"width=1.2em height=1.2em><path fill=none stroke=currentColor stroke-width=2 d="M16 3h5v20H3V3h5m0-2h8v5H8z">`);
const IconGrommetIconsClipboard = (props = {}) => (() => {
  var _el$ = _tmpl$$8();
  spread(_el$, props, true);
  return _el$;
})();

var _tmpl$$7 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"width=1.2em height=1.2em><path fill=none stroke=currentColor stroke-width=2 d="M23 4L8 16zm0 16L8 8zM5 9a3 3 0 1 0 0-6a3 3 0 0 0 0 6Zm0 12a3 3 0 1 0 0-6a3 3 0 0 0 0 6Z">`);
const IconGrommetIconsCut = (props = {}) => (() => {
  var _el$ = _tmpl$$7();
  spread(_el$, props, true);
  return _el$;
})();

var _tmpl$$6 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"width=1.2em height=1.2em><path fill=none stroke=currentColor stroke-width=2 d="M7 21L22 6l-4-4L2 18l3 3h14M6 14l4 4">`);
const IconGrommetIconsErase = (props = {}) => (() => {
  var _el$ = _tmpl$$6();
  spread(_el$, props, true);
  return _el$;
})();

var _tmpl$$5 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"width=1.2em height=1.2em><path fill=none stroke=currentColor stroke-width=2 d="M18 12H6M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2z">`);
const IconGrommetIconsDisabledOutline = (props = {}) => (() => {
  var _el$ = _tmpl$$5();
  spread(_el$, props, true);
  return _el$;
})();

var _tmpl$$4 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"width=1.2em height=1.2em><path fill=none stroke=currentColor stroke-width=2 d="M2 19h20M2 5h20M2 12h20">`);
const IconGrommetIconsMenu = (props = {}) => (() => {
  var _el$ = _tmpl$$4();
  spread(_el$, props, true);
  return _el$;
})();

var _tmpl$$3 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"width=1.2em height=1.2em><path fill=none stroke=currentColor stroke-width=2 d="M4 4h16v16H4z">`);
const IconGrommetIconsStop = (props = {}) => (() => {
  var _el$ = _tmpl$$3();
  spread(_el$, props, true);
  return _el$;
})();

var _tmpl$$2 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"width=1.2em height=1.2em><path fill=none stroke=currentColor stroke-width=2 d="m3 22l18-10L3 2z">`);
const IconGrommetIconsPlay = (props = {}) => (() => {
  var _el$ = _tmpl$$2();
  spread(_el$, props, true);
  return _el$;
})();

var _tmpl$$1 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"width=1.2em height=1.2em><path fill=none stroke=currentColor stroke-width=2 d="M3 21h6V3H3zm12 0h6V3h-6z">`);
const IconGrommetIconsPause = (props = {}) => (() => {
  var _el$ = _tmpl$$1();
  spread(_el$, props, true);
  return _el$;
})();

var _tmpl$ = /* @__PURE__ */ template(`<button>`), _tmpl$2 = /* @__PURE__ */ template(`<div><span>`), _tmpl$3 = /* @__PURE__ */ template(`<svg><rect></svg>`, false, true), _tmpl$4 = /* @__PURE__ */ template(`<svg><rect fill=var(--color-piano-white)></svg>`, false, true), _tmpl$5 = /* @__PURE__ */ template(`<svg><g></svg>`, false, true), _tmpl$6 = /* @__PURE__ */ template(`<svg><rect x=0></svg>`, false, true), _tmpl$7 = /* @__PURE__ */ template(`<svg><rect x=0 opacity=0.8></svg>`, false, true), _tmpl$8 = /* @__PURE__ */ template(`<svg><rect x=0 y=0 fill=var(--color-piano-black)></svg>`, false, true), _tmpl$9 = /* @__PURE__ */ template(`<svg><line x1=0 stroke=var(--color-stroke)></svg>`, false, true), _tmpl$10 = /* @__PURE__ */ template(`<svg><rect y=0></svg>`, false, true), _tmpl$11 = /* @__PURE__ */ template(`<svg><line y1=0 stroke=var(--color-stroke) stroke-width=2px></svg>`, false, true), _tmpl$12 = /* @__PURE__ */ template(`<svg><line y1=0 stroke=var(--color-stroke) stroke-width=1px></svg>`, false, true), _tmpl$13 = /* @__PURE__ */ template(`<svg><line y1=0 stroke=var(--color-stroke-secondary)></svg>`, false, true), _tmpl$14 = /* @__PURE__ */ template(`<div>`), _tmpl$15 = /* @__PURE__ */ template(`<div><div>`), _tmpl$16 = /* @__PURE__ */ template(`<div><div><button></button><button></button><button></button><button></button><button>`), _tmpl$17 = /* @__PURE__ */ template(`<div><div><button>`), _tmpl$18 = /* @__PURE__ */ template(`<div><div></div><div></div><div><button></button><button>`), _tmpl$19 = /* @__PURE__ */ template(`<div><svg>`), _tmpl$20 = /* @__PURE__ */ template(`<svg><rect opacity=0.3 fill=var(--color-selection-area)></svg>`, false, true), _tmpl$21 = /* @__PURE__ */ template(`<svg><rect opacity=0.8 fill=var(--color-selection-area)></svg>`, false, true);
function ActionButton(props) {
  const [trigger, setTrigger] = createSignal(false);
  return (() => {
    var _el$ = _tmpl$();
    _el$.$$click = (event) => {
      setTrigger(true);
      props.onClick(event);
      setTimeout(() => setTrigger(false), 250);
    };
    insert(_el$, () => props.children);
    createRenderEffect((_p$) => {
      var _v$ = clsx(props.class, trigger() && styles.trigger), _v$2 = props.style;
      _v$ !== _p$.e && className(_el$, _p$.e = _v$);
      _p$.t = style(_el$, _v$2, _p$.t);
      return _p$;
    }, {
      e: void 0,
      t: void 0
    });
    return _el$;
  })();
}
function NumberButton(props) {
  return (() => {
    var _el$2 = _tmpl$2(), _el$3 = _el$2.firstChild;
    insert(_el$2, createComponent(ActionButton, {
      get onClick() {
        return props.decrement;
      },
      get children() {
        return createComponent(IconGrommetIconsFormPreviousLink, {});
      }
    }), _el$3);
    insert(_el$3, () => props.value);
    insert(_el$2, createComponent(ActionButton, {
      get onClick() {
        return props.increment;
      },
      get children() {
        return createComponent(IconGrommetIconsFormNextLink, {});
      }
    }), null);
    createRenderEffect(() => className(_el$2, styles.numberButton));
    return _el$2;
  })();
}
function Note(props) {
  async function handleSelect(event) {
    if (isNoteSelected(props.note)) {
      event.stopPropagation();
      event.preventDefault();
      selectedNotes().sort((a, b) => a.time < b.time ? -1 : 1);
      if (selectedNotes().length > 0) {
        const offset = selectedNotes()[0].time % timeScale();
        const initialNotes = Object.fromEntries(selectedNotes().map((note) => [note.id, {
          time: note.time,
          pitch: note.pitch
        }]));
        let previous = 0;
        const {
          delta
        } = await pointerHelper(event, ({
          delta: delta2
        }) => {
          let time = Math.floor(delta2.x / WIDTH / timeScale()) * timeScale();
          if (time === timeScale() * -1) {
            time = 0;
          } else if (time < timeScale() * -1) {
            time = time + timeScale();
          }
          const hasChanged = previous !== time;
          previous = time;
          setDoc((doc2) => {
            doc2.notes.forEach((note) => {
              if (isNoteSelected(note)) {
                note.time = initialNotes[note.id].time + time - offset;
                note.pitch = initialNotes[note.id].pitch - Math.floor((delta2.y + HEIGHT / 2) / HEIGHT);
                if (hasChanged) {
                  playNote(note);
                }
              }
            });
          });
          markOverlappingNotes(...selectedNotes());
        });
        if (Math.floor((delta.x + WIDTH / 2) / WIDTH) !== 0) ;
        clipOverlappingNotes(...selectedNotes());
      }
    }
  }
  async function handleStretch(event) {
    event.stopPropagation();
    event.preventDefault();
    if (!isNoteSelected(props.note)) {
      setSelectedNotes([props.note]);
    }
    const initialSelectedNotes = Object.fromEntries(selectedNotes().map((note) => [note.id, {
      ...note
    }]));
    console.log(initialSelectedNotes.length);
    await pointerHelper(event, ({
      delta
    }) => {
      batch(() => {
        const deltaX = Math.floor(delta.x / WIDTH / timeScale()) * timeScale();
        setDoc((doc2) => {
          doc2.notes.forEach((note) => {
            if (!isNoteSelected(note)) return;
            const duration = initialSelectedNotes[note.id].duration + deltaX;
            if (duration > timeScale()) {
              note.duration = duration;
            } else {
              note.time = initialSelectedNotes[note.id].time;
              note.duration = timeScale();
            }
          });
        });
        markOverlappingNotes(...selectedNotes());
      });
    });
    clipOverlappingNotes(...selectedNotes());
    if (selectedNotes().length === 1) {
      setSelectedNotes([]);
    }
  }
  async function handleNote(event) {
    event.stopPropagation();
    event.preventDefault();
    const initialTime = props.note.time;
    const initialPitch = props.note.pitch;
    let previousPitch = initialPitch;
    setSelectedNotes([props.note]);
    await pointerHelper(event, ({
      delta
    }) => {
      const time = Math.floor((initialTime + delta.x / WIDTH) / timeScale()) * timeScale();
      const pitch = initialPitch - Math.floor((delta.y + HEIGHT / 2) / HEIGHT);
      setDoc((doc2) => {
        const note = doc2.notes.find((note2) => note2.id === props.note.id);
        if (!note) return;
        note.time = time;
        note.pitch = pitch;
        if (previousPitch !== pitch) {
          playNote(note);
          previousPitch = pitch;
        }
      });
      markOverlappingNotes(props.note);
    });
    setSelectedNotes([]);
    clipOverlappingNotes(props.note);
  }
  async function handleVelocity(event) {
    let initiallySelected = !!selectedNotes().find(filterNote(props.note));
    if (!initiallySelected) {
      setSelectedNotes([props.note]);
    }
    const initialNotes = Object.fromEntries(selectedNotes().map((note) => [note.id, {
      ...note
    }]));
    await pointerHelper(event, ({
      delta
    }) => {
      setDoc((doc2) => {
        doc2.notes.forEach((note) => {
          if (!note.active) {
            note.active = true;
          }
          if (note.id in initialNotes) {
            note.velocity = Math.min(1, Math.max(0, initialNotes[note.id].velocity - delta.y / 100));
          }
        });
      });
    });
    if (!initiallySelected) {
      setSelectedNotes([]);
    }
  }
  return (() => {
    var _el$4 = _tmpl$3();
    _el$4.$$pointerdown = async (event) => {
      switch (mode()) {
        case "select":
          return await handleSelect(event);
        case "stretch":
          return handleStretch(event);
        case "note":
          return handleNote(event);
        case "velocity":
          return handleVelocity(event);
      }
    };
    _el$4.$$dblclick = () => {
      if (mode() === "note") {
        setDoc((doc2) => {
          const index = doc2.notes.findIndex(filterNote(props.note));
          if (index !== -1) doc2.notes.splice(index, 1);
        });
      }
    };
    setAttribute(_el$4, "height", HEIGHT - MARGIN * 2);
    createRenderEffect((_p$) => {
      var _v$3 = clsx(styles.note, (isNoteSelected(props.note) || isNotePlaying(props.note)) && styles.selected), _v$4 = props.note.time * WIDTH + MARGIN, _v$5 = -props.note.pitch * HEIGHT + MARGIN, _v$6 = (props.note._duration ?? props.note.duration) * WIDTH - MARGIN * 2, _v$7 = !props.note._remove && props.note.active ? props.note.velocity * 0.75 + 0.25 : 0.25;
      _v$3 !== _p$.e && setAttribute(_el$4, "class", _p$.e = _v$3);
      _v$4 !== _p$.t && setAttribute(_el$4, "x", _p$.t = _v$4);
      _v$5 !== _p$.a && setAttribute(_el$4, "y", _p$.a = _v$5);
      _v$6 !== _p$.o && setAttribute(_el$4, "width", _p$.o = _v$6);
      _v$7 !== _p$.i && setAttribute(_el$4, "opacity", _p$.i = _v$7);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0,
      i: void 0
    });
    return _el$4;
  })();
}
function Piano() {
  const dimensions2 = useDimensions();
  return [(() => {
    var _el$5 = _tmpl$4();
    setAttribute(_el$5, "width", WIDTH);
    createRenderEffect(() => setAttribute(_el$5, "height", dimensions2().height));
    return _el$5;
  })(), (() => {
    var _el$6 = _tmpl$5();
    insert(_el$6, createComponent(Index, {
      get each() {
        return new Array(Math.floor(dimensions2().height / HEIGHT) + 2);
      },
      children: (_, index) => (() => {
        var _el$7 = _tmpl$6();
        setAttribute(_el$7, "y", index * HEIGHT);
        setAttribute(_el$7, "width", WIDTH);
        setAttribute(_el$7, "height", HEIGHT);
        createRenderEffect((_$p) => (_$p = KEY_COLORS[mod(index + Math.floor(-origin().y / HEIGHT), KEY_COLORS.length)] ? "none" : "var(--color-piano-black)") != null ? _el$7.style.setProperty("fill", _$p) : _el$7.style.removeProperty("fill"));
        return _el$7;
      })()
    }));
    createRenderEffect((_$p) => (_$p = `translateY(${mod(-origin().y, HEIGHT) * -1}px)`) != null ? _el$6.style.setProperty("transform", _$p) : _el$6.style.removeProperty("transform"));
    return _el$6;
  })()];
}
function PlayingNotes() {
  const dimensions2 = useDimensions();
  return (() => {
    var _el$8 = _tmpl$5();
    insert(_el$8, createComponent(Index, {
      get each() {
        return new Array(Math.floor(dimensions2().height / HEIGHT) + 2);
      },
      children: (_, index) => {
        return (() => {
          var _el$9 = _tmpl$7();
          setAttribute(_el$9, "y", index * HEIGHT);
          setAttribute(_el$9, "width", WIDTH);
          setAttribute(_el$9, "height", HEIGHT);
          createRenderEffect((_$p) => (_$p = isPitchPlaying(-(index + Math.floor(-origin().y / HEIGHT))) ? "var(--color-note-selected)" : "none") != null ? _el$9.style.setProperty("fill", _$p) : _el$9.style.removeProperty("fill"));
          return _el$9;
        })();
      }
    }));
    createRenderEffect((_$p) => (_$p = `translateY(${mod(-origin().y, HEIGHT) * -1}px)`) != null ? _el$8.style.setProperty("transform", _$p) : _el$8.style.removeProperty("transform"));
    return _el$8;
  })();
}
function Ruler(props) {
  const dimensions2 = useDimensions();
  const [selected, setSelected] = createSignal(false);
  const [trigger, setTrigger] = createSignal(false);
  function handleCreateLoop(event) {
    event.stopPropagation();
    const absolutePosition = {
      x: event.layerX - origin().x,
      y: event.layerY - origin().y
    };
    const loop2 = {
      time: Math.floor(absolutePosition.x / WIDTH),
      duration: 1
    };
    props.setLoop(loop2);
    const initialTime = loop2.time;
    const initialDuration = loop2.duration;
    const offset = absolutePosition.x - initialTime * WIDTH;
    pointerHelper(event, ({
      delta
    }) => {
      const deltaX = Math.floor((offset + delta.x) / WIDTH);
      if (deltaX < 0) {
        props.setLoop("time", initialTime + deltaX);
        props.setLoop("duration", 1 - deltaX);
      } else if (deltaX > 0) {
        props.setLoop("duration", initialDuration + deltaX);
      } else {
        props.setLoop("time", initialTime);
        props.setLoop("duration", 1);
      }
    });
  }
  async function handleAdjustLoop(event, loop2) {
    event.stopPropagation();
    event.preventDefault();
    setSelected(true);
    const {
      width,
      left
    } = event.target.getBoundingClientRect();
    const initialTime = loop2.time;
    const initialDuration = loop2.duration;
    if (event.clientX < left + WIDTH / 3) {
      const offset = event.layerX - initialTime * WIDTH - origin().x;
      await pointerHelper(event, ({
        delta
      }) => {
        const deltaX = Math.floor((delta.x + offset) / WIDTH);
        if (deltaX >= initialDuration) {
          props.setLoop("duration", deltaX - initialDuration + 2);
        } else {
          const time = initialTime + deltaX;
          props.setLoop("time", time);
          props.setLoop("duration", initialDuration - deltaX);
        }
      });
    } else if (event.layerX > left + width - WIDTH / 3) {
      await pointerHelper(event, ({
        delta
      }) => {
        const duration = Math.floor((event.layerX - origin().x + delta.x) / WIDTH) - initialTime;
        if (duration > 0) {
          props.setLoop("duration", 1 + duration);
        } else if (duration < 0) {
          props.setLoop("duration", 1 - duration);
          props.setLoop("time", initialTime + duration);
        } else {
          props.setLoop("time", initialTime);
          props.setLoop("duration", 1);
        }
      });
    } else {
      await pointerHelper(event, ({
        delta
      }) => {
        const deltaX = Math.floor((delta.x + WIDTH / 2) / WIDTH);
        const time = initialTime + deltaX;
        props.setLoop("time", time);
      });
    }
    setSelected(false);
  }
  let initial = true;
  createEffect(on(() => [props.loop.duration, props.loop.time], () => {
    if (initial) {
      initial = false;
      return;
    }
    setTrigger(true);
    setTimeout(() => {
      setTrigger(false);
    }, 250);
  }));
  return [(() => {
    var _el$10 = _tmpl$8();
    _el$10.$$pointerdown = handleCreateLoop;
    setAttribute(_el$10, "height", HEIGHT);
    createRenderEffect(() => setAttribute(_el$10, "width", dimensions2().width));
    return _el$10;
  })(), createComponent(Show, {
    get when() {
      return props.loop;
    },
    children: (loop2) => (() => {
      var _el$15 = _tmpl$10();
      _el$15.$$pointerdown = (event) => handleAdjustLoop(event, loop2());
      setAttribute(_el$15, "height", HEIGHT);
      _el$15.style.setProperty("transition", "fill 0.25s");
      createRenderEffect((_p$) => {
        var _v$11 = loop2().time * WIDTH, _v$12 = loop2().duration * WIDTH, _v$13 = selected() || trigger() ? "var(--color-loop-selected)" : "var(--color-loop)", _v$14 = `translateX(${origin().x}px)`;
        _v$11 !== _p$.e && setAttribute(_el$15, "x", _p$.e = _v$11);
        _v$12 !== _p$.t && setAttribute(_el$15, "width", _p$.t = _v$12);
        _v$13 !== _p$.a && setAttribute(_el$15, "fill", _p$.a = _v$13);
        _v$14 !== _p$.o && ((_p$.o = _v$14) != null ? _el$15.style.setProperty("transform", _v$14) : _el$15.style.removeProperty("transform"));
        return _p$;
      }, {
        e: void 0,
        t: void 0,
        a: void 0,
        o: void 0
      });
      return _el$15;
    })()
  }), (() => {
    var _el$11 = _tmpl$3();
    setAttribute(_el$11, "height", HEIGHT);
    _el$11.style.setProperty("opacity", "0.5");
    createRenderEffect((_p$) => {
      var _v$8 = styles.now, _v$9 = WIDTH * timeScale(), _v$10 = `translateX(${origin().x + Math.floor(now() / timeScale()) * WIDTH * timeScale()}px)`;
      _v$8 !== _p$.e && setAttribute(_el$11, "class", _p$.e = _v$8);
      _v$9 !== _p$.t && setAttribute(_el$11, "width", _p$.t = _v$9);
      _v$10 !== _p$.a && ((_p$.a = _v$10) != null ? _el$11.style.setProperty("transform", _v$10) : _el$11.style.removeProperty("transform"));
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0
    });
    return _el$11;
  })(), (() => {
    var _el$12 = _tmpl$9();
    setAttribute(_el$12, "y1", HEIGHT);
    setAttribute(_el$12, "y2", HEIGHT);
    createRenderEffect(() => setAttribute(_el$12, "x2", dimensions2().width));
    return _el$12;
  })(), (() => {
    var _el$13 = _tmpl$5();
    insert(_el$13, createComponent(Index, {
      get each() {
        return new Array(Math.floor(dimensions2().width / WIDTH / 8) + 2);
      },
      children: (_, index) => (() => {
        var _el$16 = _tmpl$11();
        setAttribute(_el$16, "y2", HEIGHT);
        setAttribute(_el$16, "x1", index * WIDTH * 8);
        setAttribute(_el$16, "x2", index * WIDTH * 8);
        return _el$16;
      })()
    }));
    createRenderEffect((_$p) => (_$p = `translateX(${origin().x % (WIDTH * 8)}px)`) != null ? _el$13.style.setProperty("transform", _$p) : _el$13.style.removeProperty("transform"));
    return _el$13;
  })(), (() => {
    var _el$14 = _tmpl$5();
    insert(_el$14, createComponent(Index, {
      get each() {
        return new Array(Math.floor(dimensions2().width / WIDTH) + 2);
      },
      children: (_, index) => (() => {
        var _el$17 = _tmpl$12();
        setAttribute(_el$17, "y2", HEIGHT);
        setAttribute(_el$17, "x1", index * WIDTH);
        setAttribute(_el$17, "x2", index * WIDTH);
        return _el$17;
      })()
    }));
    createRenderEffect((_$p) => (_$p = `translateX(${origin().x % WIDTH}px)`) != null ? _el$14.style.setProperty("transform", _$p) : _el$14.style.removeProperty("transform"));
    return _el$14;
  })()];
}
function Grid() {
  const dimensions2 = useDimensions();
  return [(() => {
    var _el$18 = _tmpl$5();
    insert(_el$18, createComponent(Index, {
      get each() {
        return new Array(Math.floor(dimensions2().width / WIDTH / timeScale()) + 2);
      },
      children: (_, index) => (() => {
        var _el$20 = _tmpl$13();
        createRenderEffect((_p$) => {
          var _v$15 = dimensions2().height, _v$16 = index * timeScale() * WIDTH, _v$17 = index * timeScale() * WIDTH;
          _v$15 !== _p$.e && setAttribute(_el$20, "y2", _p$.e = _v$15);
          _v$16 !== _p$.t && setAttribute(_el$20, "x1", _p$.t = _v$16);
          _v$17 !== _p$.a && setAttribute(_el$20, "x2", _p$.a = _v$17);
          return _p$;
        }, {
          e: void 0,
          t: void 0,
          a: void 0
        });
        return _el$20;
      })()
    }));
    createRenderEffect((_$p) => (_$p = `translateX(${origin().x % (WIDTH * timeScale())}px)`) != null ? _el$18.style.setProperty("transform", _$p) : _el$18.style.removeProperty("transform"));
    return _el$18;
  })(), (() => {
    var _el$19 = _tmpl$5();
    insert(_el$19, createComponent(Index, {
      get each() {
        return new Array(Math.floor(dimensions2().width / WIDTH / 8) + 2);
      },
      children: (_, index) => (() => {
        var _el$21 = _tmpl$11();
        setAttribute(_el$21, "x1", index * WIDTH * 8);
        setAttribute(_el$21, "x2", index * WIDTH * 8);
        createRenderEffect(() => setAttribute(_el$21, "y2", dimensions2().height));
        return _el$21;
      })()
    }));
    createRenderEffect((_$p) => (_$p = `translateX(${origin().x % (WIDTH * 8)}px)`) != null ? _el$19.style.setProperty("transform", _$p) : _el$19.style.removeProperty("transform"));
    return _el$19;
  })()];
}
function PianoUnderlay() {
  const dimensions2 = useDimensions();
  return (() => {
    var _el$22 = _tmpl$5();
    insert(_el$22, createComponent(Index, {
      get each() {
        return new Array(Math.floor(dimensions2().height / HEIGHT) + 2);
      },
      children: (_, index) => (() => {
        var _el$23 = _tmpl$3();
        setAttribute(_el$23, "y", index * HEIGHT);
        setAttribute(_el$23, "height", HEIGHT);
        _el$23.style.setProperty("pointer-events", "none");
        createRenderEffect((_p$) => {
          var _v$18 = dimensions2().width, _v$19 = KEY_COLORS[mod(index + Math.floor(-origin().y / HEIGHT), KEY_COLORS.length)] ? "none" : "var(--color-piano-underlay)";
          _v$18 !== _p$.e && setAttribute(_el$23, "width", _p$.e = _v$18);
          _v$19 !== _p$.t && ((_p$.t = _v$19) != null ? _el$23.style.setProperty("fill", _v$19) : _el$23.style.removeProperty("fill"));
          return _p$;
        }, {
          e: void 0,
          t: void 0
        });
        return _el$23;
      })()
    }));
    createRenderEffect((_$p) => (_$p = `translateY(${-mod(-origin().y, HEIGHT)}px)`) != null ? _el$22.style.setProperty("transform", _$p) : _el$22.style.removeProperty("transform"));
    return _el$22;
  })();
}
function TopLeftHud() {
  const isSelectionAreaCyclable = () => selectionArea() === void 0 || selectionArea().start.x === selectionArea().end.x && selectionArea().start.y === selectionArea().end.y;
  return (() => {
    var _el$24 = _tmpl$15(), _el$25 = _el$24.firstChild;
    `${HEIGHT}px` != null ? _el$24.style.setProperty("top", `${HEIGHT}px`) : _el$24.style.removeProperty("top");
    _el$24.style.setProperty("gap", "5px");
    insert(_el$25, createComponent(ActionButton, {
      onClick: () => {
        const selection = doc().notes?.filter((note) => note.time >= loop.time && note.time < loop.time + loop.duration);
        if (!selection) return;
        const newNotes = selection.map((note) => ({
          ...note,
          id: get(),
          time: note.time + loop.duration
        }));
        setDoc((doc2) => doc2.notes.push(...newNotes));
        setLoop("duration", (duration) => duration * 2);
        clipOverlappingNotes(...newNotes);
      },
      get children() {
        return createComponent(IconGrommetIconsDuplicate, {});
      }
    }));
    insert(_el$24, createComponent(Show, {
      get when() {
        return mode() === "select";
      },
      get children() {
        var _el$26 = _tmpl$14();
        insert(_el$26, createComponent(ActionButton, {
          get ["class"]() {
            return mode() === "stretch" ? styles.active : void 0;
          },
          onClick: () => {
            const area = selectionArea();
            if (!area) {
              console.error("Trying to ");
              return;
            }
            setLoop({
              time: area.start.x,
              duration: area.end.x - area.start.x + timeScale()
            });
          },
          get children() {
            return createComponent(IconGrommetIconsCycle, {
              style: {
                "margin-top": "3px"
              }
            });
          }
        }));
        createRenderEffect((_p$) => {
          var _v$20 = isSelectionAreaCyclable() ? 0.5 : void 0, _v$21 = isSelectionAreaCyclable() ? "none" : void 0;
          _v$20 !== _p$.e && ((_p$.e = _v$20) != null ? _el$26.style.setProperty("opacity", _v$20) : _el$26.style.removeProperty("opacity"));
          _v$21 !== _p$.t && ((_p$.t = _v$21) != null ? _el$26.style.setProperty("pointer-events", _v$21) : _el$26.style.removeProperty("pointer-events"));
          return _p$;
        }, {
          e: void 0,
          t: void 0
        });
        return _el$26;
      }
    }), null);
    createRenderEffect(() => className(_el$24, styles.topLeftHud));
    return _el$24;
  })();
}
function TopRightHud() {
  return (() => {
    var _el$27 = _tmpl$16(), _el$28 = _el$27.firstChild, _el$29 = _el$28.firstChild, _el$30 = _el$29.nextSibling, _el$31 = _el$30.nextSibling, _el$32 = _el$31.nextSibling, _el$33 = _el$32.nextSibling;
    _el$29.$$click = () => setMode("note");
    insert(_el$29, createComponent(IconGrommetIconsMusic, {}));
    _el$30.$$click = () => setMode("select");
    insert(_el$30, createComponent(IconGrommetIconsSelect, {}));
    _el$31.$$click = () => setMode("stretch");
    insert(_el$31, createComponent(IconGrommetIconsShift, {}));
    _el$32.$$click = () => setMode("velocity");
    insert(_el$32, createComponent(IconGrommetIconsVolumeControl, {}));
    _el$33.$$click = () => setMode("pan");
    insert(_el$33, createComponent(IconGrommetIconsPan, {}));
    insert(_el$27, createComponent(Show, {
      get when() {
        return createMemo(() => !!(mode() === "select" && clipboard() && selectionPresence()))() && [clipboard(), selectionPresence()];
      },
      children: (clipboardAndPresence) => (() => {
        var _el$35 = _tmpl$14();
        _el$35.style.setProperty("display", "grid");
        `${HEIGHT * 2 - 2}px` != null ? _el$35.style.setProperty("grid-template-rows", `${HEIGHT * 2 - 2}px`) : _el$35.style.removeProperty("grid-template-rows");
        insert(_el$35, createComponent(ActionButton, {
          get ["class"]() {
            return mode() === "stretch" ? styles.active : void 0;
          },
          onClick: () => pasteNotes(...clipboardAndPresence()),
          get children() {
            return createComponent(IconGrommetIconsCopy, {});
          }
        }));
        return _el$35;
      })()
    }), null);
    insert(_el$27, createComponent(Show, {
      get when() {
        return mode() === "select";
      },
      get children() {
        var _el$34 = _tmpl$14();
        insert(_el$34, createComponent(ActionButton, {
          get ["class"]() {
            return mode() === "stretch" ? styles.active : void 0;
          },
          onClick: copyNotes,
          get children() {
            return createComponent(IconGrommetIconsClipboard, {});
          }
        }), null);
        insert(_el$34, createComponent(ActionButton, {
          onClick: () => {
            const cutLine = selectionArea()?.start.x;
            if (!cutLine) {
              console.error("Attempting to slice without slice-line");
              return;
            }
            const newNotes = selectedNotes().filter((note) => note.time < selectionArea().start.x).map((note) => {
              return {
                id: get(),
                active: true,
                duration: note.duration - (cutLine - note.time),
                pitch: note.pitch,
                time: cutLine,
                velocity: note.velocity
              };
            });
            setDoc((doc2) => doc2.notes.push(...newNotes));
            setSelectedNotes((notes) => [...notes, ...newNotes]);
            setDoc((doc2) => {
              doc2.notes.forEach((note) => {
                if (isNoteSelected(note) && note.time < cutLine) {
                  note.duration = cutLine - note.time;
                }
              });
            });
          },
          get children() {
            return createComponent(IconGrommetIconsCut, {});
          }
        }), null);
        insert(_el$34, createComponent(ActionButton, {
          onClick: () => {
            setDoc((doc2) => {
              for (let index = doc2.notes.length - 1; index >= 0; index--) {
                if (isNoteSelected(doc2.notes[index])) {
                  doc2.notes.splice(index, 1);
                }
              }
            });
            setSelectedNotes([]);
          },
          get children() {
            return createComponent(IconGrommetIconsErase, {});
          }
        }), null);
        insert(_el$34, createComponent(ActionButton, {
          onClick: () => {
            let inactiveSelectedNotes = 0;
            selectedNotes().forEach((note) => {
              if (!note.active) {
                inactiveSelectedNotes++;
              }
            });
            const shouldActivate = inactiveSelectedNotes > selectedNotes().length / 2;
            setDoc((doc2) => {
              doc2.notes.forEach((note) => {
                if (isNoteSelected(note)) {
                  note.active = shouldActivate;
                }
              });
            });
          },
          get children() {
            return createComponent(IconGrommetIconsDisabledOutline, {});
          }
        }), null);
        createRenderEffect((_p$) => {
          var _v$22 = selectedNotes().length === 0 ? 0.5 : void 0, _v$23 = selectedNotes().length === 0 ? "none" : void 0;
          _v$22 !== _p$.e && ((_p$.e = _v$22) != null ? _el$34.style.setProperty("opacity", _v$22) : _el$34.style.removeProperty("opacity"));
          _v$23 !== _p$.t && ((_p$.t = _v$23) != null ? _el$34.style.setProperty("pointer-events", _v$23) : _el$34.style.removeProperty("pointer-events"));
          return _p$;
        }, {
          e: void 0,
          t: void 0
        });
        return _el$34;
      }
    }), null);
    createRenderEffect((_p$) => {
      var _v$24 = styles.topRightHud, _v$25 = mode() === "note" ? styles.active : void 0, _v$26 = mode() === "select" ? styles.active : void 0, _v$27 = mode() === "stretch" ? styles.active : void 0, _v$28 = mode() === "velocity" ? styles.active : void 0, _v$29 = mode() === "pan" ? styles.active : void 0;
      _v$24 !== _p$.e && className(_el$27, _p$.e = _v$24);
      _v$25 !== _p$.t && className(_el$29, _p$.t = _v$25);
      _v$26 !== _p$.a && className(_el$30, _p$.a = _v$26);
      _v$27 !== _p$.o && className(_el$31, _p$.o = _v$27);
      _v$28 !== _p$.i && className(_el$32, _p$.i = _v$28);
      _v$29 !== _p$.n && className(_el$33, _p$.n = _v$29);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0,
      i: void 0,
      n: void 0
    });
    return _el$27;
  })();
}
function BottomLeftHud() {
  return (() => {
    var _el$36 = _tmpl$17(), _el$37 = _el$36.firstChild, _el$38 = _el$37.firstChild;
    _el$38.$$click = () => setTimeScale((duration) => duration / 2);
    insert(_el$38, createComponent(IconGrommetIconsMenu, {}));
    createRenderEffect(() => className(_el$36, styles.bottomLeftHud));
    return _el$36;
  })();
}
function BottomRightHud() {
  return (() => {
    var _el$39 = _tmpl$18(), _el$40 = _el$39.firstChild, _el$41 = _el$40.nextSibling, _el$42 = _el$41.nextSibling, _el$43 = _el$42.firstChild, _el$44 = _el$43.nextSibling;
    insert(_el$40, createComponent(NumberButton, {
      get value() {
        return createMemo(() => timeScale() < 1)() ? `1:${1 / timeScale()}` : timeScale();
      },
      decrement: () => setTimeScale((duration) => duration / 2),
      increment: () => setTimeScale((duration) => duration * 2)
    }));
    insert(_el$41, createComponent(NumberButton, {
      get value() {
        return doc().instrument.toString().padStart(3, "0");
      },
      decrement: () => {
        if (doc().instrument > 0) {
          setDoc((doc2) => {
            doc2.instrument = doc2.instrument - 1;
          });
        } else {
          setDoc((doc2) => {
            doc2.instrument = 174;
          });
        }
      },
      increment: () => {
        if (doc().instrument >= 174) {
          setDoc((doc2) => {
            doc2.instrument = 0;
          });
        } else {
          setDoc((doc2) => {
            doc2.instrument = doc2.instrument + 1;
          });
        }
      }
    }));
    _el$43.$$click = () => {
      setNow(loop.time);
      setPlaying(false);
      playedNotes.clear();
    };
    insert(_el$43, createComponent(IconGrommetIconsStop, {}));
    addEventListener(_el$44, "click", togglePlaying, true);
    insert(_el$44, (() => {
      var _c$ = createMemo(() => !!!playing());
      return () => _c$() ? createComponent(IconGrommetIconsPlay, {}) : createComponent(IconGrommetIconsPause, {});
    })());
    createRenderEffect(() => className(_el$39, styles.bottomRightHud));
    return _el$39;
  })();
}
const dimensionsContext = createContext();
function useDimensions() {
  const context = useContext(dimensionsContext);
  if (!context) {
    throw `PianoContext is undefined.`;
  }
  return context;
}
function App() {
  createEffect(() => {
    if (mode() !== "select") {
      setSelectionPresence();
      setSelectionArea();
    }
  });
  createEffect(mapArray(() => doc().notes, (note) => {
    createEffect(on(() => isNoteSelected(note), (selected) => selected && playNote({
      ...note,
      duration: Math.min(1, note.duration)
    })));
  }));
  createEffect(on(playing, (playing2) => {
    if (!playing2 || !audioContext) return;
    let shouldPlay = true;
    function clock() {
      if (!shouldPlay) return;
      let time = audioContext.currentTime * VELOCITY - timeOffset();
      if (loop) {
        if (time < loop.time) {
          playedNotes.clear();
          time = loop.time;
          setTimeOffset(audioContext.currentTime * VELOCITY - loop.time);
        } else if (time > loop.time + loop.duration) {
          playedNotes.clear();
          setTimeOffset(audioContext.currentTime * VELOCITY - loop.time);
          clock();
          return;
        }
      }
      setNow(time);
      doc().notes.forEach((note) => {
        if (!note.active) return;
        if (playedNotes.has(note)) return;
        const loopEnd = loop.time + loop.duration;
        const overflow = time + 1 - loopEnd;
        if (overflow > 0) {
          if (note.time >= time && note.time < loopEnd) {
            playedNotes.add(note);
            playNote(note, (note.time - time) / VELOCITY);
          } else if (note.time >= loop.time && note.time < loop.time + overflow) {
            playedNotes.add(note);
            playNote(note, (note.time + loopEnd - time) / VELOCITY);
          }
        } else if (note.time >= time && note.time < time + 1) {
          playedNotes.add(note);
          playNote(note, (note.time - time) / VELOCITY);
        }
      });
      requestAnimationFrame(clock);
    }
    clock();
    onCleanup(() => shouldPlay = false);
  }));
  onMount(() => {
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space") {
        togglePlaying();
      } else if (mode() === "select") {
        if (e.code === "KeyC" && (e.ctrlKey || e.metaKey)) {
          copyNotes();
        } else if (e.code === "KeyV" && (e.ctrlKey || e.metaKey)) {
          const presence = selectionPresence();
          const notes = clipboard();
          if (notes && presence) {
            pasteNotes(notes, presence);
          }
        }
      }
    });
  });
  return (() => {
    var _el$45 = _tmpl$19(), _el$46 = _el$45.firstChild;
    _el$45.style.setProperty("width", "100%");
    _el$45.style.setProperty("height", "100%");
    _el$45.style.setProperty("overflow", "hidden");
    insert(_el$45, createComponent(TopLeftHud, {}), _el$46);
    insert(_el$45, createComponent(TopRightHud, {}), _el$46);
    insert(_el$45, createComponent(BottomRightHud, {}), _el$46);
    insert(_el$45, createComponent(BottomLeftHud, {}), _el$46);
    _el$46.$$pointerdown = async (event) => {
      switch (mode()) {
        case "note":
          handleCreateNote(event);
          break;
        case "select":
          handleSelectionBox(event);
          break;
        case "pan":
          handlePan(event);
      }
    };
    _el$46.addEventListener("wheel", (event) => setOrigin((origin2) => ({
      x: origin2.x - event.deltaX,
      y: origin2.y - event.deltaY * 2 / 3
    })));
    _el$46.$$dblclick = () => setSelectedNotes([]);
    use((element) => {
      onMount(() => {
        const observer = new ResizeObserver(() => {
          setDimensions(element.getBoundingClientRect());
        });
        observer.observe(element);
        onCleanup(() => observer.disconnect());
      });
    }, _el$46);
    _el$46.style.setProperty("width", "100%");
    _el$46.style.setProperty("height", "100%");
    _el$46.style.setProperty("overflow", "hidden");
    insert(_el$46, createComponent(Show, {
      get when() {
        return dimensions();
      },
      children: (dimensions2) => createComponent(dimensionsContext.Provider, {
        value: dimensions2,
        get children() {
          return [createComponent(PianoUnderlay, {}), createComponent(Grid, {}), createComponent(Show, {
            get when() {
              return createMemo(() => mode() === "select")() && selectionArea();
            },
            children: (area) => (() => {
              var _el$49 = _tmpl$20();
              createRenderEffect((_p$) => {
                var _v$34 = area().start.x * WIDTH + origin().x, _v$35 = area().start.y * HEIGHT + origin().y, _v$36 = (area().end.x - area().start.x) * WIDTH, _v$37 = (area().end.y - area().start.y) * HEIGHT;
                _v$34 !== _p$.e && setAttribute(_el$49, "x", _p$.e = _v$34);
                _v$35 !== _p$.t && setAttribute(_el$49, "y", _p$.t = _v$35);
                _v$36 !== _p$.a && setAttribute(_el$49, "width", _p$.a = _v$36);
                _v$37 !== _p$.o && setAttribute(_el$49, "height", _p$.o = _v$37);
                return _p$;
              }, {
                e: void 0,
                t: void 0,
                a: void 0,
                o: void 0
              });
              return _el$49;
            })()
          }), createComponent(Show, {
            get when() {
              return createMemo(() => mode() === "select")() && selectionPresence();
            },
            children: (presence) => (() => {
              var _el$50 = _tmpl$21();
              setAttribute(_el$50, "height", HEIGHT);
              createRenderEffect((_p$) => {
                var _v$38 = presence().x * WIDTH + origin().x, _v$39 = presence().y * HEIGHT + origin().y, _v$40 = WIDTH * timeScale();
                _v$38 !== _p$.e && setAttribute(_el$50, "x", _p$.e = _v$38);
                _v$39 !== _p$.t && setAttribute(_el$50, "y", _p$.t = _v$39);
                _v$40 !== _p$.a && setAttribute(_el$50, "width", _p$.a = _v$40);
                return _p$;
              }, {
                e: void 0,
                t: void 0,
                a: void 0
              });
              return _el$50;
            })()
          }), createComponent(Show, {
            get when() {
              return doc().notes.length > 0;
            },
            get children() {
              var _el$47 = _tmpl$5();
              insert(_el$47, createComponent(For, {
                get each() {
                  return doc().notes;
                },
                children: (note) => createComponent(Note, {
                  note
                })
              }));
              createRenderEffect((_$p) => (_$p = `translate(${origin().x}px, ${origin().y}px)`) != null ? _el$47.style.setProperty("transform", _$p) : _el$47.style.removeProperty("transform"));
              return _el$47;
            }
          }), (() => {
            var _el$48 = _tmpl$3();
            _el$48.style.setProperty("opacity", "0.075");
            createRenderEffect((_p$) => {
              var _v$30 = styles.now, _v$31 = WIDTH * timeScale(), _v$32 = dimensions2().height, _v$33 = `translateX(${origin().x + Math.floor(now() / timeScale()) * WIDTH * timeScale()}px)`;
              _v$30 !== _p$.e && setAttribute(_el$48, "class", _p$.e = _v$30);
              _v$31 !== _p$.t && setAttribute(_el$48, "width", _p$.t = _v$31);
              _v$32 !== _p$.a && setAttribute(_el$48, "height", _p$.a = _v$32);
              _v$33 !== _p$.o && ((_p$.o = _v$33) != null ? _el$48.style.setProperty("transform", _v$33) : _el$48.style.removeProperty("transform"));
              return _p$;
            }, {
              e: void 0,
              t: void 0,
              a: void 0,
              o: void 0
            });
            return _el$48;
          })(), createComponent(Ruler, {
            loop,
            setLoop
          }), createComponent(Piano, {}), createComponent(PlayingNotes, {})];
        }
      })
    }));
    return _el$45;
  })();
}
delegateEvents(["click", "dblclick", "pointerdown"]);

render(() => createComponent(App, {}), document.getElementById("root"));
