import type { Annotation } from '@/types'

export type AnnotationRect = Pick<Annotation,'x'|'y'|'width'|'height'>
export type ResizeSide = 'n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'nw'
const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n))

/** Coordinates are unzoomed world pixels, like the legacy annotation layout. */
export function resizeAnnotation(original:Annotation, side:ResizeSide, dx:number, dy:number):AnnotationRect {
  const minW=original.kind==='note'?144:96
  const minH=original.kind==='note'?58:36
  let {x,y,width,height}=original
  if(side.includes('e'))width=clamp(original.width+dx,minW,1200)
  if(side.includes('s'))height=clamp(original.height+dy,minH,800)
  if(side.includes('w')){
    width=clamp(original.width-dx,minW,1200)
    x=original.x+original.width-width
  }
  if(side.includes('n')){
    height=clamp(original.height-dy,minH,800)
    y=original.y+original.height-height
  }
  // The backend validates x/y in [-10000,10000].
  if(x< -10000){width=Math.max(minW,width-( -10000-x));x=-10000}
  if(y< -10000){height=Math.max(minH,height-( -10000-y));y=-10000}
  x=clamp(x,-10000,10000)
  y=clamp(y,-10000,10000)
  return {x:Math.round(x),y:Math.round(y),width:Math.round(width),height:Math.round(height)}
}
export function clampAnnotationPosition(x:number,y:number){
  return {x:Math.round(clamp(x,-10000,10000)),y:Math.round(clamp(y,-10000,10000))}
}
