import type { Lab, Device, Cable } from '@/types'

const nodeSignature=(n:Device)=>[
  n.id,n.name,n.imageId,n.icon,n.engine,n.kind,n.x,n.y,n.nicCount,n.portStyle,
  n.ram,n.cpus,n.nicModel,n.diskBus,JSON.stringify(n.ports||[])
].join('|')
const linkSignature=(l:Cable)=>[
  l.id,l.a,l.b,l.aPort,l.bPort,l.color,l.lineWidth,l.lineStyle
].join('|')

/** A status tick must not replace Vue Flow node objects unless topology changed. */
export function sameTopologyStructure(oldLab:Lab,newLab:Lab):boolean{
  if(oldLab.id!==newLab.id||oldLab.name!==newLab.name)return false
  if(oldLab.nodes.length!==newLab.nodes.length||oldLab.links.length!==newLab.links.length)return false
  if((oldLab.annotations||[]).length!==(newLab.annotations||[]).length)return false
  if(oldLab.nodes.some((n,i)=>nodeSignature(n)!==nodeSignature(newLab.nodes[i])))return false
  if(oldLab.links.some((l,i)=>linkSignature(l)!==linkSignature(newLab.links[i])))return false
  return (oldLab.annotations||[]).every((n,i)=>JSON.stringify(n)===JSON.stringify((newLab.annotations||[])[i]))
}
