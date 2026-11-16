// Presentation geometry only. Every cable endpoint is assigned a distinct
// attachment on the corresponding side of the device, INCLUDING connections
// to different neighbours. The socket/NIC indices are never modified here.
const LEFT=-1, RIGHT=1;
const FACE_HALF_X=38, FACE_HALF_Y=29;
const NODE_CX=49, NODE_CY=37;

export function deviceCenter(node){return {x:node.x+NODE_CX,y:node.y+NODE_CY};}
export function attachmentSide(node,other){
  const a=deviceCenter(node),b=deviceCenter(other),dx=b.x-a.x,dy=b.y-a.y;
  // Normalise for the dimensions of a device icon so diagonal connections
  // attach to the most appropriate edge instead of all using its right side.
  return Math.abs(dx)/49>=Math.abs(dy)/47?(dx>=0?'right':'left'):(dy>=0?'bottom':'top');
}
export function anchorFor(node,target){
  const c=deviceCenter(node),dx=target.x-c.x,dy=target.y-c.y;
  if(Math.abs(dx)/49>=Math.abs(dy)/47)return {x:c.x+(dx>=0?50:-50),y:c.y};
  return {x:c.x,y:c.y+(dy>=0?68:-36)};
}
function sideAnchor(node,side,slot,total){
  const c=deviceCenter(node);
  const wide=side==='top'||side==='bottom';
  const half=wide?FACE_HALF_X:Math.max(FACE_HALF_Y,(total-1)*10);
  const spacing=total>1?Math.min(20,(2*half)/(total-1)):0;
  const offset=(slot-(total-1)/2)*spacing;
  switch(side){
    case 'left':return {x:c.x-50,y:c.y+offset};
    case 'right':return {x:c.x+50,y:c.y+offset};
    case 'top':return {x:c.x+offset,y:c.y-36};
    default:return {x:c.x+offset,y:c.y+68}; // below the device caption
  }
}
export function layoutParallelCables(lab){
  const nodes=new Map((lab.nodes||[]).map(n=>[n.id,n]));
  const records=new Map(),groups=new Map();
  for(const link of lab.links||[]){
    const a=nodes.get(link.a),b=nodes.get(link.b);
    if(!a||!b)continue;
    const first={node:a,other:b,side:attachmentSide(a,b),port:link.aPort,linkId:link.id,end:'A'};
    const second={node:b,other:a,side:attachmentSide(b,a),port:link.bPort,linkId:link.id,end:'B'};
    records.set(link.id,{first,second});
    for(const endpoint of [first,second]){
      const key=`${endpoint.node.id}:${endpoint.side}`;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(endpoint);
    }
  }
  // Sort by the projected position of the neighbour, then interface index.
  // Grouping by all links touching an edge avoids repeated attachment points
  // when a switch has cables to many different devices.
  for(const endpoints of groups.values()){
    const vertical=endpoints[0].side==='left'||endpoints[0].side==='right';
    endpoints.sort((a,b)=>{
      const pa=deviceCenter(a.other),pb=deviceCenter(b.other);
      const projection=(vertical?pa.y-pb.y:pa.x-pb.x);
      // The same cable must occupy the same rank at *both* devices.
      // Sorting by the local NIC index would reverse the bundle when the
      // port assignment is crossed (e.g. eth0->ether3, eth1->ether1).
      // The shared, stable link ID is independent of port numbers and A/B order.
      return projection||String(a.linkId).localeCompare(String(b.linkId));
    });
    endpoints.forEach((end,i)=>{end.point=sideAnchor(end.node,end.side,i,endpoints.length);end.slot=i;end.sideCount=endpoints.length;});
  }
  const result=new Map();
  for(const [id,{first,second}] of records){
    const A=first.point,B=second.point;
    result.set(id,{A,B,slot:first.slot,total:first.sideCount,sideA:first.side,sideB:second.side});
  }
  return result;
}

function badgeBox(x,y,width,height){return {left:x-width/2,right:x+width/2,top:y-height/2,bottom:y+height/2};}
function intersectArea(a,b){return Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));}

// Each side of a device uses ONE shared label offset.  The previous
// per-label collision resolver sent ether2/ether4 farther along their lines
// than ether1/ether3, even with four neatly parallel cables. This groups the
// ports and moves the whole bank together when there is an obstacle.
export function layoutPortBadges(lab,links,portName){
 const nodes=new Map((lab.nodes||[]).map(n=>[n.id,n]));
 const groups=new Map(),results=new Map();
 const boxes=(lab.nodes||[]).map(n=>({left:n.x-3,right:n.x+101,top:n.y-4,bottom:n.y+104}));
 const occupied=[];
 for(const link of lab.links||[]){
  const geo=links.get(link.id),a=nodes.get(link.a),b=nodes.get(link.b);
  if(!geo||!a||!b)continue;
  for(const item of [
   {id:link.id,end:'a',node:a,point:geo.A,other:geo.B,side:geo.sideA,name:String(portName(a,link.aPort))},
   {id:link.id,end:'b',node:b,point:geo.B,other:geo.A,side:geo.sideB,name:String(portName(b,link.bPort))}
  ]){
    const key=`${item.node.id}:${item.side}`;
    if(!groups.has(key))groups.set(key,[]);
    item.width=Math.max(35,item.name.length*6.35+13);item.height=18;
    groups.get(key).push(item);
  }
 }
 for(const key of [...groups.keys()].sort()){
  const items=groups.get(key).sort((a,b)=>a.id.localeCompare(b.id)||a.end.localeCompare(b.end));
  const maxWidth=Math.max(...items.map(i=>i.width));
  const preferred=Math.max(30,maxWidth/2+9);
  // Advance every badge on this face by the same distance; on short links
  // the halfway limit is shared whenever possible.
  const minReach=Math.min(...items.map(i=>Math.hypot(i.other.x-i.point.x,i.other.y-i.point.y)*.45));
  const candidates=[0,12,24,38,54,75,100].map(d=>Math.min(preferred+d,minReach));
  let best=null,bestScore=Infinity;
  for(const distance of [...new Set(candidates)]){
   const placements=[];
   for(const item of items){
    const dx=item.other.x-item.point.x,dy=item.other.y-item.point.y,len=Math.hypot(dx,dy)||1;
    const x=item.point.x+dx/len*distance,y=item.point.y+dy/len*distance;
    placements.push({...item,x,y,rect:badgeBox(x,y,item.width,item.height)});
   }
   let collision=0;
   for(let i=0;i<placements.length;i++){
    const item=placements[i];
    collision+=occupied.reduce((a,b)=>a+intersectArea(item.rect,b)*18,0);
    collision+=boxes.reduce((a,b)=>a+intersectArea(item.rect,b)*20,0);
    for(let j=0;j<i;j++)collision+=intersectArea(item.rect,placements[j].rect)*35;
   }
   const score=collision+Math.abs(distance-preferred)*.3;
   if(score<bestScore){bestScore=score;best=placements;}
  }
  for(const item of best){
   occupied.push(item.rect);
   const entry=results.get(item.id)||{};
   entry[item.end]={x:item.x,y:item.y,width:item.width,height:item.height};
   results.set(item.id,entry);
  }
 }
 return results;
}
