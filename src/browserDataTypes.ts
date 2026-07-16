export type BrowserPanelMode = 'bookmarks' | 'history';

export type BrowserDataItem = {
  id: string;
  url: string;
  title: string;
  timestamp: number;
};

export type BrowserPanelData = {
  mode: BrowserPanelMode;
  items: BrowserDataItem[];
};

export type CurrentPageState = {
  url: string;
  title: string;
  isBookmarked: boolean;
  isPrivate: boolean;
};

export type BookmarkToggleResult = {
  bookmarked: boolean;
  item?: BrowserDataItem;
};
