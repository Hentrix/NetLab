/* xterm.js (pinned, same-origin assets) is the primary terminal renderer.
   An older text renderer is used only if the optional vendor assets are absent. */
export const xtermPalette = (theme) => theme === 'dark' ? {
  background:'#0b1620', foreground:'#c5d9e9', cursor:'#b9ddf4', cursorAccent:'#0b1620',
  selectionBackground:'#507ba877', black:'#12202d', red:'#eb7f84', green:'#7bd6a6',
  yellow:'#e8c77c', blue:'#82b9ef', magenta:'#cf9bdf', cyan:'#73d2d6', white:'#e9f3fd',
  brightBlack:'#637d92', brightRed:'#f2999c', brightGreen:'#a0e8bd',
  brightYellow:'#f5d89b', brightBlue:'#a8cffa', brightMagenta:'#e2b4e8',
  brightCyan:'#9ce6e8', brightWhite:'#fff'
} : {
  background:'#ffffff', foreground:'#253b50', cursor:'#264b70', cursorAccent:'#fff',
  selectionBackground:'#a6ceef99', black:'#1a2633', red:'#b83245', green:'#117d52',
  yellow:'#91680c', blue:'#1769b2', magenta:'#8643ad', cyan:'#197786', white:'#eef4f8',
  brightBlack:'#5b7084', brightRed:'#c94d5b', brightGreen:'#128b5b',
  brightYellow:'#a27812', brightBlue:'#287ec0', brightMagenta:'#9856bc',
  brightCyan:'#23899a', brightWhite:'#fff'
};
export function xtermAvailable(win=globalThis) {
  return typeof win.Terminal === 'function' && typeof win.FitAddon?.FitAddon === 'function';
}
export function createXtermSession(node, onData, theme, win=globalThis) {
  if(!xtermAvailable(win)) return null;
  const terminal=new win.Terminal({
    allowTransparency:false, convertEol:false, cursorBlink:true, cursorStyle:'block',
    fontFamily:'"Cascadia Code", Consolas, "DejaVu Sans Mono", monospace',
    fontSize:13, lineHeight:1.18, scrollback:7000, theme:xtermPalette(theme)
  });
  const fit=new win.FitAddon.FitAddon();
  terminal.loadAddon(fit);
  const dataSub=terminal.onData(onData);
  terminal.open(node);
  return {
    terminal,
    fit(){if(node.isConnected && node.getBoundingClientRect().width>20 && node.getBoundingClientRect().height>20)fit.fit();},
    theme(value){terminal.options.theme=xtermPalette(value);},
    focus(){terminal.focus();},
    refresh(){terminal.refresh(0,terminal.rows-1);},
    dispose(){dataSub?.dispose();terminal.dispose();}
  };
}
