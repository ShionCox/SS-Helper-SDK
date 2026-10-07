import type {
  PopupListDefinition,
  PopupListHandle,
  PopupListItemContext,
  PopupListPage,
} from '@ss-helper/sdk';

interface CachedPage<T> {
  readonly index: number;
  readonly cursor?: string;
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  touchedAt: number;
}

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_OVERSCAN = 6;
const DEFAULT_MAX_PAGES = 6;
const DEFAULT_ESTIMATED_HEIGHT = 72;
// Sparse Fenwick nodes let dynamic-height lists answer prefix queries without
// materialising an array for every possible virtual row.
const FENWICK_MAX_INDEX = 0x40000000;

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function viewportHeight(element: HTMLElement): number {
  return Math.max(1, Number(element.clientHeight || element.getBoundingClientRect().height || 1));
}

function schedule(document: Document, callback: () => void): void {
  const request = document.defaultView?.requestAnimationFrame;
  if (typeof request === 'function') request.call(document.defaultView, callback);
  else queueMicrotask(callback);
}

export interface MountedPopupList<T> extends PopupListHandle {
  attach(host: HTMLElement): void;
  update(definition: PopupListDefinition<T>): void;
}

export function mountPopupList<T>(
  document: Document,
  host: HTMLElement,
  initialDefinition: PopupListDefinition<T>,
): MountedPopupList<T> {
  const element = document.createElement('div');
  element.className = 'stx-popup-list';
  element.dataset.ssHelperControl = 'list';
  element.tabIndex = 0;

  const canvas = document.createElement('div');
  canvas.className = 'stx-popup-list-canvas';
  const rows = document.createElement('div');
  rows.className = 'stx-popup-list-rows';
  const status = document.createElement('div');
  status.className = 'stx-popup-list-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  canvas.append(rows);
  element.append(canvas, status);

  let definition = initialDefinition;
  let queryKey = initialDefinition.queryKey;
  let selectedKey = initialDefinition.selectedKey;
  let focusedKey = initialDefinition.selectedKey;
  let disposed = false;
  let generation = 0;
  let requestController: AbortController | undefined;
  let requestPromise: Promise<void> | undefined;
  let nextPageIndex = 0;
  let total: number | undefined;
  let endReached = false;
  let touchSequence = 0;
  let scheduled = false;
  let error = false;
  let anchorKey: string | undefined;
  let anchorOffset = 0;
  let retainedScrollTop = 0;
  const pages = new Map<number, CachedPage<T>>();
  const cursors = new Map<number, string | undefined>([[0, undefined]]);
  const measuredHeights = new Map<number, number>();
  const heightDeltaTree = new Map<number, number>();
  const observed = new Map<HTMLElement, ResizeObserver>();

  const pageSize = (): number => positiveInteger(definition.pageSize, DEFAULT_PAGE_SIZE);
  const overscan = (): number => positiveInteger(definition.overscan, DEFAULT_OVERSCAN);
  const maxPages = (): number => positiveInteger(definition.maxCachedPages, DEFAULT_MAX_PAGES);
  const estimatedHeight = (): number => positiveInteger(definition.itemHeight ?? definition.estimatedItemHeight, DEFAULT_ESTIMATED_HEIGHT);
  const itemGap = (): number => {
    const requested = Number(definition.itemGap ?? 0);
    return Number.isFinite(requested)
      ? Math.min(Math.max(0, requested), Math.max(0, estimatedHeight() - 1))
      : 0;
  };
  const loadedCount = (): number => nextPageIndex * pageSize();
  const logicalCount = (): number => endReached ? (total ?? loadedCount()) : loadedCount();

  const addHeightDelta = (index: number, delta: number): void => {
    if (definition.itemHeight !== undefined || delta === 0 || index < 0) return;
    for (let node = index + 1; node <= FENWICK_MAX_INDEX; node += node & -node) {
      const next = (heightDeltaTree.get(node) ?? 0) + delta;
      if (next === 0) heightDeltaTree.delete(node);
      else heightDeltaTree.set(node, next);
    }
  };
  const heightDeltaBefore = (index: number): number => {
    let totalDelta = 0;
    for (let node = Math.min(Math.max(0, index), FENWICK_MAX_INDEX); node > 0; node -= node & -node) {
      totalDelta += heightDeltaTree.get(node) ?? 0;
    }
    return totalDelta;
  };
  const setMeasuredHeight = (index: number, height: number): boolean => {
    const previous = measuredHeights.get(index) ?? estimatedHeight();
    if (previous === height) return false;
    measuredHeights.set(index, height);
    addHeightDelta(index, height - previous);
    return true;
  };
  const heightAt = (index: number): number => definition.itemHeight ?? measuredHeights.get(index) ?? estimatedHeight();
  const offsetAt = (index: number): number => {
    if (definition.itemHeight !== undefined) return index * definition.itemHeight;
    return index * estimatedHeight() + heightDeltaBefore(index);
  };
  const indexAt = (offset: number): number => {
    if (definition.itemHeight !== undefined) return Math.max(0, Math.floor(offset / definition.itemHeight));
    const count = logicalCount();
    if (count <= 0) return 0;
    let low = 0;
    let high = count;
    const target = Math.max(0, offset);
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (offsetAt(middle) <= target) low = middle;
      else high = middle - 1;
    }
    return Math.min(count - 1, low);
  };
  const itemAt = (index: number): T | undefined => {
    const pageIndex = Math.floor(index / pageSize());
    const page = pages.get(pageIndex);
    if (page === undefined) return undefined;
    page.touchedAt = ++touchSequence;
    return page.items[index % pageSize()];
  };
  const keyAt = (index: number): string | undefined => {
    const item = itemAt(index);
    return item === undefined ? undefined : definition.getKey(item);
  };

  const clearObservers = (): void => {
    for (const observer of observed.values()) observer.disconnect();
    observed.clear();
  };

  const evictPages = (protectedPages: ReadonlySet<number>): void => {
    while (pages.size > maxPages()) {
      const candidate = [...pages.values()]
        .filter(page => !protectedPages.has(page.index))
        .sort((left, right) => left.touchedAt - right.touchedAt)[0];
      if (candidate === undefined) return;
      pages.delete(candidate.index);
    }
  };

  const announce = (message: string, tone?: 'error'): void => {
    status.textContent = message;
    status.dataset.tone = tone ?? 'neutral';
    status.hidden = message.length === 0;
  };

  const render = (): void => {
    if (disposed) return;
    scheduled = false;
    clearObservers();
    const count = logicalCount();
    const top = Math.max(0, Number(element.scrollTop || 0));
    const start = Math.max(0, indexAt(top) - overscan());
    const end = Math.min(count, indexAt(top + viewportHeight(element)) + overscan() + 1);
    const fragment = document.createDocumentFragment?.() ?? document.createElement('div');
    const visiblePages = new Set<number>();
    let rendered = 0;

    for (let index = start; index < end; index += 1) {
      visiblePages.add(Math.floor(index / pageSize()));
      const item = itemAt(index);
      if (item === undefined) continue;
      const key = definition.getKey(item);
      const selected = selectedKey === key;
      const focused = focusedKey === key;
      const context: PopupListItemContext = { index, selected, focused, ...(total === undefined ? {} : { setSize: total }) };
      const row = definition.renderItem(item, context);
      row.classList.add('stx-popup-list-row');
      row.dataset.listKey = key;
      row.dataset.listIndex = String(index);
      row.style.position = 'absolute';
      row.style.insetInline = '0';
      const gap = itemGap();
      row.style.top = `${offsetAt(index) + gap / 2}px`;
      if (definition.itemHeight !== undefined) row.style.height = `${definition.itemHeight - gap}px`;
      row.setAttribute('role', definition.selectable === true ? 'option' : 'listitem');
      if (definition.selectable === true) {
        row.setAttribute('aria-selected', String(selected));
        row.tabIndex = focused ? 0 : -1;
        if (total !== undefined) row.setAttribute('aria-setsize', String(total));
        row.setAttribute('aria-posinset', String(index + 1));
      }
      fragment.append(row);
      rendered += 1;

      if (definition.itemHeight === undefined && typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver((entries) => {
          const entry = entries[0];
          const borderBox = entry?.borderBoxSize;
          const boxSize = Array.isArray(borderBox) ? borderBox[0] : borderBox;
          const height = Math.ceil(boxSize?.blockSize
            ?? row.getBoundingClientRect().height
            ?? entry?.contentRect.height
            ?? 0);
          if (height > 0 && setMeasuredHeight(index, height + gap)) {
            scheduleRender();
          }
        });
        observer.observe(row);
        observed.set(row, observer);
      }
    }

    rows.replaceChildren(fragment);
    canvas.style.height = `${offsetAt(count)}px`;
    evictPages(visiblePages);
    if (rendered === 0 && !requestPromise && endReached) announce(definition.emptyLabel ?? '暂无内容');
    else if (!requestPromise && !error) announce('');

    const loadedBottom = offsetAt(loadedCount());
    const scrollExtent = Number(element.scrollHeight);
    const triggerBottom = Number.isFinite(scrollExtent) && scrollExtent > 0 ? scrollExtent : loadedBottom;
    const reachedLoadedBottom = top + viewportHeight(element) >= Math.max(0, triggerBottom - 1);
    const shouldLoadNext = !endReached
      && !requestPromise
      && (nextPageIndex === 0 || reachedLoadedBottom);
    if (shouldLoadNext) void loadPage(nextPageIndex);
    for (const pageIndex of visiblePages) if (!pages.has(pageIndex) && !requestPromise) void loadPage(pageIndex);
  };

  function scheduleRender(): void {
    if (scheduled || disposed) return;
    scheduled = true;
    schedule(document, render);
  }

  const rememberAnchor = (): void => {
    const index = indexAt(Number(element.scrollTop || 0));
    anchorKey = keyAt(index);
    anchorOffset = Number(element.scrollTop || 0) - offsetAt(index);
  };

  const restoreAnchor = (): void => {
    if (anchorKey === undefined) return;
    for (const page of pages.values()) {
      const itemIndex = page.items.findIndex(item => definition.getKey(item) === anchorKey);
      if (itemIndex < 0) continue;
      retainedScrollTop = offsetAt(page.index * pageSize() + itemIndex) + anchorOffset;
      element.scrollTop = retainedScrollTop;
      return;
    }
  };

  const loadPage = async (pageIndex: number): Promise<void> => {
    if (disposed || requestPromise !== undefined || pages.has(pageIndex)) return;
    const cursor = cursors.get(pageIndex);
    if (pageIndex > 0 && cursor === undefined) return;
    const requestGeneration = generation;
    requestController = new AbortController();
    error = false;
    announce(definition.loadingLabel ?? '正在加载…');
    requestPromise = (async () => {
      try {
        const result: PopupListPage<T> = await definition.loadPage({
          ...(cursor === undefined ? {} : { cursor }),
          limit: pageSize(),
          signal: requestController!.signal,
        });
        if (disposed || requestGeneration !== generation || requestController?.signal.aborted === true) return;
        pages.set(pageIndex, {
          index: pageIndex,
          ...(cursor === undefined ? {} : { cursor }),
          items: result.items,
          nextCursor: result.nextCursor,
          touchedAt: ++touchSequence,
        });
        if (result.total !== undefined && Number.isFinite(result.total)) total = Math.max(0, Math.floor(result.total));
        else if (result.nextCursor === null) total = pageIndex * pageSize() + result.items.length;
        cursors.set(pageIndex + 1, result.nextCursor ?? undefined);
        if (pageIndex >= nextPageIndex) {
          nextPageIndex = pageIndex + 1;
          endReached = result.nextCursor === null;
        }
        restoreAnchor();
      } catch (caught) {
        if (requestController?.signal.aborted === true || requestGeneration !== generation) return;
        error = true;
        announce(definition.errorLabel ?? '加载失败，按 Enter 重试', 'error');
      } finally {
        if (requestGeneration === generation) {
          requestController = undefined;
          requestPromise = undefined;
          scheduleRender();
        }
      }
    })();
    await requestPromise;
  };

  const invalidate = (preserveAnchor: boolean): void => {
    if (preserveAnchor) rememberAnchor();
    else {
      anchorKey = undefined;
      anchorOffset = 0;
      retainedScrollTop = 0;
      element.scrollTop = retainedScrollTop;
    }
    generation += 1;
    requestController?.abort();
    requestController = undefined;
    requestPromise = undefined;
    nextPageIndex = 0;
    total = undefined;
    endReached = false;
    error = false;
    pages.clear();
    cursors.clear();
    cursors.set(0, undefined);
    measuredHeights.clear();
    heightDeltaTree.clear();
    rows.replaceChildren();
    scheduleRender();
  };

  const focusIndex = async (index: number): Promise<void> => {
    const bounded = Math.max(0, total === undefined ? index : Math.min(total - 1, index));
    const pageIndex = Math.floor(bounded / pageSize());
    if (!pages.has(pageIndex)) await loadPage(pageIndex);
    const item = itemAt(bounded);
    if (item === undefined) return;
    focusedKey = definition.getKey(item);
    retainedScrollTop = Math.max(0, offsetAt(bounded) - Math.max(0, (viewportHeight(element) - heightAt(bounded)) / 2));
    element.scrollTop = retainedScrollTop;
    scheduleRender();
    schedule(document, () => {
      for (const child of Array.from(rows.children) as HTMLElement[]) {
        if (child.dataset.listKey === focusedKey) {
          child.focus();
          break;
        }
      }
    });
  };

  element.setAttribute('role', definition.selectable === true ? 'listbox' : 'list');
  element.setAttribute('aria-label', definition.ariaLabel);
  element.addEventListener('scroll', () => {
    // A popup renderer may briefly detach a stable list while replacing its
    // host. Some browsers clear scrollTop at that point; retain only positions
    // observed while the list is connected.
    if (element.isConnected === false) return;
    retainedScrollTop = Math.max(0, Number(element.scrollTop || 0));
    scheduleRender();
  }, { passive: true });
  element.addEventListener('click', (event) => {
    if (definition.selectable !== true) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-list-index]');
    if (row === null || !element.contains(row)) return;
    const index = Number(row.dataset.listIndex);
    const item = itemAt(index);
    if (item === undefined) return;
    selectedKey = definition.getKey(item);
    focusedKey = selectedKey;
    scheduleRender();
    void definition.onSelect?.(item, { index, selected: true, focused: true, ...(total === undefined ? {} : { setSize: total }) });
  });
  element.addEventListener('keydown', (event) => {
    if (error && event.key === 'Enter') {
      event.preventDefault();
      void loadPage(Math.max(0, nextPageIndex));
      return;
    }
    if (definition.selectable !== true) return;
    const currentIndex = focusedKey === undefined
      ? 0
      : [...pages.values()].flatMap(page => page.items.map((item, offset) => ({ item, index: page.index * pageSize() + offset })))
        .find(entry => definition.getKey(entry.item) === focusedKey)?.index ?? 0;
    const pageJump = Math.max(1, Math.floor(viewportHeight(element) / estimatedHeight()));
    const next = event.key === 'ArrowDown' ? currentIndex + 1
      : event.key === 'ArrowUp' ? currentIndex - 1
        : event.key === 'PageDown' ? currentIndex + pageJump
          : event.key === 'PageUp' ? currentIndex - pageJump
            : event.key === 'Home' ? 0
              : event.key === 'End' && total !== undefined ? total - 1
                : undefined;
    if (next === undefined) return;
    event.preventDefault();
    void focusIndex(next);
  });

  const mounted: MountedPopupList<T> = {
    element,
    attach: (nextHost) => {
      if (disposed) return;
      nextHost.replaceChildren(element);
      element.scrollTop = retainedScrollTop;
      scheduleRender();
    },
    update: (nextDefinition) => {
      if (disposed) return;
      const heightModelChanged = definition.itemHeight !== nextDefinition.itemHeight
        || definition.estimatedItemHeight !== nextDefinition.estimatedItemHeight
        || definition.itemGap !== nextDefinition.itemGap;
      definition = nextDefinition;
      if (heightModelChanged) {
        measuredHeights.clear();
        heightDeltaTree.clear();
      }
      element.setAttribute('role', definition.selectable === true ? 'listbox' : 'list');
      element.setAttribute('aria-label', definition.ariaLabel);
      selectedKey = nextDefinition.selectedKey;
      if (selectedKey === undefined) focusedKey = undefined;
      else focusedKey ??= selectedKey;
      if (queryKey !== nextDefinition.queryKey) {
        queryKey = nextDefinition.queryKey;
        invalidate(false);
      } else scheduleRender();
    },
    refresh: (options) => invalidate(options?.preserveAnchor !== false),
    scrollToKey: async (key, options) => {
      let pageIndex = 0;
      while (!disposed) {
        if (!pages.has(pageIndex)) await loadPage(pageIndex);
        const page = pages.get(pageIndex);
        const offset = page?.items.findIndex(item => definition.getKey(item) === key) ?? -1;
        if (offset >= 0) {
          const index = pageIndex * pageSize() + offset;
          const height = heightAt(index);
          const align = options?.align ?? 'center';
          retainedScrollTop = align === 'start' ? offsetAt(index)
            : align === 'end' ? Math.max(0, offsetAt(index) - viewportHeight(element) + height)
              : Math.max(0, offsetAt(index) - (viewportHeight(element) - height) / 2);
          element.scrollTop = retainedScrollTop;
          focusedKey = key;
          scheduleRender();
          return true;
        }
        if (page?.nextCursor === null || page === undefined) return false;
        pageIndex += 1;
      }
      return false;
    },
    selectedKey: () => selectedKey,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      generation += 1;
      requestController?.abort();
      clearObservers();
      element.remove();
      pages.clear();
      cursors.clear();
      measuredHeights.clear();
      heightDeltaTree.clear();
    },
  };

  mounted.attach(host);
  invalidate(false);
  return mounted;
}
