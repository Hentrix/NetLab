/** Mouse-selection policy independent of Vue Flow's internal node-click ordering. */
export function nextNodeSelection(
  selected:readonly string[],
  id:string,
  additive:boolean
):string[]{
  if(!additive)return [id]
  const ids=[...new Set(selected)]
  return ids.includes(id)?ids.filter(value=>value!==id):[...ids,id]
}
