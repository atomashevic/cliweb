type FocusableSurface = {
  webContents: {
    focus(): void;
  };
  focus(): void;
  blurWebView(): void;
  focusOnWebView(): void;
};

export type MouseFocusView = {
  toolbar: FocusableSurface;
  content: FocusableSurface;
  focusedContent: object;
};

export function focusMouseTarget(view: MouseFocusView, target: object) {
  if (target === view.content.webContents) {
    view.toolbar.blurWebView();
    view.content.focus();
    view.content.focusOnWebView();
    view.content.webContents.focus();
  } else {
    view.content.blurWebView();
    view.toolbar.focus();
    view.toolbar.focusOnWebView();
    view.toolbar.webContents.focus();
  }
  view.focusedContent = target;
}
