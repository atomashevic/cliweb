import { type ComponentProps, createSignal, For, Show, splitProps } from 'solid-js';
import type {
  BookmarkToggleResult,
  BrowserDataItem,
  BrowserPanelData,
  BrowserPanelMode,
  CurrentPageState,
} from '../../browserDataTypes';

export interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserToolbar {
  navigateBack: () => void;
  navigateForward: () => void;
  refresh: () => void;
  navigateTo: (url: string) => void;
  getCurrentPageState: () => Promise<CurrentPageState>;
  toggleBookmark: () => Promise<BookmarkToggleResult>;
  setPanelMode: (mode: BrowserPanelMode | null) => Promise<BrowserPanelMode | null>;
  queryPanel: (mode: BrowserPanelMode, query?: string, limit?: number) => Promise<BrowserPanelData>;
  removeBookmark: (id: string) => Promise<boolean>;
  openBrowserDataItem: (url: string) => Promise<void>;
  clearHistory: () => Promise<number>;
  clearCurrentSiteData: () => Promise<string>;
  onLoadingStarted: (callback: () => void) => void;
  onLoadingStopped: (callback: () => void) => void;
  onUrlChanged: (callback: (url: string) => void) => void;
  onNavigationStateChanged: (callback: (state: NavigationState) => void) => void;
  onCurrentPageChanged: (callback: (state: CurrentPageState) => void) => void;
  onBookmarkStateChanged: (callback: (bookmarked: boolean) => void) => void;
  onPanelModeChanged: (callback: (mode: BrowserPanelMode | null) => void) => void;
  onBrowserDataChanged: (callback: (mode: BrowserPanelMode) => void) => void;
  findInPage: (text: string, options: { forward: boolean; matchCase: boolean }) => void;
  stopFindInPage: () => void;
  onToggleFind: (callback: () => void) => void;
}

declare global {
  interface Window {
    ipc: BrowserToolbar;
  }
}

function Button(props: ComponentProps<'button'>) {
  const [local, others] = splitProps(props, ['class']);
  return (
    <button
      {...others}
      class={`size-6 shrink-0 focus:outline-1 focus:outline-kitty-fg/50 text-lg rounded leading-none hover:bg-kitty-fg/10 disabled:text-kitty-fg/50 disabled:hover:bg-transparent text-kitty-fg ${local.class ?? ''}`}
    />
  );
}

function TextButton(props: ComponentProps<'button'>) {
  const [local, others] = splitProps(props, ['class']);
  return (
    <button
      {...others}
      class={`h-7 shrink-0 px-2 text-sm rounded border border-kitty-fg/40 hover:bg-kitty-fg/10 focus:outline-1 focus:outline-kitty-fg/50 disabled:text-kitty-fg/50 ${local.class ?? ''}`}
    />
  );
}

