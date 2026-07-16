import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('ipc', {
  // Navigation functions
  navigateBack: () => ipcRenderer.send('toolbar:navigate-back'),
  navigateForward: () => ipcRenderer.send('toolbar:navigate-forward'),
  refresh: () => ipcRenderer.send('toolbar:navigate-refresh'),
  navigateTo: (url) => ipcRenderer.send('toolbar:navigate-to', url),

  // Bookmarks, history, private state, and site data. Cookie values never cross IPC.
  getCurrentPageState: () => ipcRenderer.invoke('browser-data:get-current'),
  toggleBookmark: () => ipcRenderer.invoke('browser-data:toggle-bookmark'),
  setPanelMode: (mode) => ipcRenderer.invoke('browser-data:set-panel-mode', mode),
  queryPanel: (mode, query, limit) =>
    ipcRenderer.invoke('browser-data:query-panel', mode, query, limit),
  removeBookmark: (id) => ipcRenderer.invoke('browser-data:remove-bookmark', id),
  openBrowserDataItem: (url) => ipcRenderer.invoke('browser-data:open-item', url),
  clearHistory: () => ipcRenderer.invoke('browser-data:clear-history'),
  clearCurrentSiteData: () => ipcRenderer.invoke('browser-data:clear-site-data'),

  // Find in page functions
  findInPage: (text, options) => ipcRenderer.invoke('findInPage', text, options),
  stopFindInPage: () => ipcRenderer.invoke('stopFindInPage'),

  // Event listeners
  onLoadingStarted: (callback) => ipcRenderer.on('content:loading-started', callback),
  onLoadingStopped: (callback) => ipcRenderer.on('content:loading-stopped', callback),
  onUrlChanged: (callback) => ipcRenderer.on('content:url-changed', (_event, url) => callback(url)),
  onNavigationStateChanged: (callback) =>
    ipcRenderer.on('content:navigation-state-changed', (_event, state) => callback(state)),
  onToggleFind: (callback) => ipcRenderer.on('toolbar:toggle-find', callback),
  onCurrentPageChanged: (callback) =>
    ipcRenderer.on('browser-data:current-page-changed', (_event, state) => callback(state)),
  onBookmarkStateChanged: (callback) =>
    ipcRenderer.on('browser-data:bookmark-state-changed', (_event, bookmarked) =>
      callback(bookmarked),
    ),
  onPanelModeChanged: (callback) =>
    ipcRenderer.on('browser-data:panel-mode-changed', (_event, mode) => callback(mode)),
  onBrowserDataChanged: (callback) =>
    ipcRenderer.on('browser-data:data-changed', (_event, mode) => callback(mode)),
});
