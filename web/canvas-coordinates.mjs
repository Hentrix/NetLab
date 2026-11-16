// Topology coordinates are signed world pixels. The pan/zoom transform is a
// *viewport* operation, not a boundary that prevents placing objects at x/y < 0.
// Use the same limit as the API so a drag never previews an unsavable position.
export const MAX_WORLD_COORD = 10000;
export function clampCoordinate(value){
  return Math.max(-MAX_WORLD_COORD,Math.min(MAX_WORLD_COORD,Math.round(value)));
}
export function worldCoordinates(clientX,clientY,bounds,panX,panY,zoom){
  return {x:clampCoordinate((clientX-bounds.left-panX)/zoom),y:clampCoordinate((clientY-bounds.top-panY)/zoom)};
}
export function translateSelection(initial,dx,dy){
  const entries=[...initial.entries()];
  if(!entries.length)return new Map();
  const xs=entries.map(([,p])=>p.x),ys=entries.map(([,p])=>p.y);
  const stepX=Math.max(-MAX_WORLD_COORD-Math.min(...xs),Math.min(MAX_WORLD_COORD-Math.max(...xs),Math.round(dx)));
  const stepY=Math.max(-MAX_WORLD_COORD-Math.min(...ys),Math.min(MAX_WORLD_COORD-Math.max(...ys),Math.round(dy)));
  return new Map(entries.map(([id,p])=>[id,{x:p.x+stepX,y:p.y+stepY}]));
}