function Checkbox(props: ComponentProps<'button'> & { checked: boolean }) {
  const [local, others] = splitProps(props, ['class', 'checked']);
  return (
    <button
      {...others}
      class={`size-6 focus:outline-1 focus:outline-kitty-fg/50 text-lg rounded leading-none hover:bg-kitty-fg/10 text-kitty-fg ${local.class ?? ''}`}
    >
      {local.checked ? '☒' : '☐'}
    </button>
  );
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

export function Toolbar() {
  const [isLoading, setIsLoading] = createSignal(false);
  const [url, setUrl] = createSignal('');
  const [isFindMode, setIsFindMode] = createSignal(false);
  const [navigationState, setNavigationState] = createSignal<NavigationState>({
    canGoBack: false,
    canGoForward: false,
  });
  const [matchCase, setMatchCase] = createSignal(false);
  const [currentPage, setCurrentPage] = createSignal<CurrentPageState>({
    url: '',
    title: '',
    isBookmarked: false,
    isPrivate: false,
  });
  const [activePanel, setActivePanel] = createSignal<BrowserPanelMode | null>(null);
  const [panelItems, setPanelItems] = createSignal<BrowserDataItem[]>([]);
  const [panelQuery, setPanelQuery] = createSignal('');
  const [message, setMessage] = createSignal('');
  const [confirmAction, setConfirmAction] = createSignal<'site' | 'history' | null>(null);

  let inputRef: HTMLInputElement | undefined;
  let findInputRef: HTMLInputElement | undefined;
  let panelSearchRef: HTMLInputElement | undefined;
  let querySequence = 0;
  let messageTimer: ReturnType<typeof setTimeout> | undefined;

  const showMessage = (value: string) => {
    setMessage(value);
    if (messageTimer) clearTimeout(messageTimer);
    messageTimer = setTimeout(() => setMessage(''), 4_000);
  };

  const refreshPanel = async (mode = activePanel(), query = panelQuery()) => {
    if (!mode) return;
    const sequence = ++querySequence;
    try {
      const data = await window.ipc.queryPanel(mode, query, 500);
      if (sequence === querySequence && activePanel() === mode) setPanelItems(data.items);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error));
    }
  };

  window.ipc.onLoadingStarted(() => setIsLoading(true));
  window.ipc.onLoadingStopped(() => setIsLoading(false));
  window.ipc.onUrlChanged((newUrl: string) => setUrl(newUrl));
  window.ipc.onNavigationStateChanged((state: NavigationState) => setNavigationState(state));
  window.ipc.onCurrentPageChanged((state) => {
    setCurrentPage(state);
    setUrl(state.url);
    setConfirmAction(null);
  });
  window.ipc.onBookmarkStateChanged((isBookmarked) => {
    setCurrentPage((state) => ({ ...state, isBookmarked }));
  });
  window.ipc.onPanelModeChanged((mode) => {
    setActivePanel(mode);
    setConfirmAction(null);
    setMessage('');
    if (mode) {
      setIsFindMode(false);
      setPanelQuery('');
      void refreshPanel(mode, '');
      setTimeout(() => panelSearchRef?.focus(), 0);
    }
  });
  window.ipc.onBrowserDataChanged((mode) => {
    if (activePanel() === mode) void refreshPanel(mode);
  });
  window.ipc.onToggleFind(() => {
    if (activePanel()) return;
    if (!isFindMode()) {
      setIsFindMode(true);
      setTimeout(() => findInputRef?.focus(), 0);
    } else {
      setIsFindMode(false);
      window.ipc.stopFindInPage();
    }
  });

  void window.ipc
    .getCurrentPageState()
    .then(setCurrentPage)
    .catch(() => {});

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (activePanel()) {
      void window.ipc.setPanelMode(null);
      return;
    }
    setConfirmAction(null);
    setIsFindMode(false);
    window.ipc.stopFindInPage();
  });

  const handleUrlSubmit = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    let targetUrl = (event.currentTarget as HTMLInputElement).value.trim();
    if (!/^https?:\/\//i.test(targetUrl)) targetUrl = `https://${targetUrl}`;
    window.ipc.navigateTo(targetUrl);
  };

  const handleInputClick = (event: MouseEvent) => {
    const input = event.currentTarget as HTMLInputElement;
    if (document.activeElement !== input || input.selectionStart === input.selectionEnd) {
      input.select();
    }
  };

  const handleFind = () => {
    if (!findInputRef) return;
    window.ipc.findInPage(findInputRef.value, { forward: true, matchCase: matchCase() });
  };

  const handleFindSubmit = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      const text = (event.currentTarget as HTMLInputElement).value;
      window.ipc.findInPage(text, { forward: !event.shiftKey, matchCase: matchCase() });
    } else if (event.key === 'Escape') {
      setIsFindMode(false);
      window.ipc.stopFindInPage();
    }
  };

  const handleFindNav = (forward: boolean) => {
    if (!findInputRef) return;
    window.ipc.findInPage(findInputRef.value, { forward, matchCase: matchCase() });
  };

  const toggleBookmark = async () => {
    try {
      const result = await window.ipc.toggleBookmark();
      setCurrentPage((state) => ({ ...state, isBookmarked: result.bookmarked }));
      showMessage(result.bookmarked ? 'Bookmark added' : 'Bookmark removed');
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const openPanel = async (mode: BrowserPanelMode) => {
    try {
      await window.ipc.setPanelMode(mode);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const removeBookmark = async (id: string) => {
    await window.ipc.removeBookmark(id);
    await refreshPanel('bookmarks');
  };

  const clearHistory = async () => {
    const removed = await window.ipc.clearHistory();
    setConfirmAction(null);
    showMessage(`Cleared ${removed} history ${removed === 1 ? 'entry' : 'entries'}`);
    await refreshPanel('history');
  };

  const clearSiteData = async () => {
    try {
      const origin = await window.ipc.clearCurrentSiteData();
      setConfirmAction(null);
      showMessage(`Cleared site data for ${origin}`);
    } catch (error) {
      setConfirmAction(null);
      showMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div class="h-screen bg-kitty-bg border-b-2 border-kitty-fg/20 border-active-border text-kitty-fg box-border">
      <Show
        when={activePanel()}
        fallback={
          <div class="h-full flex items-center w-full px-1 box-border">
            <Show
              when={confirmAction() === 'site'}
              fallback={
                <>
                  <Show when={isFindMode()}>
                    <div class="flex gap-1 mx-1">
                      <Button title="Previous" onClick={() => handleFindNav(false)}>
                        ⯅
                      </Button>
                      <Button title="Next" onClick={() => handleFindNav(true)}>
                        ⯆
                      </Button>
                    </div>
                    <input
                      ref={findInputRef}
                      type="text"
                      spellcheck="false"
                      placeholder="Find in page..."
                      onKeyDown={handleFindSubmit}
                      onInput={handleFind}
                      class="grow h-6 ml-2 px-1 text-sm border rounded-xs border-kitty-fg/50 focus:border-kitty-fg selection:bg-selection-background selection:text-selection-foreground focus:outline-none bg-kitty-fg/10"
                    />
                    <label class="flex items-center text-sm ml-2">
                      <Checkbox
                        checked={matchCase()}
                        onClick={() => setMatchCase((previous) => !previous)}
                        title="Match case"
                      />
                      <span class="ml-1">Match case</span>
                    </label>
                  </Show>
                  <Show when={!isFindMode()}>
                    <div class="flex gap-1 mx-1">
                      <Button
                        title="Back"
                        disabled={!navigationState().canGoBack}
                        onClick={() => window.ipc.navigateBack()}
                      >
                        ←
                      </Button>
                      <Button
                        title="Forward"
                        disabled={!navigationState().canGoForward}
                        onClick={() => window.ipc.navigateForward()}
                      >
                        →
                      </Button>
                      <Button
                        title={isLoading() ? 'Stop' : 'Refresh'}
                        onClick={() => window.ipc.refresh()}
                      >
                        {isLoading() ? '✕' : '↻'}
                      </Button>
                    </div>
                    <Show when={currentPage().isPrivate}>
                      <span
                        class="text-xs px-1 mr-1 border border-kitty-fg/40 rounded"
                        title="Private browsing"
                      >
                        Private
                      </span>
                    </Show>
                    <input
                      ref={inputRef}
                      type="text"
                      placeholder="Enter URL"
                      value={url()}
                      spellcheck="false"
                      onClick={handleInputClick}
                      onKeyDown={handleUrlSubmit}
                      class={`flex-1 min-w-16 h-6 px-1 text-sm border rounded-xs border-kitty-fg/50 focus:border-kitty-fg selection:bg-selection-background selection:text-selection-foreground focus:outline-none ${
                        isLoading()
                          ? 'bg-kitty-fg/10 border-kitty-fg/50 text-kitty-fg/50'
                          : 'bg-kitty-fg/10'
                      }`}
                    />
                    <div class="flex gap-1 ml-1">
                      <Button
                        title={
                          currentPage().isBookmarked ? 'Remove bookmark' : 'Bookmark this page'
                        }
                        disabled={!/^https?:\/\//i.test(currentPage().url)}
                        onClick={() => void toggleBookmark()}
                      >
                        {currentPage().isBookmarked ? '★' : '☆'}
                      </Button>
                      <Button title="Bookmarks" onClick={() => void openPanel('bookmarks')}>
                        ☷
                      </Button>
                      <Button title="History" onClick={() => void openPanel('history')}>
                        ◷
                      </Button>
                      <Button
                        title="Clear cookies and site data"
                        disabled={!/^https?:\/\//i.test(currentPage().url)}
                        onClick={() => setConfirmAction('site')}
                      >
                        ⌫
                      </Button>
                    </div>
                    <Show when={message()}>
                      <span class="max-w-48 ml-2 text-xs truncate" title={message()}>
                        {message()}
                      </span>
                    </Show>
                  </Show>
                </>
              }
            >
              <div class="flex items-center gap-2 w-full px-2 text-sm">
                <span class="grow truncate">Clear cookies and site data for this site?</span>
                <TextButton onClick={() => void clearSiteData()} class="border-red-400/70">
                  Clear
                </TextButton>
                <TextButton onClick={() => setConfirmAction(null)}>Cancel</TextButton>
              </div>
            </Show>
          </div>
        }
      >
        {(modeAccessor) => {
          const mode = modeAccessor();
          return (
            <div class="h-full flex flex-col">
              <div class="h-11 shrink-0 flex items-center gap-2 px-2 border-b border-kitty-fg/20">
                <TextButton onClick={() => void window.ipc.setPanelMode(null)}>Close</TextButton>
                <h1 class="text-base font-semibold w-24 capitalize">{mode}</h1>
                <Show when={currentPage().isPrivate && mode === 'history'}>
                  <span class="text-xs opacity-70">Private visits are not recorded</span>
                </Show>
                <input
                  ref={panelSearchRef}
                  type="search"
                  value={panelQuery()}
                  placeholder={`Search ${mode}`}
                  onInput={(event) => {
                    const query = event.currentTarget.value;
                    setPanelQuery(query);
                    void refreshPanel(mode, query);
                  }}
                  class="grow min-w-24 h-7 px-2 text-sm border rounded border-kitty-fg/50 focus:border-kitty-fg focus:outline-none bg-kitty-fg/10"
                />
                <Show when={mode === 'bookmarks'}>
                  <TextButton
                    disabled={!/^https?:\/\//i.test(currentPage().url)}
                    onClick={() => void toggleBookmark()}
                  >
                    {currentPage().isBookmarked ? 'Remove current' : 'Add current'}
                  </TextButton>
                </Show>
                <Show when={mode === 'history'}>
                  <Show
                    when={confirmAction() === 'history'}
                    fallback={
                      <TextButton onClick={() => setConfirmAction('history')}>
                        Clear history
                      </TextButton>
                    }
                  >
                    <span class="text-sm">Clear all?</span>
                    <TextButton onClick={() => void clearHistory()} class="border-red-400/70">
                      Clear
                    </TextButton>
                    <TextButton onClick={() => setConfirmAction(null)}>Cancel</TextButton>
                  </Show>
                </Show>
              </div>
              <Show when={message()}>
                <div class="shrink-0 px-3 py-1 text-xs border-b border-kitty-fg/20">
                  {message()}
                </div>
              </Show>
              <div class="grow min-h-0 overflow-y-auto p-2">
                <Show
                  when={panelItems().length > 0}
                  fallback={<div class="p-6 text-center opacity-60">No matching {mode}</div>}
                >
                  <div class="flex flex-col gap-1">
                    <For each={panelItems()}>
                      {(item) => (
                        <div class="flex items-center gap-2 px-2 py-2 rounded hover:bg-kitty-fg/8 border border-transparent hover:border-kitty-fg/15">
                          <button
                            class="grow min-w-0 text-left focus:outline-1 focus:outline-kitty-fg/50 rounded"
                            onClick={() => void window.ipc.openBrowserDataItem(item.url)}
                          >
                            <div class="truncate text-sm font-medium">{item.title}</div>
                            <div class="truncate text-xs opacity-60">{item.url}</div>
                          </button>
                          <time class="shrink-0 text-xs opacity-60">
                            {formatTimestamp(item.timestamp)}
                          </time>
                          <Show when={mode === 'bookmarks'}>
                            <TextButton onClick={() => void removeBookmark(item.id)}>
                              Remove
                            </TextButton>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
          );
        }}
      </Show>
    </div>
  );
}
