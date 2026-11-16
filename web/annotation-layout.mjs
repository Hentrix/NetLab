// Canvas annotation geometry is expressed in unzoomed world pixels.
// Keep a minimum clickable area, and keep the opposite edge anchored while resizing.
export const MIN_FITTED_FONT_PX = 11;
export function annotationLimits(kind) {
  return kind === 'note'
    ? {minWidth: 144, minHeight: 58, maxWidth: 1200, maxHeight: 800}
    : {minWidth: 96, minHeight: 36, maxWidth: 1200, maxHeight: 800};
}
export function resizeAnnotationRect(original, side, dx, dy, minHeight = annotationLimits(original.kind).minHeight) {
  const b = annotationLimits(original.kind);
  const widthMin = b.minWidth, heightMin = Math.min(b.maxHeight, Math.max(b.minHeight, minHeight));
  let {x,y,width,height} = original;
  if (!side) return {x:Math.max(-10000,Math.min(10000,x+dx)), y:Math.max(-10000,Math.min(10000,y+dy)), width,height};
  if (side.includes('e')) width = Math.max(widthMin,Math.min(b.maxWidth,original.width+dx));
  if (side.includes('s')) height = Math.max(heightMin,Math.min(b.maxHeight,original.height+dy));
  if (side.includes('w')) {
    width = Math.max(widthMin,Math.min(b.maxWidth,original.width-dx));
    x = original.x + original.width - width;
  }
  if (side.includes('n')) {
    height = Math.max(heightMin,Math.min(b.maxHeight,original.height-dy));
    y = original.y + original.height - height;
  }
  // A note may extend above/left of the original world origin. Never shrink
  // content just because the box crosses x=0 or y=0.
  if (x < -10000) { width -= -10000-x; x=-10000; }
  if (y < -10000) { height -= -10000-y; y=-10000; }
  return {x:Math.min(10000,x),y:Math.min(10000,y),width:Math.max(widthMin,width),height:Math.max(heightMin,height)};
}
